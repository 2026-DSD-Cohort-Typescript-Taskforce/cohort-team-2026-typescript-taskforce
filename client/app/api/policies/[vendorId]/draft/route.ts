// DC-90: turns a vendor's policy sentence into an inactive policy draft.
// GET: any signed-in user reads the vendor's draft (or null).
// POST: policy managers only; starts or continues a draft through the model.
// Drafts never create or change policies.

import type { NextRequest } from 'next/server';
import { createUserClient, readJsonObject, reply } from '@/lib/supabase';
import { parseVendorId } from '@/lib/policies';
import { replyWithPolicyError } from '@/lib/policy-routes';
import { createDraftStore, DraftStoreError } from '@/lib/policy-draft-store';
import { getDraft, postDraft } from '@/lib/policy-draft-service';
import { LOAD_DRAFT_FAILED, SAVE_DRAFT_FAILED } from '@/lib/policy-drafts';
import { callInterpreter, interpreterConfigFromEnv } from '@/lib/policy-interpreter';

// The model call can take up to 30 s, plus the database round trips.
export const maxDuration = 60;

export async function GET(
  request: NextRequest,
  ctx: RouteContext<'/api/policies/[vendorId]/draft'>,
) {
  const supabase = createUserClient(request);
  if (supabase instanceof Response) return supabase;
  try {
    const vendorId = parseVendorId((await ctx.params).vendorId);
    return reply(await getDraft(createDraftStore(supabase), vendorId));
  } catch (e) {
    if (e instanceof DraftStoreError) return replyWithPolicyError(e.error, LOAD_DRAFT_FAILED);
    throw e;
  }
}

export async function POST(
  request: NextRequest,
  ctx: RouteContext<'/api/policies/[vendorId]/draft'>,
) {
  const supabase = createUserClient(request);
  if (supabase instanceof Response) return supabase;
  try {
    const vendorId = parseVendorId((await ctx.params).vendorId);
    const body = await readJsonObject(request);
    const config = interpreterConfigFromEnv(process.env);
    const interpret = config
      ? (input: Parameters<typeof callInterpreter>[0]) => callInterpreter(input, config)
      : null;
    return reply(await postDraft({ store: createDraftStore(supabase), interpret }, vendorId, body));
  } catch (e) {
    if (e instanceof DraftStoreError) return replyWithPolicyError(e.error, SAVE_DRAFT_FAILED);
    throw e;
  }
}
