import type { NextRequest } from 'next/server';
import { parseBillId } from '@/lib/bill-view';
import { createUserClient, reply, replyWithError } from '@/lib/supabase';

/** Five-minute access to a private receipt, subject to the shared database authorization. */
export async function GET(
  request: NextRequest,
  ctx: RouteContext<'/api/bills/[id]/payments/[paymentId]/receipt'>,
) {
  const supabase = createUserClient(request);
  if (supabase instanceof Response) return supabase;
  const params = await ctx.params;
  const billId = parseBillId(params.id);
  const paymentId = parseBillId(params.paymentId);
  if (billId === null || paymentId === null)
    return reply({ status: 404, body: { error: 'Receipt not found.' } });
  const { data, error } = await supabase.rpc('get_payment_receipt', {
    p_bill_id: billId,
    p_payment_id: paymentId,
  });
  if (error?.code === 'PT404') return reply({ status: 404, body: { error: 'Receipt not found.' } });
  if (error) return replyWithError(error, 'Could not load receipt.');
  if (!data?.receipt_path)
    return reply({
      status: 404,
      body: {
        error: 'Receipt is not available.',
        receiptStatus: data?.receipt_status ?? 'unavailable',
      },
    });
  const { data: signed, error: signError } = await supabase.storage
    .from('payment-receipts')
    .createSignedUrl(data.receipt_path, 300);
  if (signError) return replyWithError(signError, 'Could not load receipt.');
  return reply({ body: { url: signed.signedUrl } });
}
