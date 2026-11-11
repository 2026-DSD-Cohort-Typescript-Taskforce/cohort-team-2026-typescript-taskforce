// Browser-side upload of a bill document: fingerprint the PDF, ask /api/bills/uploads for a
// one-time signed URL, then send the file straight to the private bill-documents bucket
// under the user's pending/ folder. Used by the upload card and by Enter Bill Details.
// Only the publishable key is used here; the signed URL is what allows the write.

import { createClient } from '@supabase/supabase-js';
import { apiFetch } from './api-fetch';
import { sha256Hex } from './bill-upload';

const UPLOAD_FAILED = "Couldn't upload the PDF. Try again.";

export type PendingUpload =
  { ok: true; path: string } | { ok: false; error: string; duplicateBillId?: number };

// Created on first use, so a missing variable breaks the upload, not the whole page.
function billDocuments() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    throw new Error(
      'Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY. See client/.env.example.',
    );
  }
  return createClient(url, key).storage.from('bill-documents');
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

    const { error } = await billDocuments().uploadToSignedUrl(body.path, body.token, file, {
      contentType: 'application/pdf',
    });
    return error ? { ok: false, error: UPLOAD_FAILED } : { ok: true, path: body.path };
  } catch {
    return { ok: false, error: UPLOAD_FAILED };
  }
}
