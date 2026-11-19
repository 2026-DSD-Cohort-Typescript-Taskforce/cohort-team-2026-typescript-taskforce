import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { reply } from '@/lib/supabase';
import type { SupabaseError } from '@/lib/submit-errors';
import { POLICY_FORBIDDEN, toPolicyErrorResponse } from '@/lib/policies';

// Two foreign keys link policies and policy_versions, so the embeds name the one they follow.
const ACTIVE_VERSION =
  'active_version:policy_versions!policies_active_version_id_fkey(version_id, version, interpretation, confirmed_at, confirmer:users!policy_versions_confirmed_by_fkey(name))';
const POLICY_COLUMNS = `policy_id, name, description, is_active, updated_at, ${ACTIVE_VERSION}`;

export const POLICY_SELECT = POLICY_COLUMNS;
export const VENDOR_POLICY_SELECT = `vendor_id, name, supported_payment_methods, payment_portal_url, policies(${POLICY_COLUMNS})`;

/**
 * A 403 reply unless the caller may change policies. RLS also blocks other roles, but an
 * update it blocks matches 0 rows, so every write asks first (is_policy_manager()).
 */
export async function requirePolicyManager(
  supabase: SupabaseClient,
  fallback?: string,
): Promise<Response | null> {
  const { data, error } = await supabase.rpc('is_policy_manager');
  if (error) return replyWithPolicyError(error, fallback);
  return data === true ? null : reply(POLICY_FORBIDDEN);
}

/** Replies to a Supabase error with a readable message. Unexpected ones are logged here. */
export function replyWithPolicyError(error: SupabaseError, fallback?: string): Response {
  const response = toPolicyErrorResponse(error, fallback);
  if (response.status === 500) console.error('Supabase request failed:', error);
  return reply(response);
}
