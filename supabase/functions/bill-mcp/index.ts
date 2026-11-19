import { createClient } from 'npm:@supabase/supabase-js@2';
import { persistReceipt } from './receipt.ts';
import { handleBillMcp } from './handle.ts';

function paymentAttempt(row: Record<string, unknown>) {
  const paymentId = row.payment_id;
  const billId = row.bill_id;
  const idempotencyKey = row.idempotency_key;
  if (typeof paymentId !== 'number' || typeof billId !== 'number' || typeof idempotencyKey !== 'string') return null;
  const paymentDate = String(row.payment_date ?? '').slice(0, 10);
  return {
    paymentId,
    billId,
    idempotencyKey,
    summary: {
      bill_id: billId,
      vendor_id: row.vendor_id,
      invoice_number: row.invoice_number,
      account_reference: row.account_reference ?? null,
      payment_method_id: row.payment_method_id,
      amount_cents: row.amount_cents,
      fees_cents: row.fees_cents,
      total_cents: row.total_cents,
      currency: row.currency,
      payment_date: paymentDate,
    },
  };
}

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
      // The attempt is claimed before /execute. canRecord stays off without the service
      // client, because prepare, start, and record_payment are service-role calls.
      canRecord: admin !== null,
      pendingBillIds: async () => {
        if (!admin) return [];
        const { data, error } = await admin
          .from('bills')
          .select('bill_id')
          .eq('status', 'pending_payment')
          .order('bill_id');
        if (error) throw error;
        return data.map((bill) => bill.bill_id);
      },
      billForAutomation: async (billId) => {
        if (!admin) return null;
        const { data, error } = await admin
          .from('bills')
          .select('bill_id,status,amount,vendor_id,invoice_number')
          .eq('bill_id', billId)
          .maybeSingle();
        return error ? null : data;
      },
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
        const { data } = await (admin ?? supabase)
          .from('vendors')
          .select('payment_portal_url')
          .eq('vendor_id', vendorId)
          .maybeSingle();
        return data?.payment_portal_url ?? null;
      },
      latestApproval: async (billId) => {
        const { data } = await (admin ?? supabase)
          .from('approvals')
          .select('status')
          .eq('bill_id', billId)
          .order('created_at', { ascending: false })
          .order('approval_id', { ascending: false })
          .limit(1)
          .maybeSingle();
        return data?.status ?? null;
      },
      preparePayment: async (billId) => {
        if (!admin) return { error: 'prepare_payment failed' };
        const token = userAuth.replace(/^Bearer\s+/i, '').trim();
        const user = token ? await supabase.auth.getUser(token) : { data: { user: null }, error: new Error('missing user') };
        const authId = user.data.user?.id;
        if (user.error || !authId) return { error: 'prepare_payment failed' };
        const profile = await admin.from('users').select('user_id').eq('auth_user_id', authId).maybeSingle();
        const preparedBy = profile.data?.user_id;
        if (profile.error || typeof preparedBy !== 'number') return { error: 'prepare_payment failed' };
        const { data, error } = await admin.rpc('prepare_payment', {
          p_bill_id: billId,
          p_prepared_by: preparedBy,
          p_fees_cents: 0,
          p_payment_date: new Date().toISOString().slice(0, 10),
        });
        if (error || !data || typeof data !== 'object') return { error: 'prepare_payment failed' };
        const attempt = paymentAttempt(data as Record<string, unknown>);
        return attempt ? { attempt } : { error: 'prepare_payment failed' };
      },
      prepareAutomatedPayment: async (billId) => {
        if (!admin) return { error: 'prepare_payment failed' };
        const { data: approval, error: approvalError } = await admin
          .from('approvals')
          .select('approved_by,status')
          .eq('bill_id', billId)
          .order('created_at', { ascending: false })
          .order('approval_id', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (approvalError || approval?.status !== 'approved' || typeof approval.approved_by !== 'number') {
          return { error: 'not_approved' };
        }
        const { data, error } = await admin.rpc('prepare_payment', {
          p_bill_id: billId,
          p_prepared_by: approval.approved_by,
          p_fees_cents: 0,
          p_payment_date: new Date().toISOString().slice(0, 10),
        });
        if (error || !data || typeof data !== 'object') return { error: 'prepare_payment failed' };
        const attempt = paymentAttempt(data as Record<string, unknown>);
        return attempt ? { attempt } : { error: 'prepare_payment failed' };
      },
      authorizePayment: async (attempt) => {
        const { error } = await supabase.rpc('authorize_payment', {
          p_payment_id: attempt.paymentId,
          p_summary: attempt.summary,
        });
        return error ? { error: 'authorize_payment failed' } : {};
      },
      authorizeAutomatedPayment: async (attempt) => {
        if (!admin) return { error: 'authorize_payment failed' };
        const { error } = await admin.rpc('authorize_approved_payment', {
          p_payment_id: attempt.paymentId,
        });
        return error ? { error: error.message || 'authorize_payment failed' } : {};
      },
      startSubmission: async (paymentId) => {
        if (!admin) return { error: 'start_payment_submission failed' };
        const { error } = await admin.rpc('start_payment_submission', { p_payment_id: paymentId });
        return error ? { error: 'start_payment_submission failed' } : {};
      },
      recordOutcome: async (outcome) => {
        if (!admin) return { error: 'record_payment failed' };
        const { data, error } = await admin.rpc('record_payment', {
          p_payment_id: outcome.paymentId,
          p_outcome: outcome.outcome,
          p_outcome_code: outcome.outcomeCode,
          p_transaction_reference: outcome.transactionReference,
          p_message: outcome.message,
        });
        if (error || !data || typeof data !== 'object') return { error: 'record_payment failed' };
        const row = data as Record<string, unknown>;
        if (typeof row.payment_id !== 'number' || typeof row.bill_id !== 'number' || typeof row.status !== 'string' || typeof row.idempotency_key !== 'string') {
          return { error: 'record_payment failed' };
        }
        return {
          payment: {
            payment_id: row.payment_id,
            bill_id: row.bill_id,
            status: row.status,
            idempotency_key: row.idempotency_key,
          },
        };
      },
    },
  );
  return json(result.body, result.status);
});
