import type { NextRequest } from "next/server";
import { invalidDecision, validateDecisionInput } from "@/lib/approvals";
import { parseBillId } from "@/lib/bill-view";
import { BILL_NOT_FOUND } from "@/lib/submit-errors";
import { createUserClient, readJsonObject, reply, replyWithDecisionError } from "@/lib/supabase";

/**
 * Records an approver's decision on a bill (approve, send back for revision, or not approve)
 * through decide_bill(). The body is validated with the database's own rules (decision value,
 * note up to 500 characters), so a bad request never reaches it. decide_bill() checks the role
 * and the bill's status and writes the audit row; its errors map to replies in lib/approvals.ts.
 */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/bills/[id]/decision">) {
  const supabase = createUserClient(request);
  if (supabase instanceof Response) return supabase;

  const billId = parseBillId((await ctx.params).id);
  if (billId === null) return reply(BILL_NOT_FOUND);

  const result = validateDecisionInput((await readJsonObject(request)) ?? {});
  if ("fields" in result) return reply(invalidDecision(result.fields));

  const { data, error } = await supabase.rpc("decide_bill", {
    p_bill_id: billId,
    p_decision: result.input.decision,
    p_note: result.input.note,
  });
  if (error) return replyWithDecisionError(error);
  return reply({ body: { bill: data } });
}
