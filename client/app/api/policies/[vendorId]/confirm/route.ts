// DC-91: POST turns a vendor's complete policy draft into the policy's active version.
// Policy managers only. Body { revision, name }. 200 { policy, version }.

import type { NextRequest } from 'next/server';
import { createUserClient, readJsonObject, reply } from '@/lib/supabase';
import { parseVendorId } from '@/lib/policies';
import { replyWithPolicyError } from '@/lib/policy-routes';
import { createDraftStore, DraftStoreError } from '@/lib/policy-draft-store';
import { confirmDraft, SAVE_CONFIRM_FAILED } from '@/lib/policy-confirm';

export async function POST(
  request: NextRequest,
  ctx: RouteContext<'/api/policies/[vendorId]/confirm'>,
) {
  const supabase = createUserClient(request);
  if (supabase instanceof Response) return supabase;
  try {
    const vendorId = parseVendorId((await ctx.params).vendorId);
    const body = await readJsonObject(request);
    return reply(await confirmDraft(createDraftStore(supabase), vendorId, body));
  } catch (e) {
    if (e instanceof DraftStoreError) return replyWithPolicyError(e.error, SAVE_CONFIRM_FAILED);
    throw e;
  }
}
