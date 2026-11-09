// What the bill intake drop zone accepts (DC-60: PNG, JPEG, PDF).
// Only imports with a .ts extension, so `npm test` (node --test) can load it.

export const BILL_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;

const KINDS: Record<string, "pdf" | "image"> = {
  "application/pdf": "pdf",
  "image/png": "image",
  "image/jpeg": "image",
};

const EXTENSIONS: Record<string, "pdf" | "image"> = {
  pdf: "pdf",
  png: "image",
  jpg: "image",
  jpeg: "image",
};

export type BillUploadKind = "pdf" | "image";

/** pdf, image, or null when the file is not a bill the intake screen can show. */
export function billUploadKind(file: { type: string; name: string }): BillUploadKind | null {
  const fromType = KINDS[file.type];
  if (fromType) return fromType;
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  return EXTENSIONS[extension] ?? null;
}

/** A message when the file cannot be previewed, or null when it can. */
export function billUploadError(file: { type: string; name: string; size: number }): string | null {
  if (!billUploadKind(file)) return "Use a PDF, PNG, or JPEG.";
  if (file.size <= 0) return "That file is empty.";
  if (file.size > BILL_UPLOAD_MAX_BYTES) return "That file is over 10 MB.";
  return null;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  const mb = bytes / (1024 * 1024);
  return `${mb >= 10 ? Math.round(mb) : mb.toFixed(1)} MB`;
}
