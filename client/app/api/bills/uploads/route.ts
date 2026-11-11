// POST /api/bills/uploads: the first step of an upload. The browser sends the PDF's SHA-256;
// a bill that already has it is a duplicate (409), otherwise this returns a one-time signed
// URL for pending/<user_id>/<sha256>.pdf. The file itself goes straight from the browser to
// Storage, so it never passes through Vercel's request size limit.

import type { NextRequest } from 'next/server';
import { isSha256Hex } from '@/lib/bill-upload';
import {
  createUserClient,
  getProfileId,
  readJsonObject,
  reply,
  replyWithError,
} from '@/lib/supabase';

const UPLOAD_FAILED = "Couldn't start the upload. Try again.";

/**
 * Checks the PDF's SHA-256 against bills.pdf_sha256, then returns a one-time signed URL so
 * the browser uploads straight to Storage under pending/<user_id>/<sha256>.pdf.
 */
export async function POST(request: NextRequest) {
  const supabase = createUserClient(request);
  if (supabase instanceof Response) return supabase;

  const sha256 = (await readJsonObject(request))?.sha256;
  if (typeof sha256 !== 'string' || !isSha256Hex(sha256)) {
    return reply({
      status: 400,
      body: { error: "That file couldn't be read. Try again.", code: 'invalid_sha256' },
    });
  }

  const { data: existing, error } = await supabase
    .from('bills')
    .select('bill_id, status')
    .eq('pdf_sha256', sha256)
    .maybeSingle();
  if (error) return replyWithError(error);
  if (existing) {
    return reply({
      status: 409,
      body: { error: 'This PDF was already uploaded.', code: 'duplicate', bill: existing },
    });
  }

  const profileId = await getProfileId(request, supabase);
  if (profileId instanceof Response) return profileId;

  const { data, error: storageError } = await supabase.storage
    .from('bill-documents')
    .createSignedUploadUrl(`pending/${profileId}/${sha256}.pdf`, { upsert: true });
  if (storageError) {
    console.error('Signed upload URL failed:', storageError);
    return reply({ status: 500, body: { error: UPLOAD_FAILED } });
  }
  return reply({ body: { path: data.path, token: data.token } });
}
