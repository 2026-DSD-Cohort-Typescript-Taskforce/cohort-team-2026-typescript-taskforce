import type { NextRequest } from "next/server";
import { BILL_SELECT, parseBillId } from "@/lib/bill-view";
import { BILL_NOT_FOUND } from "@/lib/submit-errors";
import { createUserClient, reply, replyWithError } from "@/lib/supabase";

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
