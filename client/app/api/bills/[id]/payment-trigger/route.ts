import type { NextRequest } from 'next/server';
import { parseBillId } from '@/lib/bill-view';
import { runPaymentTrigger, type BillMcpReply } from '@/lib/payment-trigger-service';
import { SIGNED_OUT } from '@/lib/submit-errors';
import { accessToken, createUserClient, reply } from '@/lib/supabase';

export const maxDuration = 150;

async function callerRole(
  request: NextRequest,
  supabase: Exclude<ReturnType<typeof createUserClient>, Response>,
): Promise<string | null | Response> {
  const token = accessToken(request);
  if (!token) return reply(SIGNED_OUT);
  const { data: auth } = await supabase.auth.getUser(token);
  if (!auth.user) return reply(SIGNED_OUT);
  const { data, error } = await supabase
    .from('users')
    .select('role')
    .eq('auth_user_id', auth.user.id)
    .maybeSingle();
  if (error) {
    console.error('Could not load payment trigger role:', error);
    return null;
  }
  return typeof data?.role === 'string' ? data.role : null;
}

async function callBillMcp(request: NextRequest, billId: number): Promise<BillMcpReply> {
  const url = process.env.BILL_MCP_URL;
  const sharedToken = process.env.BILL_MCP_TOKEN;
  const userToken = accessToken(request);
  if (!url || !sharedToken || !userToken) {
    return { ok: true, status: 200, body: { error: 'worker not configured' } };
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${sharedToken}`,
      'Content-Type': 'application/json',
      'x-user-authorization': `Bearer ${userToken}`,
    },
    body: JSON.stringify({
      method: 'tools/call',
      params: { name: 'execute_approved_payment', arguments: { bill_id: billId } },
    }),
    cache: 'no-store',
    signal: AbortSignal.timeout(140_000),
  });
  const body: unknown = await response.json().catch(() => null);
  return {
    ok: response.ok,
    status: response.status,
    body:
      body && typeof body === 'object' && !Array.isArray(body)
        ? (body as Record<string, unknown>)
        : null,
  };
}

/** Runs the existing guarded bill-mcp payment flow for a system administrator. */
export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const supabase = createUserClient(request);
  if (supabase instanceof Response) return supabase;

  const billId = parseBillId((await ctx.params).id);
  const role = await callerRole(request, supabase);
  if (role instanceof Response) return role;
  const result = await runPaymentTrigger({
    billId,
    role,
    invoke: (id) => callBillMcp(request, id),
  });
  const body = result.status >= 400 ? { ...result.body, error: result.body.message } : result.body;
  return reply({ status: result.status, body });
}
