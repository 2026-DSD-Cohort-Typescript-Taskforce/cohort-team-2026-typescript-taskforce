import type { NextRequest } from "next/server";
import { parseBillId } from "@/lib/bill-view";
import { BILL_NOT_FOUND } from "@/lib/submit-errors";
import { createUserClient, reply, replyWithError } from "@/lib/supabase";

/**
 * Submits a draft bill for payment. submit_bill() checks the role, status and required
 * fields and writes the audit row; its errors map to replies in lib/submit-errors.ts.
 */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/bills/[id]/submit">) {
  const supabase = createUserClient(request);
  if (supabase instanceof Response) return supabase;

  const billId = parseBillId((await ctx.params).id);
  if (billId === null) return reply(BILL_NOT_FOUND);

  const { data, error } = await supabase.rpc("submit_bill", { p_bill_id: billId });
  if (error) return replyWithError(error);
  return reply({ body: { bill: data } });
}
