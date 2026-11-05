import type { NextRequest } from "next/server";
import { invalidBill, notDraft } from "@/lib/bill-errors";
import { validateBill } from "@/lib/bill-validation";
import { BILL_SELECT, parseBillId } from "@/lib/bill-view";
import { BILL_NOT_FOUND } from "@/lib/submit-errors";
import { createUserClient, readJsonObject, reply, replyWithError, replyWithWriteError } from "@/lib/supabase";

const UPDATE_FAILED = "Couldn't update the bill. Try again.";

export async function GET(request: NextRequest, ctx: RouteContext<"/api/bills/[id]">) {
  const supabase = createUserClient(request);
  if (supabase instanceof Response) return supabase;

  const billId = parseBillId((await ctx.params).id);
  if (billId === null) return reply(BILL_NOT_FOUND);

  const { data, error } = await supabase.from("bills").select(BILL_SELECT).eq("bill_id", billId).maybeSingle();
  if (error) return replyWithError(error, "Couldn't load the bill. Try again.");
  // Also a bill that RLS hides from this user.
  if (!data) return reply(BILL_NOT_FOUND);
  return reply({ body: { bill: data } });
}

/** Edits a draft bill. Only the fields in the body change; a bill that left draft can't. */
export async function PATCH(request: NextRequest, ctx: RouteContext<"/api/bills/[id]">) {
  const supabase = createUserClient(request);
  if (supabase instanceof Response) return supabase;

  const billId = parseBillId((await ctx.params).id);
  if (billId === null) return reply(BILL_NOT_FOUND);

  const body = await readJsonObject(request);
  const result = body ? validateBill(body, { partial: true }) : null;
  if (!result?.input) return reply(invalidBill(Object.keys(result?.errors ?? {})));
  if (Object.keys(result.input).length === 0) return reply(invalidBill());

  // The draft-only update policy makes a bill that left draft match no row.
  const { data, error } = await supabase
    .from("bills")
    // modified_at is stored in UTC, like date_received; a timestamp column ignores the Z.
    .update({ ...result.input, modified_at: new Date().toISOString() })
    .eq("bill_id", billId)
    .select(BILL_SELECT)
    .maybeSingle();
  if (error) return replyWithWriteError(error, UPDATE_FAILED);
  if (data) return reply({ body: { bill: data } });

  // Nothing changed: the bill left draft, or this user can't see it.
  const { data: current, error: readError } = await supabase
    .from("bills")
    .select("status")
    .eq("bill_id", billId)
    .maybeSingle();
  if (readError) return replyWithError(readError, UPDATE_FAILED);
  return reply(current ? notDraft(current.status) : BILL_NOT_FOUND);
}
