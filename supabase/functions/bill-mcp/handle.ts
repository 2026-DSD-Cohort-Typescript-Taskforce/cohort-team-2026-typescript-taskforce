import type { ReceiptResult } from './receipt.ts';
// bill-mcp request handling. The Deno entrypoint wires Supabase and fetch;
// these functions stay free of Deno so the gate can be tested in Node.

export type McpResult = { status: number; body: unknown };

export type PaymentInput = {
  billId: number;
  amount: number;
  vendorId: number;
  invoiceNumber: string;
  idempotencyKey: string;
};

// The DC-89 payment functions bill-mcp calls (supabase/migrations/20261117200000_payment_attempts.sql).
export type RpcName = 'prepare_payment' | 'authorize_payment' | 'cancel_payment' | 'start_payment_submission' | 'record_payment';
export type RpcReply = { data: unknown; error: { message: string; details?: string | null } | null };

export type BillMcpDeps = {
  mcpToken: string | undefined;
  clientUrl: string;
  stagehandUrl: string | undefined;
  stagehandSecret: string | undefined;
  persistReceipt?: (input: PaymentInput, payment: unknown, receipt: unknown) => Promise<ReceiptResult>;
  receiptPayment?: (billId: number, paymentId: number) => Promise<(PaymentInput & { payment_id: number; bill_id: number; status: string }) | null>;
  fetch: typeof fetch;
  portalUrl: (vendorId: number) => Promise<string | null>;
  // users.user_id of the signed-in caller, or null when the login has no profile.
  callerUserId: () => Promise<number | null>;
  // 'service' runs as service_role; 'user' runs as the signed-in caller.
  rpc: (name: RpcName, args: Record<string, unknown>, as: 'service' | 'user') => Promise<RpcReply>;
  executeTimeoutMs?: number;
};

type Bill = {
  bill_id: number;
  status: string;
  amount: number | string | null;
  vendor_id: number | null;
  invoice_number: string | null;
};

// A payments row as the DC-89 functions return it.
type Attempt = {
  payment_id: number;
  bill_id: number;
  vendor_id: number;
  invoice_number: string;
  amount_cents: number;
  idempotency_key: string;
} & Record<string, unknown>;

// The vendor, invoice and amount the admin confirmed in the trigger dialog.
type Shown = { billId: number; vendorId: number; invoiceNumber: string; cents: number };

type Outcome = {
  outcome: 'success' | 'failure' | 'unknown';
  code: 'confirmed' | 'payment_mismatch' | 'portal_error' | 'not_submitted' | 'outcome_unknown';
  reference: string | null;
  message: string | null;
  receipt?: unknown;
};

const PAYABLE_STATUSES = ['pending_payment', 'payment_failed'];

// authorize_payment's summary keys, as payment_summary() in the DC-89 migration builds them.
const SUMMARY_KEYS = ['bill_id', 'vendor_id', 'invoice_number', 'account_reference', 'payment_method_id',
  'amount_cents', 'fees_cents', 'total_cents', 'currency', 'payment_date'];

// Payment-function errors returned to the caller as they are. Any other error, including
// authorize_payment's summary_mismatch (bill-mcp echoes the prepared row unchanged), is
// payment_not_started.
const RPC_CODES = new Set(['forbidden', 'not_found', 'invalid_payment', 'payment_in_progress', 'already_paid',
  'not_payable', 'not_pending', 'not_prepared', 'summary_stale', 'not_authorized', 'authorization_expired',
  'worker not configured']);

const TOOLS = [
  { name: 'get_bill' },
  { name: 'list_vendors' },
  { name: 'observe_portal' },
  { name: 'execute_approved_payment' },
  { name: 'retry_payment_receipt' },
];

// Logs the status and codes only: payment rows hold references (DC-102 keeps them out of logs).
function result(body: unknown, status = 200): McpResult {
  const failed =
    status >= 400 || (body !== null && typeof body === 'object' && 'error' in body);
  if (failed) {
    const { error, outcome_code, fields } = (body ?? {}) as Record<string, unknown>;
    console.error(`[bill-mcp] ${status} ${JSON.stringify({ error, outcome_code, fields })}`);
  }
  return { status, body };
}

function sessionCookie(userAuth: string) {
  const token = userAuth.replace(/^Bearer\s+/i, '');
  return `sb-access-token=${encodeURIComponent(token)}`;
}

function joinUrl(base: string, path: string) {
  return `${base.replace(/\/$/, '')}${path}`;
}

function integer(value: unknown): number | null {
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) value = Number(value);
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
}

function field(args: Record<string, unknown>, ...names: string[]) {
  for (const name of names) if (args[name] !== undefined) return args[name];
  return undefined;
}

function moneyCents(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const cents = Math.round(value * 100);
    return Math.abs(value * 100 - cents) < 1e-6 ? cents : null;
  }
  if (typeof value === 'string' && /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(value)) {
    const [whole, fraction = ''] = value.split('.');
    return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  }
  return null;
}

function argsOf(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object') return {};
  const params = (body as { params?: { arguments?: unknown } }).params;
  const args = params?.arguments;
  return args && typeof args === 'object' ? (args as Record<string, unknown>) : {};
}

function toolName(body: unknown): string {
  if (!body || typeof body !== 'object') return '';
  const name = (body as { params?: { name?: unknown } }).params?.name;
  return typeof name === 'string' ? name : '';
}

async function appGet(deps: BillMcpDeps, userAuth: string, path: string) {
  const response = await deps.fetch(joinUrl(deps.clientUrl, path), {
    headers: { cookie: sessionCookie(userAuth) },
  });
  if (!response.ok) return { error: response.status };
  return response.json();
}

async function loadBill(deps: BillMcpDeps, userAuth: string, billId: number) { 
  const loaded: { bill?: Bill; error?: number } = await appGet(deps, userAuth, `/api/bills/${billId}`);
  if (loaded.error !== undefined || !loaded.bill) return { error: loaded.error ?? 'not_found' };
  return { bill: loaded.bill };
} 

async function observePortal(deps: BillMcpDeps, userAuth: string, billId: number) {
  const loaded = await loadBill(deps, userAuth, billId);
  if ('error' in loaded) return loaded;
  const stagehand = deps.stagehandUrl;
  if (!stagehand) return { error: 'worker not configured' };
  const portalUrl = await deps.portalUrl(loaded.bill.vendor_id ?? 0);
  if (!portalUrl) return { error: 'no portal url' };
  const response = await deps.fetch(joinUrl(stagehand, '/observe'), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${deps.stagehandSecret ?? ''}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ billId: loaded.bill.bill_id, portalUrl }),
  });
  if (!response.ok) return { error: 'worker failed' };
  return { observation: await response.text() };
}

function pageText(raw: string) {
  try {
    const parsed = JSON.parse(raw) as { pageText?: unknown };
    if (typeof parsed.pageText === 'string') return parsed.pageText;
  } catch {
    // The worker may already return plain page text.
  }
  return raw;
}

function pageHasPhrase(text: string, phrase: string) {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|\\W)${escaped}(?:$|\\W)`).test(text);
}

function pageHasAmount(text: string, cents: number) {
  const dollars = Math.floor(Math.abs(cents) / 100).toString();
  const fraction = String(Math.abs(cents) % 100).padStart(2, '0');
  const grouped = dollars.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return new RegExp(`(?<![\\d.])\\$?\\s*${grouped}\\.${fraction}(?!\\d)`).test(text);
}

function snapshotGaps(bill: Bill, text: string) {
  const gaps: string[] = [];
  const cents = moneyCents(bill.amount);
  if (cents === null || !pageHasAmount(text, cents)) gaps.push('amount');
  if (!bill.invoice_number || !pageHasPhrase(text, bill.invoice_number)) gaps.push('invoice_number');
  return gaps;
}

async function readPortal(deps: BillMcpDeps, bill: Bill) {
  if (bill.vendor_id === null) return { error: 'no portal url' as const };
  const portalUrl = await deps.portalUrl(bill.vendor_id);
  if (!portalUrl) return { error: 'no portal url' as const };
  if (!deps.stagehandUrl) return { error: 'worker not configured' as const };
  const response = await deps.fetch(joinUrl(deps.stagehandUrl, '/observe'), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${deps.stagehandSecret ?? ''}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ billId: bill.bill_id, portalUrl }),
  });
  if (!response.ok) return { error: 'worker failed' as const };
  return { portalUrl, text: pageText(await response.text()) };
}

function shownPayment(args: Record<string, unknown>): Shown | null {
  const billId = integer(field(args, 'bill_id', 'billId'));
  const vendorId = integer(field(args, 'vendor_id', 'vendorId'));
  const invoiceNumber = field(args, 'invoice_number', 'invoiceNumber');
  const cents = moneyCents(args.amount);
  if (billId === null || vendorId === null || cents === null) return null;
  if (typeof invoiceNumber !== 'string' || invoiceNumber.trim() === '') return null;
  return { billId, vendorId, invoiceNumber, cents };
}

// The fields where a bill or a prepared attempt differs from what the admin was shown, in this order.
function shownGaps(shown: Shown, vendorId: unknown, invoiceNumber: unknown, cents: unknown) {
  const gaps: string[] = [];
  if (vendorId !== shown.vendorId) gaps.push('vendor_id');
  if (invoiceNumber !== shown.invoiceNumber) gaps.push('invoice_number');
  if (cents !== shown.cents) gaps.push('amount');
  return gaps;
}

function policyRefsFor(_bill: Bill): number[] {
  // DC-92: return the ids of the policies evaluated for this bill.
  return [];
}

function isAttempt(data: unknown): data is Attempt {
  if (!data || typeof data !== 'object') return false;
  const row = data as Record<string, unknown>;
  return Number.isSafeInteger(row.payment_id) && typeof row.idempotency_key === 'string' && row.idempotency_key !== '';
}

function paymentInput(attempt: Attempt): PaymentInput {
  return {
    billId: attempt.bill_id,
    amount: attempt.amount_cents / 100,
    vendorId: attempt.vendor_id,
    invoiceNumber: attempt.invoice_number,
    idempotencyKey: attempt.idempotency_key,
  };
}

// A throw counts as an error reply: before the claim it cancels the attempt, after it the result
// is record_payment failed.
async function callRpc(deps: BillMcpDeps, name: RpcName, args: Record<string, unknown>, as: 'service' | 'user'): Promise<RpcReply> {
  try {
    return await deps.rpc(name, args, as);
  } catch (error) {
    return { data: null, error: { message: error instanceof Error ? error.message : String(error) } };
  }
}

// What a payment-function error before the claim returns. Nothing has been charged.
function rpcStop(name: RpcName, error: NonNullable<RpcReply['error']>) {
  if (RPC_CODES.has(error.message)) return { error: error.message };
  console.error(`[bill-mcp] ${name} failed: ${error.message}`);
  return { error: 'payment_not_started' };
}

// Withdraws an attempt that will not be claimed. Best effort: one left behind is superseded by
// the bill's next prepare_payment.
async function cancelAndStop<T extends { error: string }>(deps: BillMcpDeps, attempt: Attempt, stop: T) {
  await callRpc(deps, 'cancel_payment', { p_payment_id: attempt.payment_id, p_note: stop.error }, 'user');
  return stop;
}

async function prepareAttempt(deps: BillMcpDeps, bill: Bill, preparedBy: number, shown: Shown) {
  const prepared = await callRpc(deps, 'prepare_payment', {
    p_bill_id: bill.bill_id,
    p_prepared_by: preparedBy,
    p_fees_cents: 0,
    p_payment_date: new Date().toISOString().slice(0, 10),
    p_account_reference: null,
    p_policy_refs: policyRefsFor(bill),
  }, 'service');
  if (prepared.error) return rpcStop('prepare_payment', prepared.error);
  if (!isAttempt(prepared.data)) return rpcStop('prepare_payment', { message: 'no payment row returned' });
  const attempt = prepared.data;
  const gaps = shownGaps(shown, attempt.vendor_id, attempt.invoice_number, attempt.amount_cents);
  if (gaps.length > 0) return cancelAndStop(deps, attempt, { error: 'summary_mismatch', fields: gaps });
  return { attempt };
}

// The admin's explicit yes on the prepared summary, then the atomic claim. A refusal cancels the
// attempt and returns its code; nothing was charged. null means the attempt is claimed.
async function authorizeAndClaim(deps: BillMcpDeps, attempt: Attempt) {
  const summary = Object.fromEntries(SUMMARY_KEYS.map((key) => [key, attempt[key]]));
  const authorized = await callRpc(deps, 'authorize_payment', { p_payment_id: attempt.payment_id, p_summary: summary }, 'user');
  if (authorized.error) return cancelAndStop(deps, attempt, rpcStop('authorize_payment', authorized.error));
  const claimed = await callRpc(deps, 'start_payment_submission', { p_payment_id: attempt.payment_id }, 'service');
  if (claimed.error) return cancelAndStop(deps, attempt, rpcStop('start_payment_submission', claimed.error));
  return null;
}

function unknownOutcome(message: string | null): Outcome {
  return { outcome: 'unknown', code: 'outcome_unknown', reference: null, message };
}

// Only a confirmed reply with a usable reference is a success, and only the worker's own refusals
// are failures. Anything else may have charged, so it is unknown.
async function workerOutcome(response: Response): Promise<Outcome> {
  type Reply = { confirmed?: unknown; transactionReference?: unknown; receipt?: unknown; code?: unknown };
  const body = (await response.json().catch(() => null)) as Reply | null;
  if (response.ok) {
    const reference = typeof body?.transactionReference === 'string' ? body.transactionReference.trim() : '';
    if (body?.confirmed === true && reference.length > 0 && reference.length <= 255) {
      return { outcome: 'success', code: 'confirmed', reference, message: null, receipt: body.receipt };
    }
    return unknownOutcome('worker confirmed without a usable transaction reference');
  }
  const code = body?.code;
  if (code === 'payment_mismatch' || code === 'portal_error') {
    return { outcome: 'failure', code, reference: null, message: null };
  }
  if (code === 'invalid_request' || code === 'unauthorized' || code === 'idempotency_conflict') {
    return { outcome: 'failure', code: 'not_submitted', reference: null, message: null };
  }
  return unknownOutcome(null);
}

async function runWorker(deps: BillMcpDeps, stagehandUrl: string, portalUrl: string, attempt: Attempt): Promise<Outcome> {
  let response: Response;
  try {
    response = await deps.fetch(joinUrl(stagehandUrl, '/execute'), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${deps.stagehandSecret ?? ''}`,
        'Content-Type': 'application/json',
      },
      // The attempt's own amount, vendor, invoice and idempotency key.
      body: JSON.stringify({ ...paymentInput(attempt), portalUrl }),
      // Short of the trigger route's 140 s limit, so the outcome is still recorded.
      signal: AbortSignal.timeout(deps.executeTimeoutMs ?? 100_000),
    });
  } catch {
    return unknownOutcome('no response from the payment worker');
  }
  return workerOutcome(response);
}

async function recordOutcome(deps: BillMcpDeps, attempt: Attempt, outcome: Outcome) {
  const recorded = await callRpc(deps, 'record_payment', {
    p_payment_id: attempt.payment_id,
    p_outcome: outcome.outcome,
    p_outcome_code: outcome.code,
    p_transaction_reference: outcome.reference,
    p_message: outcome.message,
  }, 'service');
  if (recorded.error) {
    console.error(`[bill-mcp] record_payment ${outcome.outcome} for payment ${attempt.payment_id} failed: ${recorded.error.message}`);
    return { error: 'record_payment failed' };
  }
  const payment = recorded.data;
  if (outcome.outcome === 'failure') return { error: 'payment_failed', outcome_code: outcome.code, payment };
  if (outcome.outcome === 'unknown') return { error: 'outcome_unknown', payment };
  if (!deps.persistReceipt) return { payment };
  const receipt = await deps.persistReceipt(paymentInput(attempt), payment, outcome.receipt)
    .catch(() => ({ status: 'failed', error: 'upload_failed' } as const));
  return { payment, receipt };
}

// The values the admin confirmed must equal the bill and the portal page before an attempt is
// prepared. Nothing reaches /execute unless start_payment_submission claimed the attempt, and
// every claimed attempt ends in record_payment.
async function executeApprovedPayment(deps: BillMcpDeps, userAuth: string, args: Record<string, unknown>) {
  const shown = shownPayment(args);
  if (shown === null) return { error: 'invalid arguments' };
  const loaded = await loadBill(deps, userAuth, shown.billId);
  if ('error' in loaded) return loaded;
  const bill = loaded.bill;
  if (!PAYABLE_STATUSES.includes(bill.status)) return { error: 'not_payable' };
  const differs = shownGaps(shown, bill.vendor_id, bill.invoice_number, moneyCents(bill.amount));
  if (differs.length > 0) return { error: 'summary_mismatch', fields: differs };
  const portal = await readPortal(deps, bill);
  if ('error' in portal) return portal;
  const gaps = snapshotGaps(bill, portal.text);
  if (gaps.length > 0) return { error: 'snapshot_mismatch', fields: gaps };
  const stagehandUrl = deps.stagehandUrl;
  if (!stagehandUrl) return { error: 'worker not configured' };
  const preparedBy = await deps.callerUserId();
  if (preparedBy === null) return { error: 'forbidden' };
  const prepared = await prepareAttempt(deps, bill, preparedBy, shown);
  if ('error' in prepared) return prepared;
  const stopped = await authorizeAndClaim(deps, prepared.attempt);
  if (stopped) return stopped;
  const outcome = await runWorker(deps, stagehandUrl, portal.portalUrl, prepared.attempt);
  return recordOutcome(deps, prepared.attempt, outcome);
}

async function retryPaymentReceipt(deps: BillMcpDeps, userAuth: string, args: Record<string, unknown>) {
  const billId = integer(args.bill_id);
  const paymentId = integer(args.payment_id);
  if (billId === null || paymentId === null) return { error: 'invalid arguments' };
  const loaded = await loadBill(deps, userAuth, billId);
  if ('error' in loaded) return loaded;
  if (!deps.receiptPayment || !deps.persistReceipt || !deps.stagehandUrl) return { error: 'receipt not configured' };
  const payment = await deps.receiptPayment(billId, paymentId);
  if (!payment || payment.billId !== billId || payment.bill_id !== billId || payment.payment_id !== paymentId || payment.status !== 'success' || !payment.idempotencyKey) return { error: 'receipt not found' };
  // This endpoint reads the durable artifact only. It cannot launch Chrome or pay.
  const response = await deps.fetch(joinUrl(deps.stagehandUrl, '/receipt'), {
    method: 'POST', headers: { Authorization: `Bearer ${deps.stagehandSecret ?? ''}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ billId, idempotencyKey: payment.idempotencyKey }),
  });
  if (!response.ok) return { error: 'receipt unavailable' };
  const body = await response.json() as { receipt?: unknown };
  const receipt = await deps.persistReceipt(payment, { ...payment, idempotency_key: payment.idempotencyKey }, body.receipt)
    .catch(() => ({ status: 'failed', error: 'upload_failed' } as const));
  return { receipt };
}

export async function handleBillMcp(
  request: { httpMethod: string; authorization: string | null; body: unknown; userAuthorization: string },
  deps: BillMcpDeps,
): Promise<McpResult> {
  const asked =
    request.body && typeof request.body === 'object' ? (request.body as { method?: unknown }).method : undefined;
  console.error(`[bill-mcp] ${request.httpMethod} ${typeof asked === 'string' ? asked : 'no-method'}`);
  if (request.httpMethod !== 'POST') return result({ error: 'POST only.' }, 405);
  if (!deps.mcpToken || request.authorization !== `Bearer ${deps.mcpToken}`) {
    return result({ error: 'unauthorized' }, 401);
  }
  const body = request.body;
  const method = body && typeof body === 'object' ? (body as { method?: unknown }).method : undefined;
  if (method === 'initialize') return result({ server: 'bill-mcp', tools: true });
  if (method === 'tools/list') return result({ tools: TOOLS });
  if (method !== 'tools/call') return result({ error: 'unknown method' }, 400);

  const name = toolName(body);
  const args = argsOf(body);
  if (name === 'get_bill') {
    const billId = integer(args.bill_id);
    if (billId === null) return result({ error: 'invalid arguments' });
    return result(await appGet(deps, request.userAuthorization, `/api/bills/${billId}`));
  }
  if (name === 'list_vendors') return result(await appGet(deps, request.userAuthorization, '/api/vendors'));
  if (name === 'observe_portal') {
    const billId = integer(args.bill_id);
    if (billId === null) return result({ error: 'invalid arguments' });
    return result(await observePortal(deps, request.userAuthorization, billId));
  }
  if (name === 'retry_payment_receipt') return result(await retryPaymentReceipt(deps, request.userAuthorization, args));
  if (name === 'execute_approved_payment') {
    return result(await executeApprovedPayment(deps, request.userAuthorization, args));
  }
  return result({ error: 'unknown tool' }, 400);
}
