// Browser-side upload of a bill document: fingerprint the PDF, ask /api/bills/uploads for a
// one-time signed URL, then send the file straight to the private bill-documents bucket
// under the user's pending/ folder. Used by the upload card and by Enter Bill Details.
// Only the publishable key is used here; the signed URL is what allows the write.

import { apiFetch } from './api-fetch';
import { sha256Hex, signedBillUploadUrl } from './bill-upload';

const UPLOAD_FAILED = "Couldn't upload the PDF. Try again.";

export type PendingUpload =
  { ok: true; path: string } | { ok: false; error: string; duplicateBillId?: number };

async function uploadToSignedUrl(path: string, token: string, file: File) {
  const url = signedBillUploadUrl(process.env.NEXT_PUBLIC_SUPABASE_URL, path, token);
  if (!url) throw new Error('Set NEXT_PUBLIC_SUPABASE_URL. See client/.env.example.');
  const body = new FormData();
  body.append('cacheControl', '3600');
  body.append('', file);
  return fetch(url, { method: 'PUT', headers: { 'x-upsert': 'false' }, body });
}

/**
 * Uploads the PDF to the caller's pending/ folder through a one-time signed URL. null
 * while apiFetch sends the user to /login.
 */
export async function uploadPending(file: File): Promise<PendingUpload | null> {
  try {
    const sha256 = await sha256Hex(file);
    const res = await apiFetch('/api/bills/uploads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sha256 }),
    });
    if (!res) return null;
    const body = await res.json().catch(() => null);
    if (res.status === 409 && body?.code === 'duplicate') {
      return { ok: false, error: body.error, duplicateBillId: body.bill?.bill_id };
    }
    if (!res.ok) return { ok: false, error: body?.error ?? UPLOAD_FAILED };

    const uploaded = await uploadToSignedUrl(body.path, body.token, file);
    return uploaded.ok ? { ok: true, path: body.path } : { ok: false, error: UPLOAD_FAILED };
  } catch {
    return { ok: false, error: UPLOAD_FAILED };
  }
}
