// Draft request flow for /api/policies/[vendorId]/draft (DC-90). Store- and model-agnostic:
// the route supplies a Supabase store and the real interpreter. Never writes policies.
// Only imports with a .ts extension, so `npm test` (node --test) can load it.

import {
  DRAFT_FORBIDDEN,
  DRAFT_NOT_FOUND,
  DRAFT_VENDOR_NOT_FOUND,
  INTERPRETATION_UNAVAILABLE,
  MAX_ANSWERS_PER_DRAFT,
  TOO_MANY_REVISIONS,
  interpretationFailed,
  invalidDraftRequest,
  parseDraftBody,
  staleDraft,
  type DraftAnswer,
  type DraftReply,
  type PolicyDraft,
} from './policy-drafts.ts';
import type { InterpretInput, InterpretOutcome } from './policy-interpreter.ts';
import { normalizeModelOutput, type PropertyRef } from './policy-rule.ts';

export type DraftWrite = Omit<PolicyDraft, 'revision' | 'updated_at'>;

export type DraftStore = {
  isPolicyManager(): Promise<boolean>;
  loadVendor(vendorId: number): Promise<{ vendor_id: number; name: string } | null>;
  loadProperties(): Promise<PropertyRef[]>;
  loadDraft(vendorId: number): Promise<PolicyDraft | null>;
  loadPolicyUpdatedAt(vendorId: number): Promise<string | null>;
  startDraft(values: DraftWrite): Promise<PolicyDraft>;
  /** Null when the stored revision no longer equals `revision`. */
  continueDraft(
    vendorId: number,
    revision: number,
    values: DraftWrite,
  ): Promise<PolicyDraft | null>;
};

export type Interpret = (input: InterpretInput) => Promise<InterpretOutcome>;

export async function getDraft(store: DraftStore, vendorId: number | null): Promise<DraftReply> {
  if (vendorId === null || (await store.loadVendor(vendorId)) === null)
    return DRAFT_VENDOR_NOT_FOUND;
  return { status: 200, body: { draft: await store.loadDraft(vendorId) } };
}

export async function postDraft(
  deps: {
    store: DraftStore;
    interpret: Interpret | null;
    log?: (message: string, detail?: unknown) => void;
  },
  vendorId: number | null,
  body: Record<string, unknown> | null,
): Promise<DraftReply> {
  const { store, interpret } = deps;
  const log = deps.log ?? console.error;

  if (!(await store.isPolicyManager())) return DRAFT_FORBIDDEN;
  if (vendorId === null) return DRAFT_VENDOR_NOT_FOUND;
  if (body === null) return invalidDraftRequest([]);
  const parsed = parseDraftBody(body);
  if (!parsed.ok) return invalidDraftRequest(parsed.fields);
  const request = parsed.body;
  const vendor = await store.loadVendor(vendorId);
  if (vendor === null) return DRAFT_VENDOR_NOT_FOUND;
  if (interpret === null) {
    log('Set OPENROUTER_API_KEY. See client/.env.example.');
    return INTERPRETATION_UNAVAILABLE;
  }

  let stored: PolicyDraft | null = null;
  let newAnswers: DraftAnswer[] = [];
  if (request.kind === 'continue') {
    stored = await store.loadDraft(vendorId);
    if (stored === null) return DRAFT_NOT_FOUND;
    if (stored.revision !== request.revision) return staleDraft(stored);
    const questions = new Map(stored.questions.map((q) => [q.id, q.question]));
    if (request.answers.some((a) => !questions.has(a.question_id))) {
      return invalidDraftRequest(['answers']);
    }
    newAnswers = request.answers.map((a) => ({
      question_id: a.question_id,
      question: questions.get(a.question_id) as string,
      answer: a.answer,
    }));
    if (stored.answers.length + newAnswers.length > MAX_ANSWERS_PER_DRAFT) {
      return TOO_MANY_REVISIONS;
    }
  }

  // Only for the failure replies: a restart replaces the draft but must show the old one on 502.
  const replyDraft = stored ?? (await store.loadDraft(vendorId));
  const properties = await store.loadProperties();
  const original = stored?.original_sentence ?? (request.kind === 'start' ? request.sentence : '');
  const sentence =
    request.kind === 'start'
      ? request.sentence
      : (request.sentence ?? (stored as PolicyDraft).sentence);
  const answers = [...(stored?.answers ?? []), ...newAnswers];
  const policyUpdatedAt = stored
    ? stored.policy_updated_at
    : await store.loadPolicyUpdatedAt(vendorId);

  const outcome = await interpret({
    vendor,
    properties,
    originalSentence: original,
    sentence,
    answers: answers.map(({ question, answer }) => ({ question, answer })),
    previousRule: stored?.rule ?? null,
  });
  if (!outcome.ok) {
    log(`Policy interpretation failed: ${outcome.reason}`, outcome.detail);
    return interpretationFailed(replyDraft);
  }

  const normalized = normalizeModelOutput(outcome.output, {
    vendorId,
    propertyIds: new Set(properties.map((p) => p.property_id)),
  });
  if (!normalized.ok) {
    log('Policy interpretation failed: malformed model output', normalized.reason);
    return interpretationFailed(replyDraft);
  }

  const values: DraftWrite = {
    ...normalized.draft,
    vendor_id: vendorId,
    original_sentence: original,
    sentence,
    answers,
    policy_updated_at: policyUpdatedAt,
  };

  if (request.kind === 'start') {
    return { status: 200, body: { draft: await store.startDraft(values) } };
  }
  const saved = await store.continueDraft(vendorId, request.revision, values);
  if (saved !== null) return { status: 200, body: { draft: saved } };
  const current = await store.loadDraft(vendorId);
  return current === null ? DRAFT_NOT_FOUND : staleDraft(current);
}
