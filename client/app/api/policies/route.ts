import type { NextRequest } from "next/server";
import { createUserClient, reply } from "@/lib/supabase";
import { LOAD_POLICIES_FAILED, toPolicyVendor, type PolicyVendorRow } from "@/lib/policies";
import { replyWithPolicyError, VENDOR_POLICY_SELECT } from "@/lib/policy-routes";

/** Every vendor with its policy (or null), by name. One page: up to 1,000 vendors. */
export async function GET(request: NextRequest) {
  const supabase = createUserClient(request);
  if (supabase instanceof Response) return supabase;

  const { data, error } = await supabase.from("vendors").select(VENDOR_POLICY_SELECT).order("name").order("vendor_id");
  if (error) return replyWithPolicyError(error, LOAD_POLICIES_FAILED);
  return reply({ body: { vendors: (data as unknown as PolicyVendorRow[]).map(toPolicyVendor) } });
}
