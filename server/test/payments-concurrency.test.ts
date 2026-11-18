// Concurrency tests for the DC-89 payment functions, through the real API (PostgREST RPC).
// pgTAP can't run two transactions at once, so the races are proved here. They run against a
// LOCAL Supabase (`supabase start`, then `npm run seed:local-users`) and refuse any other URL.
//
//   cd server && npx tsx --test test/payments-concurrency.test.ts
//
// Needs SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY, SEED_USER_PASSWORD and
// SUPABASE_DB_URL ("DB URL" in `supabase status`), plus `psql` on the PATH: the lock-wait test
// holds a bill lock from its own database session.
// Each test inserts fresh bills and payment attempts. Payments can't be deleted, so the rows
// stay in the local DB; `supabase db reset` clears them.
import 'dotenv/config';
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { before, describe, it } from 'node:test';
import { promisify } from 'node:util';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const {
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY,
  SUPABASE_SECRET_KEY,
  SEED_USER_PASSWORD,
  SUPABASE_DB_URL,
} = process.env;
const TEST_USER_EMAIL = process.env.TEST_USER_EMAIL ?? 'alex.morgan@example.com';
if (
  !SUPABASE_URL ||
  !SUPABASE_PUBLISHABLE_KEY ||
  !SUPABASE_SECRET_KEY ||
  !SEED_USER_PASSWORD ||
  !SUPABASE_DB_URL
) {
  throw new Error(
    'Set SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY, SEED_USER_PASSWORD and SUPABASE_DB_URL.',
  );
}
const LOCAL_HOSTS = ['127.0.0.1', 'localhost', '[::1]'];
if (![SUPABASE_URL, SUPABASE_DB_URL].every((url) => LOCAL_HOSTS.includes(new URL(url).hostname))) {
  throw new Error('Refusing to run payment tests against a non-local Supabase.');
}
const PSQL_ARGS = [SUPABASE_DB_URL, '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'];

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

  // now() is frozen when a transaction starts. A claim that starts before the authorization
  // expires, then waits for the bill lock until after it, must still be refused.
  it('a claim that waits for the bill lock past the expiry is refused', async () => {
    const billId = await newBill();
    const { payment_id } = await authorizedAttempt(billId);
    // Test-only shortcut (marker on, as the local superuser): expire in 3 s, not 15 min.
    await psql(
      "select set_config('app.payments_write', 'on', false)",
      `update public.payments set authorization_expires_at = clock_timestamp() + interval '3 seconds'
        where payment_id = ${payment_id}`,
    );

    const lock = await holdBillLock(billId);
    const claim = Promise.resolve(
      rpc(service, 'start_payment_submission', { p_payment_id: payment_id }),
    );
    // The claim's transaction is waiting on the lock, and it began before the expiry.
    const margin = await waitForRow(
      `select extract(epoch from p.authorization_expires_at - a.xact_start)
         from pg_stat_activity a, public.payments p
        where p.payment_id = ${payment_id} and ${lock.pid} = any(pg_blocking_pids(a.pid))`,
      'the claim to wait for the bill lock',
    );
    assert.ok(Number(margin) > 0, `the claim began ${margin} s before the expiry`);
    await waitForRow(
      `select 1 from public.payments
        where payment_id = ${payment_id} and clock_timestamp() > authorization_expires_at`,
      'the authorization to expire',
    );
    await lock.release();

    const { error } = await claim;
    assert.equal(error?.code, 'PT409', JSON.stringify(error));
    assert.equal(error?.message, 'authorization_expired');
    const [row] = await attempts(billId);
    assert.equal(row.status, 'authorized');
    assert.equal(await billStatus(billId), 'pending_payment');
  });
});

async function authorizedAttempt(billId: number): Promise<Payment> {
  const attempt = await prepared(billId);
  return authorize(attempt.payment_id);
}

// Runs SQL as the local superuser in one psql session; returns the output lines.
async function psql(...commands: string[]): Promise<string[]> {
  const { stdout } = await promisify(execFile)('psql', [
    ...PSQL_ARGS,
    ...commands.flatMap((command) => ['-c', command]),
  ]);
  return stdout.trim().split('\n').filter(Boolean);
}

// Polls until the query returns a row; returns its first line.
async function waitForRow(query: string, what: string, timeoutMs = 5000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const [line] = await psql(query);
    if (line) return line;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`timed out waiting for ${what}`);
}

// Locks the bill row in a separate psql session and keeps the transaction open until release().
async function holdBillLock(
  billId: number,
): Promise<{ pid: number; release: () => Promise<void> }> {
  const child = spawn('psql', PSQL_ARGS, { stdio: ['pipe', 'pipe', 'inherit'] });
  const exited = new Promise<number | null>((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', resolve);
  });
  const firstLine = new Promise<string>((resolve, reject) => {
    let out = '';
    child.stdout.on('data', (chunk: Buffer) => {
      out += chunk.toString();
      if (out.includes('\n')) resolve(out.split('\n')[0]);
    });
    exited.then((code) => reject(new Error(`psql exited with ${code}`)), reject);
  });
  child.stdin.write(
    `begin;\nselect pg_backend_pid() from public.bills where bill_id = ${billId} for update;\n`,
  );
  const pid = Number(await firstLine);
  assert.ok(pid > 0, 'the lock session reports its backend pid');
  return {
    pid,
    release: async () => {
      child.stdin.end('rollback;\n');
      assert.equal(await exited, 0);
    },
  };
}
