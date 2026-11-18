import { createClient } from 'npm:@supabase/supabase-js@2';
import { persistReceipt } from './receipt.ts';
import { handleBillMcp, type PaymentInput } from './handle.ts';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseAnon = Deno.env.get('SUPABASE_ANON_KEY');
  if (!supabaseUrl || !supabaseAnon) return json({ error: "Agent isn't set up." }, 500);

  const userAuth = req.headers.get('x-user-authorization') ?? '';
  const supabase = createClient(supabaseUrl, supabaseAnon, {
    global: { headers: { Authorization: userAuth } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const admin = serviceKey
    ? createClient(supabaseUrl, serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : null;

  const result = await handleBillMcp(
    {
      httpMethod: req.method,
      authorization: req.headers.get('Authorization'),
      userAuthorization: userAuth,
      body: await req.json().catch(() => null),
    },
    {
      mcpToken: Deno.env.get('BILL_MCP_TOKEN'),
      clientUrl: Deno.env.get('CLIENT_URL') ?? 'http://localhost:3000',
      stagehandUrl: Deno.env.get('STAGEHAND_URL'),
      stagehandSecret: Deno.env.get('STAGEHAND_SECRET'),
      // DC-89: payments are written only through prepare_payment, authorize_payment,
      // start_payment_submission and record_payment, and #59's record_payment is gone. Until
      // DC-93 moves execute_approved_payment onto those functions it stays off here: it would
      // pay at the portal and then fail to record. It stops before /execute.
      canRecord: false,
      receiptPayment: async (billId, paymentId) => {
        const { data, error } = await supabase.rpc('get_payment_receipt', { p_bill_id: billId, p_payment_id: paymentId });
        return error ? null : { ...data, bill_id: data.billId };
      },
      persistReceipt: async (input, payment, receipt) => {
        if (!admin) return { status: 'failed', error: 'upload_failed' };
        return persistReceipt(input, payment, receipt, {
          upload: async (path, bytes) => {
            const { error } = await admin.storage.from('payment-receipts').upload(path, bytes, { contentType: 'image/png', upsert: false });
            if (!error) return 'stored';
            if (String(error.statusCode) === '409') return 'exists';
            throw error;
          },
          download: async (path) => {
            const { data, error } = await admin.storage.from('payment-receipts').download(path);
            if (error || !data) throw error ?? new Error('Receipt unavailable');
            return new Uint8Array(await data.arrayBuffer());
          },
          attach: async (paymentId, input, path, error) => {
            const response = await admin.rpc('set_payment_receipt', {
              p_payment_id: paymentId, p_bill_id: input.billId, p_idempotency_key: input.idempotencyKey,
              p_path: path, p_error: error,
            });
            if (response.error) throw response.error;
          },
        });
      },
      fetch,
      portalUrl: async (vendorId) => {
        const { data } = await supabase
          .from('vendors')
          .select('payment_portal_url')
          .eq('vendor_id', vendorId)
          .maybeSingle();
        return data?.payment_portal_url ?? null;
      },
      latestApproval: async (billId) => {
        const { data } = await supabase
          .from('approvals')
          .select('status')
          .eq('bill_id', billId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        return data?.status ?? null;
      },
      recordPayment: async (input: PaymentInput) => {
        if (!admin) return { error: 'record_payment failed' };
        const { data, error } = await admin.rpc('record_payment', {
          p_bill_id: input.billId,
          p_amount: input.amount,
          p_vendor_id: input.vendorId,
          p_invoice_number: input.invoiceNumber,
          p_idempotency_key: input.idempotencyKey,
        });
        if (error) return { error: 'record_payment failed' };
        return { payment: data };
      },
    },
  );
  return json(result.body, result.status);
});
