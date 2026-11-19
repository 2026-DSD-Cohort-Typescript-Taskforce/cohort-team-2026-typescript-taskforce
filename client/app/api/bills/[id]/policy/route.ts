import type { NextRequest } from 'next/server';
import { parsePolicyDecision } from '@/lib/bill-policy';
import { parseBillId } from '@/lib/bill-view';
import { BILL_NOT_FOUND } from '@/lib/submit-errors';
import { createUserClient, reply, replyWithError } from '@/lib/supabase';

/**
 * What the vendor's active policy decides about this bill, from evaluate_bill_policy():
 * { decision: { decision, policy_id, version_id, version, rule_index, policy_name,
 * interpretation } }. The bill page and the approval review show it.
 */
export async function GET(request: NextRequest, ctx: RouteContext<'/api/bills/[id]/policy'>) {
  const supabase = createUserClient(request);
  if (supabase instanceof Response) return supabase;

  const billId = parseBillId((await ctx.params).id);
  if (billId === null) return reply(BILL_NOT_FOUND);

  const { data, error } = await supabase.rpc('evaluate_bill_policy', { p_bill_id: billId });
  if (error) return replyWithError(error);
  const decision = parsePolicyDecision(data);
  if (!decision) return replyWithError({ code: 'PT500' }, "Couldn't check the policy.");
  return reply({ body: { decision } });
}
