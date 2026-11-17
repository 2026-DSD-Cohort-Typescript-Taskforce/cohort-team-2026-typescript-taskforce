// Concurrency tests for the DC-89 payment functions, through the real API (PostgREST RPC).
// pgTAP can't run two transactions at once, so the races are proved here. They run against a
// LOCAL Supabase (`supabase start`, then `npm run seed:local-users`) and refuse any other URL.
//
//   cd server && npx tsx --test test/payments-concurrency.test.ts
//
// Needs SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY and SEED_USER_PASSWORD.
// Each test inserts fresh bills and payment attempts. Payments can't be deleted, so the rows
// stay in the local DB; `supabase db reset` clears them.
import 'dotenv/config';
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY, SEED_USER_PASSWORD } =
  process.env;
const TEST_USER_EMAIL = process.env.TEST_USER_EMAIL ?? 'alex.morgan@example.com';
if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY || !SUPABASE_SECRET_KEY || !SEED_USER_PASSWORD) {
  throw new Error(
    'Set SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY and SEED_USER_PASSWORD.',
  );
}
if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(SUPABASE_URL).hostname)) {
  throw new Error('Refusing to run payment tests against a non-local Supabase.');
}

const NON_VIEWER_ROLES = ['billing_operator', 'financial_approver', 'system_admin'];
const OPEN_STATUSES = ['pending', 'authorized', 'processing', 'unknown'];
const AMOUNT_DOLLARS = 120;
const FEES_CENTS = 250;

const options = { auth: { autoRefreshToken: false, persistSession: false } };
// Service client: the trusted backend. User client: the signed-in person who authorizes.
const service = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, options);
const user = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, options);

type Payment = { payment_id: number; bill_id: number; status: string; outcome_code: string | null };
type RpcResult = { data: Payment | null; error: { code: string; message: string } | null };

let userId: number;
let vendorId: number;
let propertyId: number;
let methodId: number;
let billCount = 0;

// Unwraps a supabase-js result; the caller names the row shape (no generated DB types here).
async function must<T>(promise: PromiseLike<{ data: unknown; error: unknown }>): Promise<T> {
  const { data, error } = await promise;
  if (error) throw new Error(JSON.stringify(error));
  assert.ok(data);
  return data as T;
}

function rpc(client: SupabaseClient, fn: string, args: Record<string, unknown>) {
  return client.rpc(fn, args).single<Payment>() as unknown as PromiseLike<RpcResult>;
}

// One fresh payable bill per call, from the seeded vendor, property and payment method.
async function newBill(): Promise<number> {
  billCount += 1;
  const bill = await must<{ bill_id: number }>(
    service
      .from('bills')
      .insert({
        status: 'pending_payment',
        vendor_id: vendorId,
        property_id: propertyId,
        payment_method_id: methodId,
        user_id: userId,
        amount: AMOUNT_DOLLARS,
        invoice_number: `DC89-CONC-${Date.now()}-${billCount}`,
      })
      .select('bill_id')
      .single(),
  );
  return bill.bill_id;
}

function prepare(billId: number) {
  return rpc(service, 'prepare_payment', {
    p_bill_id: billId,
    p_prepared_by: userId,
    p_fees_cents: FEES_CENTS,
    p_payment_date: new Date().toISOString().slice(0, 10),
  });
}

async function prepared(billId: number): Promise<Payment> {
  const { data, error } = await prepare(billId);
  assert.equal(error, null);
  assert.ok(data);
  return data;
}

// Authorizes with the exact summary the database computes for the attempt.
async function authorize(paymentId: number): Promise<Payment> {
  const row = await must<{ payment_summary: unknown }>(
    service.from('payments').select('payment_summary').eq('payment_id', paymentId).single(),
  );
  const { data, error } = await rpc(user, 'authorize_payment', {
    p_payment_id: paymentId,
    p_summary: row.payment_summary,
  });
  assert.equal(error, null);
  assert.ok(data);
  assert.equal(data.status, 'authorized');
  return data;
}

async function attempts(billId: number): Promise<Payment[]> {
  return must<Payment[]>(
    service
      .from('payments')
      .select('payment_id, bill_id, status, outcome_code')
      .eq('bill_id', billId),
  );
}

async function billStatus(billId: number): Promise<string> {
  const bill = await must<{ status: string }>(
    service.from('bills').select('status').eq('bill_id', billId).single(),
  );
  return bill.status;
}

before(async () => {
  const profile = await must<{ user_id: number; role: string }>(
    service.from('users').select('user_id, role').eq('email', TEST_USER_EMAIL).single(),
  );
  assert.ok(NON_VIEWER_ROLES.includes(profile.role), `${TEST_USER_EMAIL} must not be a viewer`);
  userId = profile.user_id;
  vendorId = (
    await must<{ vendor_id: number }>(
      service.from('vendors').select('vendor_id').order('vendor_id').limit(1).single(),
    )
  ).vendor_id;
  propertyId = (
    await must<{ property_id: number }>(
      service.from('properties').select('property_id').order('property_id').limit(1).single(),
    )
  ).property_id;
  methodId = (
    await must<{ payment_method_id: number }>(
      service
        .from('payment_methods')
        .select('payment_method_id')
        .order('payment_method_id')
        .limit(1)
        .single(),
    )
  ).payment_method_id;

  let { error } = await user.auth.signInWithPassword({
    email: TEST_USER_EMAIL,
    password: SEED_USER_PASSWORD,
  });
  if (error) {
    // Local Auth can time out under memory pressure; retry once.
    ({ error } = await user.auth.signInWithPassword({
      email: TEST_USER_EMAIL,
      password: SEED_USER_PASSWORD,
    }));
  }
  assert.equal(error, null);
});

describe('payment functions under concurrency', () => {
  it('two concurrent prepare_payment calls leave exactly one open attempt', async () => {
    const billId = await newBill();
    const results = await Promise.all([prepare(billId), prepare(billId)]);
    for (const result of results) assert.equal(result.error, null);

    const rows = await attempts(billId);
    assert.equal(rows.length, 2);
    assert.equal(rows.filter((row) => row.status === 'pending').length, 1);
    const expired = rows.filter((row) => row.status === 'expired');
    assert.equal(expired.length, 1);
    assert.equal(expired[0].outcome_code, 'superseded');
  });

  it('two concurrent start_payment_submission calls claim once', async () => {
    const billId = await newBill();
    const { payment_id } = await authorizedAttempt(billId);
    const results = await Promise.allSettled([
      rpc(service, 'start_payment_submission', { p_payment_id: payment_id }),
      rpc(service, 'start_payment_submission', { p_payment_id: payment_id }),
    ]);
    const settled = results.map((result) => {
      assert.equal(result.status, 'fulfilled');
      return (result as PromiseFulfilledResult<RpcResult>).value;
    });
    const won = settled.filter((result) => !result.error);
    const lost = settled.filter((result) => result.error);
    assert.equal(won.length, 1);
    assert.equal(won[0].data?.status, 'processing');
    assert.equal(lost.length, 1);
    assert.equal(lost[0].error?.code, 'PT409');
    assert.equal(lost[0].error?.message, 'not_authorized');
  });

  it('two concurrent record_payment calls record once', async () => {
    const billId = await newBill();
    const { payment_id } = await authorizedAttempt(billId);
    const started = await rpc(service, 'start_payment_submission', { p_payment_id: payment_id });
    assert.equal(started.error, null);

    const record = () =>
      rpc(service, 'record_payment', {
        p_payment_id: payment_id,
        p_outcome: 'success',
        p_outcome_code: 'confirmed',
        p_transaction_reference: `TXN-${payment_id}`,
      });
    const results = await Promise.all([record(), record()]);
    const won = results.filter((result) => !result.error);
    const lost = results.filter((result) => result.error);
    assert.equal(won.length, 1);
    assert.equal(won[0].data?.status, 'success');
    assert.equal(lost.length, 1);
    assert.equal(lost[0].error?.code, 'PT409');
    assert.equal(lost[0].error?.message, 'not_processing');
    assert.equal(await billStatus(billId), 'payment_success');
  });

  // R7: a claim racing a re-preparation of the same bill must not deadlock (40P01). Both
  // functions lock the bill first, then the attempt, so one waits for the other.
  it('a concurrent prepare_payment and start_payment_submission never deadlock', async () => {
    for (let i = 0; i < 5; i += 1) {
      const billId = await newBill();
      const { payment_id } = await authorizedAttempt(billId);
      const results = await Promise.allSettled([
        prepare(billId),
        rpc(service, 'start_payment_submission', { p_payment_id: payment_id }),
      ]);
      for (const result of results) {
        assert.equal(result.status, 'fulfilled');
        const { error } = (result as PromiseFulfilledResult<RpcResult>).value;
        // 40P01 would be a deadlock; anything but success or a documented PT409 fails.
        assert.notEqual(error?.code, '40P01');
        if (error) assert.equal(error.code, 'PT409', JSON.stringify(error));
      }
      // Exactly one wins: if prepare won, the claim sees the superseded attempt (not_authorized);
      // if the claim won, prepare sees it processing (payment_in_progress).
      const [prepareResult, startResult] = results.map(
        (result) => (result as PromiseFulfilledResult<RpcResult>).value,
      );
      const succeeded = [prepareResult, startResult].filter((r) => !r.error);
      assert.equal(succeeded.length, 1, `bill ${billId}: ${JSON.stringify(results)}`);
      if (prepareResult.error) {
        assert.equal(prepareResult.error.code, 'PT409');
        assert.equal(prepareResult.error.message, 'payment_in_progress');
      } else {
        assert.equal(startResult.error?.code, 'PT409');
        assert.equal(startResult.error?.message, 'not_authorized');
      }
      const open = (await attempts(billId)).filter((row) => OPEN_STATUSES.includes(row.status));
      assert.ok(open.length <= 1, `bill ${billId} has ${open.length} open attempts`);
    }
  });
});

async function authorizedAttempt(billId: number): Promise<Payment> {
  const attempt = await prepared(billId);
  return authorize(attempt.payment_id);
}
