import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SupabaseExecutionStore } from '../src/payments/supabase-execution-store';

const input = {
  billId: 7,
  vendorId: 9,
  portalUrl: 'https://portal.example.test/pay',
  amount: 125,
  invoiceNumber: 'INV-7',
  idempotencyKey: 'payment-7',
};

test('Supabase execution claims use hashed keys and guarded transitions', async () => {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const responses = [
    { data: { status: 'claimed' }, error: null },
    { data: true, error: null },
    { data: true, error: null },
  ];
  const store = new SupabaseExecutionStore({
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      return responses.shift()!;
    },
  });
  const claim = await store.claim(input, 12500);
  await claim.submitting();
  await claim.confirmed({ confirmed: true });

  assert.equal(calls[0].name, 'claim_stagehand_execution');
  assert.match(String(calls[0].args.p_key_hash), /^[a-f0-9]{64}$/);
  assert.equal(String(calls[0].args.p_key_hash).includes(input.idempotencyKey), false);
  assert.deepEqual(
    calls.slice(1).map((call) => call.args.p_to_state),
    ['submitting', 'confirmed'],
  );
});

test('Supabase confirmed claim replays without another browser execution', async () => {
  const result = { confirmed: true as const, receipt: { status: 'failed' as const } };
  const store = new SupabaseExecutionStore({
    rpc: async () => ({ data: { status: 'replay', result }, error: null }),
  });
  assert.deepEqual((await store.claim(input, 12500)).replay, result);
});

test('Supabase claim conflicts and unknown outcomes fail closed', async () => {
  for (const status of ['conflict', 'outcome_unknown']) {
    const store = new SupabaseExecutionStore({
      rpc: async () => ({ data: { status }, error: null }),
    });
    await assert.rejects(store.claim(input, 12500), {
      status: 409,
      code: status === 'conflict' ? 'idempotency_conflict' : 'outcome_unknown',
    });
  }
});

test('Supabase outages fail closed before a browser can open', async () => {
  const store = new SupabaseExecutionStore({
    rpc: async () => ({ data: null, error: { message: 'offline' } }),
  });
  await assert.rejects(store.claim(input, 12500), { status: 503, code: 'portal_error' });
});
