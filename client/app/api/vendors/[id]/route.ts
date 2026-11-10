import type { NextRequest } from "next/server";
import { createUserClient, readJsonObject, reply } from "@/lib/supabase";
import {
  removeLogoFile,
  replyWithVendorError,
  requireVendorManager,
  toVendor,
  VENDOR_SELECT,
  type VendorRow,
} from "@/lib/vendor-routes";
import { VENDOR_FIELDS, validateVendorInput } from "@/lib/vendor-validation";
import { DELETE_VENDOR_FAILED, invalidVendor, parseVendorId, VENDOR_NOT_FOUND } from "@/lib/vendor-directory";

/** Saves a vendor's details. The logo has its own route. */
export async function PATCH(request: NextRequest, ctx: RouteContext<"/api/vendors/[id]">) {
  const supabase = createUserClient(request);
  if (supabase instanceof Response) return supabase;

  const forbidden = await requireVendorManager(supabase);
  if (forbidden) return forbidden;

  const id = parseVendorId((await ctx.params).id);
  if (id === null) return reply(VENDOR_NOT_FOUND);

  const body = await readJsonObject(request);
  if (!body) return reply(invalidVendor(VENDOR_FIELDS));
  const result = validateVendorInput(body);
  if ("errors" in result) return reply(invalidVendor(Object.keys(result.errors)));

  const { data, error } = await supabase
    .from("vendors")
    .update({ ...result.input, updated_at: new Date().toISOString() })
    .eq("vendor_id", id)
    .select(VENDOR_SELECT)
    .maybeSingle();
  if (error) return replyWithVendorError(error);
  if (!data) return reply(VENDOR_NOT_FOUND);
  return reply({ body: { vendor: toVendor(supabase, data as VendorRow) } });
}

/** Deletes a vendor with no bills, then its logo file. */
export async function DELETE(request: NextRequest, ctx: RouteContext<"/api/vendors/[id]">) {
  const supabase = createUserClient(request);
  if (supabase instanceof Response) return supabase;

  const forbidden = await requireVendorManager(supabase);
  if (forbidden) return forbidden;

  const id = parseVendorId((await ctx.params).id);
  if (id === null) return reply(VENDOR_NOT_FOUND);

  const found = await supabase.from("vendors").select("logo_path").eq("vendor_id", id).maybeSingle();
  if (found.error) return replyWithVendorError(found.error, DELETE_VENDOR_FAILED);
  if (!found.data) return reply(VENDOR_NOT_FOUND);

  const { data, error } = await supabase.from("vendors").delete().eq("vendor_id", id).select("vendor_id");
  if (error) return replyWithVendorError(error, DELETE_VENDOR_FAILED);
  if (!data?.length) return reply(VENDOR_NOT_FOUND);

  await removeLogoFile(supabase, found.data.logo_path);
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
