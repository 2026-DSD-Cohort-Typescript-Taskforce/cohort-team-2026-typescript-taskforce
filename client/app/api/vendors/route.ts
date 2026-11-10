import type { NextRequest } from "next/server";
import { createUserClient, readJsonObject, reply } from "@/lib/supabase";
import { replyWithVendorError, requireVendorManager, toVendor, VENDOR_SELECT, type VendorRow } from "@/lib/vendor-routes";
import { VENDOR_FIELDS, validateVendorInput } from "@/lib/vendor-validation";
import { invalidVendor, LOAD_VENDORS_FAILED } from "@/lib/vendors";

/** Every vendor, by name. */
export async function GET(request: NextRequest) {
  const supabase = createUserClient(request);
  if (supabase instanceof Response) return supabase;

  const { data, error } = await supabase.from("vendors").select(VENDOR_SELECT).order("name").order("vendor_id");
  if (error) return replyWithVendorError(error, LOAD_VENDORS_FAILED);
  return reply({ body: { vendors: (data as VendorRow[]).map((row) => toVendor(supabase, row)) } });
}

/** Adds a vendor. Only financial approvers and system admins may. */
export async function POST(request: NextRequest) {
  const supabase = createUserClient(request);
  if (supabase instanceof Response) return supabase;

  const forbidden = await requireVendorManager(supabase);
  if (forbidden) return forbidden;

  const body = await readJsonObject(request);
  if (!body) return reply(invalidVendor(VENDOR_FIELDS));
  const result = validateVendorInput(body);
  if ("errors" in result) return reply(invalidVendor(Object.keys(result.errors)));

  const { data, error } = await supabase.from("vendors").insert(result.input).select(VENDOR_SELECT).single();
  if (error) return replyWithVendorError(error);
  return reply({ status: 201, body: { vendor: toVendor(supabase, data as VendorRow) } });
}
