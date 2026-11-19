// Confirm request flow for /api/policies/[vendorId]/confirm (DC-91). Turns a complete draft
// into an active policy version through confirm_policy_draft. Store-agnostic.
// Only imports with a .ts extension, so `npm test` (node --test) can load it.

import { invalidPolicy, type ActiveVersion, type Policy } from './policies.ts';
import {
  DRAFT_FORBIDDEN,
  DRAFT_NOT_FOUND,
  DRAFT_VENDOR_NOT_FOUND,
  invalidDraftRequest,
  staleDraft,
  type DraftReply,
  type PolicyDraft,
} from './policy-drafts.ts';
import { findConflicts, isPolicyRuleV1 } from './policy-rule.ts';
import type { SupabaseError } from './submit-errors.ts';

export const POLICY_NAME_MAX = 100;
const MAX_INT4 = 2147483647;

export type ConfirmStore = {
  isPolicyManager(): Promise<boolean>;
  loadVendor(vendorId: number): Promise<{ vendor_id: number; name: string } | null>;
  loadDraft(vendorId: number): Promise<PolicyDraft | null>;
  confirm(
    vendorId: number,
    revision: number,
    name: string,
  ): Promise<{ policy: Policy; version: ActiveVersion } | { error: SupabaseError }>;
};

export const SAVE_CONFIRM_FAILED = "Couldn't turn the policy on. Try again.";
export const CONFIRM_FAILED_REPLY: DraftReply = {
  status: 500,
  body: { error: SAVE_CONFIRM_FAILED, code: 'confirm_failed' },
};

export const POLICY_CHANGED_MESSAGE =
  'This policy changed since the draft started. Check the policy again.';
export const NOT_READY_MESSAGE = "This draft isn't ready to turn on yet.";

export function parseConfirmBody(
  body: Record<string, unknown>,
): { ok: true; revision: number; name: string } | { ok: false; fields: string[] } {
  const fields = Object.keys(body).filter((key) => key !== 'revision' && key !== 'name');
  const { revision, name } = body;
  if (
    typeof revision !== 'number' ||
    !Number.isSafeInteger(revision) ||
    revision < 1 ||
    revision > MAX_INT4
  ) {
    fields.push('revision');
  }
  const trimmed = typeof name === 'string' ? name.trim() : '';
  if (!trimmed || [...trimmed].length > POLICY_NAME_MAX) fields.push('name');
  if (fields.length > 0) return { ok: false, fields };
  return { ok: true, revision: revision as number, name: trimmed };
}

function withDraft(status: number, code: string, error: string, draft: PolicyDraft | null) {
  return { status, body: { error, code, draft } };
}

function invalidFields(details: string | null | undefined): string[] {
  try {
    const parsed: unknown = JSON.parse(details ?? '');
    if (Array.isArray(parsed) && parsed.every((f) => typeof f === 'string')) return parsed;
  } catch {
    // fall through
  }
  return ['name'];
}

export async function confirmDraft(
  store: ConfirmStore,
  vendorId: number | null,
  body: Record<string, unknown> | null,
): Promise<DraftReply> {
  if (!(await store.isPolicyManager())) return DRAFT_FORBIDDEN;
  if (vendorId === null) return DRAFT_VENDOR_NOT_FOUND;
  if (body === null) return invalidDraftRequest([]);
  const parsed = parseConfirmBody(body);
  if (!parsed.ok) return invalidDraftRequest(parsed.fields);
  if ((await store.loadVendor(vendorId)) === null) return DRAFT_VENDOR_NOT_FOUND;

  const stored = await store.loadDraft(vendorId);
  if (stored === null) return DRAFT_NOT_FOUND;

  // The table is writable by policy managers, so the function's checks are not the only ones.
  const rule = stored.rule;
  if (
    !isPolicyRuleV1(rule) ||
    rule.vendor_id !== vendorId ||
    findConflicts(rule.rules).length > 0
  ) {
    return withDraft(409, 'draft_not_complete', NOT_READY_MESSAGE, stored);
  }

  const result = await store.confirm(vendorId, parsed.revision, parsed.name);
  if (!('error' in result)) return { status: 200, body: result };

  const { message, details } = result.error;
  switch (message) {
    case 'forbidden':
      return DRAFT_FORBIDDEN;
    case 'vendor_not_found':
      return DRAFT_VENDOR_NOT_FOUND;
    case 'draft_not_found':
      return DRAFT_NOT_FOUND;
    case 'invalid_policy':
      return invalidPolicy(invalidFields(details));
    case 'stale_draft':
      return staleDraft(await store.loadDraft(vendorId));
    case 'policy_changed':
      return withDraft(
        409,
        'policy_changed',
        POLICY_CHANGED_MESSAGE,
        await store.loadDraft(vendorId),
      );
    case 'draft_not_complete':
    case 'invalid_rule':
      return withDraft(409, message, NOT_READY_MESSAGE, await store.loadDraft(vendorId));
  }
  return CONFIRM_FAILED_REPLY;
}
