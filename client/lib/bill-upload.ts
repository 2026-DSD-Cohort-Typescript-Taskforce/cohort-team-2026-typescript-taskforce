// What the bill intake accepts, one PDF up to 10 MB, and the PDF's SHA-256 fingerprint.
// The fingerprint names the file in Storage and is stored in bills.pdf_sha256, so the
// same PDF uploaded twice is caught as a duplicate.
// Only imports with a .ts extension, so `npm test` (node --test) can load it.

export const BILL_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;

export type BillUploadKind = 'pdf';

/** pdf, or null when the file is not a bill the intake screen can show. */
export function billUploadKind(file: { type: string; name: string }): BillUploadKind | null {
  if (file.type === 'application/pdf') return 'pdf';
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  return extension === 'pdf' ? 'pdf' : null;
}

/** A message when the file cannot be previewed, or null when it can. */
export function billUploadError(file: { type: string; name: string; size: number }): string | null {
  if (!billUploadKind(file)) return 'Use a PDF.';
  if (file.size <= 0) return 'That file is empty.';
  if (file.size > BILL_UPLOAD_MAX_BYTES) return 'That file is over 10 MB.';
  return null;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  const mb = bytes / (1024 * 1024);
  return `${mb >= 10 ? Math.round(mb) : mb.toFixed(1)} MB`;
}

const SHA256_HEX = /^[0-9a-f]{64}$/;

/** True for a lowercase hex SHA-256, as sha256Hex returns. */
export function isSha256Hex(value: string): boolean {
  return SHA256_HEX.test(value);
}

/** The file's SHA-256 as 64 lowercase hex characters. Names the file in Storage. */
export async function sha256Hex(file: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
