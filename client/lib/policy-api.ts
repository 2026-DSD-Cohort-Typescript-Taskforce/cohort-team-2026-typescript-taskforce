// The browser's calls to the app's policy routes (DC-85), through the same `call` as the
// bill routes. Each returns the data, a failure with a readable message, or null while
// apiFetch sends the user to /login.

import { call, sendJson } from './bill-api';
import {
  LOAD_POLICIES_FAILED,
  SAVE_POLICY_FAILED,
  TOGGLE_POLICY_FAILED,
  type Policy,
  type PolicyVendor,
} from './policies';
import type { PolicyDraft } from './policy-drafts';
import type { PolicyInput } from './policy-validation';

const readPolicy = (body: { policy: Policy }) => body.policy;

// Local: widening sendJson's method type would touch the line PR #35 also edits.
const putJson = (body: unknown): RequestInit => ({
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export function loadPolicyVendors() {
  return call(
    '/api/policies',
    undefined,
    (body: { vendors: PolicyVendor[] }) => body.vendors,
    LOAD_POLICIES_FAILED,
  );
}

export function savePolicy(vendorId: number, input: PolicyInput) {
  return call(`/api/policies/${vendorId}`, putJson(input), readPolicy, SAVE_POLICY_FAILED);
}

export function setPolicyActive(vendorId: number, isActive: boolean) {
  return call(
    `/api/policies/${vendorId}`,
    sendJson('PATCH', { is_active: isActive }),
    readPolicy,
    TOGGLE_POLICY_FAILED,
  );
}

const readDraft = (body: { draft: PolicyDraft | null }) => body.draft;
const DRAFT_FAILED = "Couldn't check the policy. Try again.";
const CONFIRM_FAILED = "Couldn't turn the policy on. Try again.";
const draftPath = (vendorId: number) => `/api/policies/${vendorId}/draft`;

/** The vendor's stored draft, or null when there is none. */
export function loadDraft(vendorId: number) {
  return call(draftPath(vendorId), undefined, readDraft, DRAFT_FAILED);
}

export function startDraft(vendorId: number, sentence: string) {
  return call(draftPath(vendorId), sendJson('POST', { sentence }), readDraft, DRAFT_FAILED);
}

export function continueDraft(
  vendorId: number,
  revision: number,
  extra: { answers?: Array<{ question_id: string; answer: string }>; sentence?: string },
) {
  return call(
    draftPath(vendorId),
    sendJson('POST', { revision, ...extra }),
    readDraft,
    DRAFT_FAILED,
  );
}

/** Turns a complete draft into the policy's active version; answers { policy, version }. */
export function confirmDraft(vendorId: number, revision: number, name: string) {
  return call(
    `/api/policies/${vendorId}/confirm`,
    sendJson('POST', { revision, name }),
    (body: { policy: Policy }) => body.policy,
    CONFIRM_FAILED,
  );
}
