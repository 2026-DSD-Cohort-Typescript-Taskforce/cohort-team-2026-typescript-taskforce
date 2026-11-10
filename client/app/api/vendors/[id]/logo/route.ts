import type { NextRequest } from "next/server";
import { createUserClient, reply } from "@/lib/supabase";
import {
  LOGO_BUCKET,
  removeLogoFile,
  replyWithStorageError,
  replyWithVendorError,
  requireVendorManager,
  toVendor,
  VENDOR_SELECT,
  type VendorRow,
} from "@/lib/vendor-routes";
import { logoExtension } from "@/lib/vendor-validation";
import { INVALID_LOGO_REPLY, LOGO_FAILED, parseVendorId, VENDOR_NOT_FOUND } from "@/lib/vendors";

/** Sets a vendor's logo from the multipart `logo` field, then removes the old file. */
export async function PUT(request: NextRequest, ctx: RouteContext<"/api/vendors/[id]/logo">) {
  const supabase = createUserClient(request);
  if (supabase instanceof Response) return supabase;

  const forbidden = await requireVendorManager(supabase);
  if (forbidden) return forbidden;

  const id = parseVendorId((await ctx.params).id);
  if (id === null) return reply(VENDOR_NOT_FOUND);

  const form = await request.formData().catch(() => null);
  const file = form?.get("logo");
  const ext = file instanceof File ? logoExtension(file) : null;
  if (!(file instanceof File) || !ext) return reply(INVALID_LOGO_REPLY);

  const found = await supabase.from("vendors").select("logo_path").eq("vendor_id", id).maybeSingle();
  if (found.error) return replyWithVendorError(found.error, LOGO_FAILED);
  if (!found.data) return reply(VENDOR_NOT_FOUND);

  const path = `${id}/${crypto.randomUUID()}.${ext}`;
  const upload = await supabase.storage.from(LOGO_BUCKET).upload(path, file, { contentType: file.type, upsert: false });
  if (upload.error) return replyWithStorageError(upload.error);

  const { data, error } = await supabase
    .from("vendors")
    .update({ logo_path: path, updated_at: new Date().toISOString() })
    .eq("vendor_id", id)
    .select(VENDOR_SELECT)
    .maybeSingle();
  if (error || !data) {
    await removeLogoFile(supabase, path);
    return error ? replyWithVendorError(error, LOGO_FAILED) : reply(VENDOR_NOT_FOUND);
  }

  await removeLogoFile(supabase, found.data.logo_path);
  return reply({ body: { vendor: toVendor(supabase, data as VendorRow) } });
}

/** Removes a vendor's logo. */
export async function DELETE(request: NextRequest, ctx: RouteContext<"/api/vendors/[id]/logo">) {
  const supabase = createUserClient(request);
  if (supabase instanceof Response) return supabase;

  const forbidden = await requireVendorManager(supabase);
  if (forbidden) return forbidden;

  const id = parseVendorId((await ctx.params).id);
  if (id === null) return reply(VENDOR_NOT_FOUND);

  const found = await supabase.from("vendors").select("logo_path").eq("vendor_id", id).maybeSingle();
  if (found.error) return replyWithVendorError(found.error, LOGO_FAILED);
  if (!found.data) return reply(VENDOR_NOT_FOUND);

  const { data, error } = await supabase
    .from("vendors")
    .update({ logo_path: null, updated_at: new Date().toISOString() })
    .eq("vendor_id", id)
    .select(VENDOR_SELECT)
    .maybeSingle();
  if (error) return replyWithVendorError(error, LOGO_FAILED);
  if (!data) return reply(VENDOR_NOT_FOUND);

  await removeLogoFile(supabase, found.data.logo_path);
  return reply({ body: { vendor: toVendor(supabase, data as VendorRow) } });
}
