import { createClient } from 'npm:@supabase/supabase-js@2';
import { persistReceipt } from './receipt.ts';
import { handleBillMcp } from './handle.ts';

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
      callerUserId: async () => {
        const { data: auth } = await supabase.auth.getUser();
        if (!auth.user) return null;
        const { data: profile } = await supabase
          .from('users')
          .select('user_id')
          .eq('auth_user_id', auth.user.id)
          .maybeSingle();
        return profile?.user_id ?? null;
      },
      // prepare_payment, authorize_approved_payment, start_payment_submission, record_payment and
      // send_bill_for_approval are service_role only, and evaluate_bill_policy runs as the service
      // client too; authorize_payment and cancel_payment run as the signed-in caller.
      rpc: async (name, args, as) => {
        const client = as === 'user' ? supabase : admin;
        if (!client) return { data: null, error: { message: 'worker not configured' } };
        const { data, error } = await client.rpc(name, args);
        // The code tells a function's refusal (PT409 …) from a lost reply (''), which may be retried.
        return { data, error: error && { message: error.message, details: error.details, code: error.code } };
      },
      // The hourly sweep has no user session: it reads bills and approvals with the service client.
      pendingBillIds: admin
        ? async () => {
            const { data, error } = await admin
              .from('bills')
              .select('bill_id')
              .eq('status', 'pending_payment')
              .order('bill_id');
            if (error) throw error;
            return data.map((row) => row.bill_id);
          }
        : undefined,
      serviceBill: admin
        ? async (billId) => {
            const { data, error } = await admin
              .from('bills')
              .select('bill_id,status,amount,vendor_id,invoice_number,payment_method_id')
              .eq('bill_id', billId)
              .maybeSingle();
            return error ? null : data;
          }
        : undefined,
      latestApprover: admin
        ? async (billId) => {
            const { data, error } = await admin
              .from('approvals')
              .select('approved_by,status')
              .eq('bill_id', billId)
              .order('created_at', { ascending: false })
              .order('approval_id', { ascending: false })
              .limit(1)
              .maybeSingle();
            if (error || data?.status !== 'approved' || typeof data.approved_by !== 'number') return null;
            return data.approved_by;
          }
        : undefined,
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
      // The vendor comes from a bill the caller (or the sweep's service client) already read.
      portalUrl: async (vendorId) => {
        const { data } = await (admin ?? supabase)
          .from('vendors')
          .select('payment_portal_url')
          .eq('vendor_id', vendorId)
          .maybeSingle();
        return data?.payment_portal_url ?? null;
      },
    },
  );
  return json(result.body, result.status);
});
