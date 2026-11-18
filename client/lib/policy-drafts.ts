// Policy draft type, request validation and replies for /api/policies/[vendorId]/draft (DC-90).
// Only imports with a .ts extension, so `npm test` (node --test) can load it.

import { POLICY_FORBIDDEN, POLICY_VENDOR_NOT_FOUND } from './policies.ts';
import type {
  DraftQuestion,
  DraftStatus,
  PolicyRuleV1,
  RuleConflict,
  UnsupportedPart,
} from './policy-rule.ts';

export const SENTENCE_MAX = 1000;
export const ANSWER_MAX = 500;
export const MAX_ANSWERS_PER_REQUEST = 10;
export const MAX_ANSWERS_PER_DRAFT = 30;

const QUESTION_ID_MAX = 20;
const MAX_INT4 = 2147483647;

export type DraftAnswer = { question_id: string; question: string; answer: string };

export type PolicyDraft = {
  vendor_id: number;
  revision: number;
  status: DraftStatus;
  original_sentence: string;
  sentence: string;
  revised_sentence: string;
  interpretation: string;
  not_covered: string | null;
  rule: PolicyRuleV1 | null;
  questions: DraftQuestion[];
  unsupported: UnsupportedPart[];
  conflicts: RuleConflict[];
  answers: DraftAnswer[];
  policy_updated_at: string | null;
  updated_at: string;
};

export const POLICY_DRAFT_SELECT =
  'vendor_id, revision, status, original_sentence, sentence, revised_sentence, interpretation, not_covered, rule, questions, unsupported, conflicts, answers, policy_updated_at, updated_at';

export type DraftBody =
  | { kind: 'start'; sentence: string }
  | {
      kind: 'continue';
      revision: number;
      answers: Array<{ question_id: string; answer: string }>;
      sentence: string | null;
    };

const length = (value: string) => [...value].length;

/** The trimmed text when it is a string of 1..max characters, else null. */
function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed && length(trimmed) <= max ? trimmed : null;
}

function parseAnswers(value: unknown): Array<{ question_id: string; answer: string }> | null {
  if (!Array.isArray(value) || value.length > MAX_ANSWERS_PER_REQUEST) return null;
  const seen = new Set<string>();
  const answers: Array<{ question_id: string; answer: string }> = [];
  for (const item of value) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return null;
    const keys = Object.keys(item);
    if (keys.length !== 2 || !keys.includes('question_id') || !keys.includes('answer')) return null;
    const record = item as Record<string, unknown>;
    const question_id = text(record.question_id, QUESTION_ID_MAX);
    const answer = text(record.answer, ANSWER_MAX);
    if (question_id === null || answer === null || seen.has(question_id)) return null;
    seen.add(question_id);
    answers.push({ question_id, answer });
  }
  return answers;
}

/** Checks a draft request body; returns the trimmed body or the names of the failing fields. */
export function parseDraftBody(
  body: Record<string, unknown>,
): { ok: true; body: DraftBody } | { ok: false; fields: string[] } {
  const isContinue = 'revision' in body;
  const allowed = isContinue ? ['revision', 'answers', 'sentence'] : ['sentence'];
  const fields = Object.keys(body).filter((key) => !allowed.includes(key));
  const fail = (...names: string[]) => ({ ok: false as const, fields: [...fields, ...names] });

  if (!isContinue) {
    const sentence = text(body.sentence, SENTENCE_MAX);
    return sentence === null || fields.length > 0
      ? fail(...(sentence === null ? ['sentence'] : []))
      : { ok: true, body: { kind: 'start', sentence } };
  }

  const revision = body.revision;
  const bad: string[] = [];
  if (
    typeof revision !== 'number' ||
    !Number.isSafeInteger(revision) ||
    revision < 1 ||
    revision > MAX_INT4
  ) {
    bad.push('revision');
  }

  const hasAnswers = body.answers !== undefined;
  const hasSentence = body.sentence !== undefined;
  const answers = hasAnswers ? parseAnswers(body.answers) : [];
  const sentence = hasSentence ? text(body.sentence, SENTENCE_MAX) : null;
  if (hasSentence && sentence === null) bad.push('sentence');
  if (answers === null || (!hasSentence && answers.length === 0)) bad.push('answers');

  if (bad.length > 0 || fields.length > 0 || answers === null) return fail(...bad);
  return { ok: true, body: { kind: 'continue', revision: revision as number, answers, sentence } };
}

/** An HTTP reply for the draft route: a status and a JSON body. */
export type DraftReply = { status: number; body: unknown };

export const DRAFT_FORBIDDEN: DraftReply = POLICY_FORBIDDEN;
export const DRAFT_VENDOR_NOT_FOUND: DraftReply = POLICY_VENDOR_NOT_FOUND;

export const DRAFT_NOT_FOUND: DraftReply = {
  status: 404,
  body: {
    error: "There's no draft for this policy yet. Start one with a sentence.",
    code: 'draft_not_found',
  },
};

export function invalidDraftRequest(fields: string[]): DraftReply {
  return {
    status: 400,
    body: { error: "Some of the request's details aren't valid.", code: 'invalid_request', fields },
  };
}

export function staleDraft(draft: PolicyDraft): DraftReply {
  return {
    status: 409,
    body: {
      error: 'This draft changed since you loaded it. Review the latest version.',
      code: 'stale_draft',
      draft,
    },
  };
}

export const TOO_MANY_REVISIONS: DraftReply = {
  status: 422,
  body: {
    error: 'This draft has too many answers. Start the policy again.',
    code: 'too_many_revisions',
  },
};

export function interpretationFailed(draft: PolicyDraft | null): DraftReply {
  return {
    status: 502,
    body: {
      error: "Couldn't interpret the policy. Try again.",
      code: 'interpretation_failed',
      draft,
    },
  };
}

export const INTERPRETATION_UNAVAILABLE: DraftReply = {
  status: 503,
  body: { error: "Policy interpretation isn't set up yet.", code: 'interpretation_unavailable' },
};

export const LOAD_DRAFT_FAILED = "Couldn't load the policy draft. Try again.";
export const SAVE_DRAFT_FAILED = "Couldn't save the policy draft. Try again.";
