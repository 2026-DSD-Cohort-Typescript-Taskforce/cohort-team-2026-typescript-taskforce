import type { NextRequest } from "next/server";
import { createUserClient, reply } from "@/lib/supabase";
import {
  LOGO_BUCKET,
  logoStore,
  removeLogoFile,
  replyWithLogoSwapFailure,
  replyWithStorageError,
  replyWithVendorError,
  requireVendorManager,
  toVendor,
} from "@/lib/vendor-routes";
import { replaceLogoPath } from "@/lib/vendor-queries";
import { logoExtension } from "@/lib/vendor-validation";
import { INVALID_LOGO_REPLY, LOGO_FAILED, parseVendorId, VENDOR_NOT_FOUND } from "@/lib/vendor-directory";

/** Sets a vendor's logo from the multipart `logo` field, then removes the file it replaced. */
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

  const store = logoStore(supabase, id);
  const found = await store.read();
  if (found.error) return replyWithVendorError(found.error, LOGO_FAILED);
  if (!found.data) return reply(VENDOR_NOT_FOUND);

  const path = `${id}/${crypto.randomUUID()}.${ext}`;
  const upload = await supabase.storage.from(LOGO_BUCKET).upload(path, file, { contentType: file.type, upsert: false });
  if (upload.error) return replyWithStorageError(upload.error);

  const swap = await replaceLogoPath(store, path, found.data.logo_path);
  if (swap.kind !== "saved") {
    await removeLogoFile(supabase, path);
    return replyWithLogoSwapFailure(swap);
  }

  await removeLogoFile(supabase, swap.previous);
  return reply({ body: { vendor: toVendor(supabase, swap.row) } });
}

/** Removes a vendor's logo. */
export async function DELETE(request: NextRequest, ctx: RouteContext<"/api/vendors/[id]/logo">) {
  const supabase = createUserClient(request);
  if (supabase instanceof Response) return supabase;

  const forbidden = await requireVendorManager(supabase);
  if (forbidden) return forbidden;

  const id = parseVendorId((await ctx.params).id);
  if (id === null) return reply(VENDOR_NOT_FOUND);

  const store = logoStore(supabase, id);
  const found = await store.read();
  if (found.error) return replyWithVendorError(found.error, LOGO_FAILED);
  if (!found.data) return reply(VENDOR_NOT_FOUND);

  const swap = await replaceLogoPath(store, null, found.data.logo_path);
  if (swap.kind !== "saved") return replyWithLogoSwapFailure(swap);

  await removeLogoFile(supabase, swap.previous);
  return reply({ body: { vendor: toVendor(supabase, swap.row) } });
}
