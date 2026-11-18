import 'server-only';

// Supabase-backed DraftStore (DC-90). Runs as the signed-in user, so RLS applies.
// Any Supabase error throws DraftStoreError; the route turns it into a reply.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { DraftStore, DraftWrite } from './policy-draft-service.ts';
import { POLICY_DRAFT_SELECT, type PolicyDraft } from './policy-drafts.ts';
import type { PropertyRef } from './policy-rule.ts';
import type { SupabaseError } from './submit-errors';

export class DraftStoreError extends Error {
  readonly error: SupabaseError;
  constructor(error: SupabaseError) {
    super(error.message ?? 'Supabase request failed');
    this.name = 'DraftStoreError';
    this.error = error;
  }
}

function check<T>(result: { data: T; error: SupabaseError | null }): T {
  if (result.error) throw new DraftStoreError(result.error);
  return result.data;
}

export function createDraftStore(supabase: SupabaseClient): DraftStore {
  return {
    async isPolicyManager() {
      return check(await supabase.rpc('is_policy_manager')) === true;
    },
    async loadVendor(vendorId) {
      const data = check(
        await supabase
          .from('vendors')
          .select('vendor_id, name')
          .eq('vendor_id', vendorId)
          .maybeSingle(),
      );
      return (data as { vendor_id: number; name: string } | null) ?? null;
    },
    async loadProperties() {
      const data = check(
        await supabase.from('properties').select('property_id, name').order('property_id'),
      );
      return (data ?? []) as PropertyRef[];
    },
    async loadDraft(vendorId) {
      const data = check(
        await supabase
          .from('policy_drafts')
          .select(POLICY_DRAFT_SELECT)
          .eq('vendor_id', vendorId)
          .maybeSingle(),
      );
      return (data as PolicyDraft | null) ?? null;
    },
    async loadPolicyUpdatedAt(vendorId) {
      const data = check(
        await supabase
          .from('policies')
          .select('updated_at')
          .eq('vendor_id', vendorId)
          .maybeSingle(),
      );
      return (data as { updated_at: string } | null)?.updated_at ?? null;
    },
    async startDraft(values: DraftWrite) {
      const data = check(
        await supabase
          .from('policy_drafts')
          .upsert(values, { onConflict: 'vendor_id' })
          .select(POLICY_DRAFT_SELECT)
          .single(),
      );
      return data as unknown as PolicyDraft;
    },
    async continueDraft(vendorId, revision, values) {
      const data = check(
        await supabase
          .from('policy_drafts')
          .update(values)
          .eq('vendor_id', vendorId)
          .eq('revision', revision)
          .select(POLICY_DRAFT_SELECT)
          .maybeSingle(),
      );
      return (data as PolicyDraft | null) ?? null;
    },
  };
}
