// /api/bills/[id]/document: a bill's bill document. GET returns a 5-minute link to the
// stored PDF, since the bucket is private. POST attaches a pending upload to a draft (from
// Enter Bill Details): it moves the file to bills/<sha256>.pdf and sets pdf_path and
// pdf_sha256. Only drafts can get a PDF.

import type { NextRequest } from 'next/server';
import { BILL_SELECT, parseBillId } from '@/lib/bill-view';
import { BILL_NOT_FOUND } from '@/lib/submit-errors';
import {
  createUserClient,
  getProfileId,
  readJsonObject,
  reply,
  replyWithError,
} from '@/lib/supabase';

const BUCKET = 'bill-documents';

/** A link to the bill's PDF that works for 5 minutes. The bucket is private. */
export async function GET(request: NextRequest, ctx: RouteContext<'/api/bills/[id]/document'>) {
  const supabase = createUserClient(request);
  if (supabase instanceof Response) return supabase;

  const billId = parseBillId((await ctx.params).id);
  if (billId === null) return reply(BILL_NOT_FOUND);

  const { data, error } = await supabase
    .from('bills')
    .select('pdf_path')
    .eq('bill_id', billId)
    .maybeSingle();
  if (error) return replyWithError(error);
  if (!data) return reply(BILL_NOT_FOUND);
  if (!data.pdf_path) {
    return reply({
      status: 404,
      body: { error: 'No PDF is attached to this bill.', code: 'no_document' },
    });
  }

  const { data: signed, error: signError } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(data.pdf_path, 300);
  if (signError) {
    console.error('Signed PDF URL failed:', signError);
    return reply({ status: 500, body: { error: "Couldn't load the PDF." } });
  }
  return reply({ body: { url: signed.signedUrl } });
}

/**
 * Files the caller's pending upload under bills/<sha256>.pdf and attaches it to a draft.
 * The hash comes from the upload's name, which /api/bills/uploads checked.
 */
export async function POST(request: NextRequest, ctx: RouteContext<'/api/bills/[id]/document'>) {
  const supabase = createUserClient(request);
  if (supabase instanceof Response) return supabase;

  const billId = parseBillId((await ctx.params).id);
  if (billId === null) return reply(BILL_NOT_FOUND);

  const profileId = await getProfileId(request, supabase);
  if (profileId instanceof Response) return profileId;

  const path = (await readJsonObject(request))?.path;
  const match =
    typeof path === 'string'
      ? new RegExp(`^pending/${profileId}/([0-9a-f]{64})\\.pdf$`).exec(path)
      : null;
  if (typeof path !== 'string' || !match) {
    return reply({ status: 400, body: { error: 'Upload the PDF again.', code: 'invalid_path' } });
  }
  const sha256 = match[1];

  const { data: same, error: sameError } = await supabase
    .from('bills')
    .select('bill_id')
    .eq('pdf_sha256', sha256)
    .maybeSingle();
  if (sameError) return replyWithError(sameError);
  if (same) {
    return reply({
      status: 409,
      body: { error: 'This PDF is already on another bill.', code: 'duplicate', bill: same },
    });
  }

  const pdfPath = `bills/${sha256}.pdf`;
  const { error: moveError } = await supabase.storage.from(BUCKET).move(path, pdfPath);
  if (moveError) {
    console.error('Filing the PDF failed:', moveError);
    return reply({ status: 500, body: { error: "Couldn't attach the PDF. Try again." } });
  }

  // The draft-only update policy makes a bill that left draft match no row.
  const { data, error } = await supabase
    .from('bills')
    .update({ pdf_path: pdfPath, pdf_sha256: sha256, updated_at: new Date().toISOString() })
    .eq('bill_id', billId)
    .select(BILL_SELECT)
    .maybeSingle();
  if (error) return replyWithError(error);
  if (!data) {
    return reply({
      status: 409,
      body: { error: 'Only a draft can get a PDF.', code: 'not_draft' },
    });
  }
  return reply({ body: { bill: data } });
}
