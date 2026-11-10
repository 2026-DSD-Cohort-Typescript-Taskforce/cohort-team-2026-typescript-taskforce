import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { reply } from "@/lib/supabase";
import type { SupabaseError } from "@/lib/submit-errors";
import {
  INVALID_LOGO_REPLY,
  LOGO_FAILED,
  toVendorErrorResponse,
  VENDOR_FORBIDDEN,
  VENDOR_NOT_FOUND,
  type Vendor,
} from "@/lib/vendor-directory";
import type { LogoStore, LogoSwap } from "@/lib/vendor-queries";

export const VENDOR_SELECT = "vendor_id, name, email, address, phone, logo_path";
export const LOGO_BUCKET = "vendor-logos";

export type VendorRow = Omit<Vendor, "logo_url"> & { logo_path: string | null };

/** The vendor as the browser sees it: the logo's public URL instead of its storage path. */
export function toVendor(supabase: SupabaseClient, row: VendorRow): Vendor {
  const { logo_path, ...rest } = row;
  const logo_url = logo_path ? supabase.storage.from(LOGO_BUCKET).getPublicUrl(logo_path).data.publicUrl : null;
  return { ...rest, logo_url };
}

/**
 * A 403 reply unless the caller may change vendors. RLS also blocks other roles, but an
 * update or delete it blocks matches 0 rows, so every write asks first (is_vendor_manager()).
 */
export async function requireVendorManager(supabase: SupabaseClient): Promise<Response | null> {
  const { data, error } = await supabase.rpc("is_vendor_manager");
  if (error) return replyWithVendorError(error);
  return data === true ? null : reply(VENDOR_FORBIDDEN);
}

/** Replies to a Supabase error with a readable message. Unexpected ones are logged here. */
export function replyWithVendorError(error: SupabaseError, fallback?: string): Response {
  const response = toVendorErrorResponse(error, fallback);
  if (response.status === 500) console.error("Supabase request failed:", error);
  return reply(response);
}

/** The fields of a storage-js StorageApiError that the mapping reads. */
type StorageError = { message?: string; status?: number; statusCode?: string };

/** Replies to a failed logo upload: 403, a rejected file, or a logged 500. */
export function replyWithStorageError(error: StorageError): Response {
  const status = Number(error.status ?? error.statusCode);
  if (status === 403) return reply(VENDOR_FORBIDDEN);
  if (status === 413 || status === 415) return reply(INVALID_LOGO_REPLY);
  if (status === 400 && /mime|size|too large|exceed/i.test(error.message ?? "")) return reply(INVALID_LOGO_REPLY);
  console.error("Logo upload failed:", error);
  return reply({ status: 500, body: { error: LOGO_FAILED, code: "logo_failed" } });
}

/** One vendor's logo_path for replaceLogoPath (lib/vendor-queries.ts), as the signed-in user. */
export function logoStore(supabase: SupabaseClient, id: number): LogoStore<VendorRow, SupabaseError> {
  return {
    read: () => supabase.from("vendors").select("logo_path").eq("vendor_id", id).maybeSingle(),
    swap: (expected, next) => {
      const update = supabase
        .from("vendors")
        .update({ logo_path: next, updated_at: new Date().toISOString() })
        .eq("vendor_id", id);
      const unchanged = expected === null ? update.is("logo_path", null) : update.eq("logo_path", expected);
      return unchanged.select(VENDOR_SELECT).maybeSingle();
    },
  };
}

/** Replies to a logo change that didn't save: 404, a Supabase error, or a logged 500. */
export function replyWithLogoSwapFailure(swap: Exclude<LogoSwap<VendorRow, SupabaseError>, { kind: "saved" }>): Response {
  if (swap.kind === "missing") return reply(VENDOR_NOT_FOUND);
  if (swap.kind === "error") return replyWithVendorError(swap.error, LOGO_FAILED);
  console.error("Logo not changed: other requests kept changing it.");
  return reply({ status: 500, body: { error: LOGO_FAILED, code: "logo_failed" } });
}

/** Best effort: deletes a logo file. A failure is logged and never reaches the caller. */
export async function removeLogoFile(supabase: SupabaseClient, path: string | null): Promise<void> {
  if (!path) return;
  try {
    const { error } = await supabase.storage.from(LOGO_BUCKET).remove([path]);
    if (error) console.error("Couldn't remove logo file:", path, error);
  } catch (error) {
    console.error("Couldn't remove logo file:", path, error);
  }
}
