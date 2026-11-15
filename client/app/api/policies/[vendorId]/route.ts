import type { NextRequest } from "next/server";
import { createUserClient, readJsonObject, reply } from "@/lib/supabase";
import {
  invalidPolicy,
  parseVendorId,
  POLICY_NOT_FOUND,
  POLICY_VENDOR_NOT_FOUND,
  SAVE_POLICY_FAILED,
  TOGGLE_POLICY_FAILED,
  type Policy,
} from "@/lib/policies";
import { parseActiveFlag, POLICY_FIELDS, validatePolicyInput } from "@/lib/policy-validation";
import { POLICY_SELECT, replyWithPolicyError, requirePolicyManager } from "@/lib/policy-routes";

/** Adds a vendor's policy (201), or replaces its name and description (200). */
export async function PUT(request: NextRequest, ctx: RouteContext<"/api/policies/[vendorId]">) {
  const supabase = createUserClient(request);
  if (supabase instanceof Response) return supabase;

  const forbidden = await requirePolicyManager(supabase, SAVE_POLICY_FAILED);
  if (forbidden) return forbidden;

  const vendorId = parseVendorId((await ctx.params).vendorId);
  if (vendorId === null) return reply(POLICY_VENDOR_NOT_FOUND);

  const body = await readJsonObject(request);
  if (!body) return reply(invalidPolicy(POLICY_FIELDS));
  const result = validatePolicyInput(body);
  if ("errors" in result) return reply(invalidPolicy(Object.keys(result.errors)));
  const { name, description } = result.input;

  const update = () =>
    supabase
      .from("policies")
      .update({ name, description, updated_at: new Date().toISOString() })
      .eq("vendor_id", vendorId)
      .select(POLICY_SELECT)
      .maybeSingle();

  const updated = await update();
  if (updated.error) return replyWithPolicyError(updated.error);
  if (updated.data) return reply({ body: { policy: updated.data as Policy } });

  const inserted = await supabase
    .from("policies")
    .insert({ vendor_id: vendorId, name, description })
    .select(POLICY_SELECT)
    .single();
  if (!inserted.error) return reply({ status: 201, body: { policy: inserted.data as Policy } });
  if (inserted.error.code !== "23505") return replyWithPolicyError(inserted.error);

  // Another manager added this vendor's policy a moment ago: update theirs once.
  const retried = await update();
  if (retried.error) return replyWithPolicyError(retried.error);
  if (retried.data) return reply({ body: { policy: retried.data as Policy } });
  return replyWithPolicyError(inserted.error, SAVE_POLICY_FAILED);
}

/** Turns a vendor's policy on or off. */
export async function PATCH(request: NextRequest, ctx: RouteContext<"/api/policies/[vendorId]">) {
  const supabase = createUserClient(request);
  if (supabase instanceof Response) return supabase;

  const forbidden = await requirePolicyManager(supabase, TOGGLE_POLICY_FAILED);
  if (forbidden) return forbidden;

  const vendorId = parseVendorId((await ctx.params).vendorId);
  if (vendorId === null) return reply(POLICY_NOT_FOUND);

  const body = await readJsonObject(request);
  const isActive = body ? parseActiveFlag(body) : null;
  if (isActive === null) return reply(invalidPolicy(["is_active"]));

  const { data, error } = await supabase
    .from("policies")
    .update({ is_active: isActive, updated_at: new Date().toISOString() })
    .eq("vendor_id", vendorId)
    .select(POLICY_SELECT)
    .maybeSingle();
  if (error) return replyWithPolicyError(error, TOGGLE_POLICY_FAILED);
  if (!data) return reply(POLICY_NOT_FOUND);
  return reply({ body: { policy: data as Policy } });
}
