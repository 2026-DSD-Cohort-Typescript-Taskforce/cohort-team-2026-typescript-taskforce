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

// The DC-89 payment functions bill-mcp calls (supabase/migrations/20261117200000_payment_attempts.sql),
// plus authorize_approved_payment for the hourly sweep (20261118230200_authorize_approved_payment.sql)
// and the DC-92 policy functions evaluate_bill_policy and send_bill_for_approval.
export type RpcName = 'prepare_payment' | 'authorize_payment' | 'authorize_approved_payment' | 'cancel_payment'
  | 'start_payment_submission' | 'record_payment' | 'evaluate_bill_policy' | 'send_bill_for_approval';
// error.code is the Postgres error code; a reply that never arrived (or a throw) has none.
export type RpcReply = { data: unknown; error: { message: string; details?: string | null; code?: string | null } | null };

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
  // The clock, the payment's time budget and the wait between record_payment tries; tests replace them.
  now?: () => number;
  deadlineMs?: number;
  sleep?: (ms: number) => Promise<void>;
  // The hourly sweep reads through the service client; it has no user session. Without all three
  // it refuses with automation not configured.
  pendingBillIds?: () => Promise<number[]>;
  serviceBill?: (billId: number) => Promise<Bill | null>;
  // users.user_id of the approver on the bill's newest approval when it is approved, else null.
  latestApprover?: (billId: number) => Promise<number | null>;
};

export type Bill = {
  bill_id: number;
  status: string;
  amount: number | string | null;
  vendor_id: number | null;
  invoice_number: string | null;
  payment_method_id: number | null;
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

// Who authorizes an attempt: the admin, on the summary the trigger dialog showed them, or for the
// hourly sweep, authorize_approved_payment on behalf of the bill's newest approver.
type Authorizer = { kind: 'admin' } | { kind: 'scheduled' };

// The payment summary the admin confirmed in the trigger dialog. Money is in cents.
type Shown = {
  billId: number;
  vendorId: number;
  invoiceNumber: string;
  paymentMethodId: number;
  cents: number;
  feesCents: number;
  currency: string;
  paymentDate: string;
};

type Outcome = {
  outcome: 'success' | 'failure' | 'unknown';
  code: 'confirmed' | 'payment_mismatch' | 'portal_error' | 'not_submitted' | 'outcome_unknown';
  reference: string | null;
  message: string | null;
  receipt?: unknown;
};

const PAYABLE_STATUSES = ['pending_payment', 'payment_failed'];

// One execute_approved_payment call's budget, set when it starts. It ends before the trigger
// route's 140 s abort and Supabase's 150 s limit, so a claimed attempt is still recorded.
const PAYMENT_DEADLINE_MS = 125_000;
const OBSERVE_TIMEOUT_MS = 30_000;
const EXECUTE_TIMEOUT_MS = 100_000;
// With less than this left, prepare_payment is not called: /execute and record_payment might not fit.
const PREPARE_MIN_LEFT_MS = 70_000;
// The waits before the second and third record_payment tries.
const RECORD_RETRY_DELAYS_MS = [250, 1_000];

// authorize_payment's summary keys, as payment_summary() in the DC-89 migration builds them.
const SUMMARY_KEYS = ['bill_id', 'vendor_id', 'invoice_number', 'account_reference', 'payment_method_id',
  'amount_cents', 'fees_cents', 'total_cents', 'currency', 'payment_date'];
// The summary keys a bill holds too, checked before an attempt is prepared.
const BILL_KEYS = ['vendor_id', 'invoice_number', 'payment_method_id', 'amount_cents'];
// How a mismatched summary key is named in summary_mismatch fields: the dialog shows dollars.
const FIELD_NAMES: Record<string, string> = { amount_cents: 'amount', fees_cents: 'fees', total_cents: 'total' };

// Payment-function errors returned to the caller as they are. Any other error, including
// authorize_payment's summary_mismatch (bill-mcp sends the shown summary only once it equals the
// prepared row), is payment_not_started.
const RPC_CODES = new Set(['forbidden', 'not_found', 'invalid_payment', 'payment_in_progress', 'already_paid',
  'not_payable', 'not_pending', 'not_prepared', 'summary_stale', 'not_authorized', 'authorization_expired',
  'not_approved', 'worker not configured', 'approval_not_required']);

// start_payment_submission's own refusals: the claim did not happen.
const CLAIM_CODES = new Set(['not_found', 'not_authorized', 'authorization_expired', 'forbidden', 'not_payable',
  'summary_stale']);

// DC-92 refusals from prepare_payment and start_payment_submission. The evaluator's decision comes
// in the error detail. policy_changed means the vendor's policy changed after the attempt was prepared.
const POLICY_CODES = new Set(['policy_blocked', 'approval_required', 'policy_changed']);

type PolicyReply = { error: string; policy?: unknown };

// The evaluator's JSON from an error detail or a reply, or undefined when absent or garbled.
function policyOf(raw: unknown): unknown {
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return undefined;
    }
  }
  return raw && typeof raw === 'object' ? raw : undefined;
}

function withPolicy(error: string, policy: unknown): PolicyReply {
  return policy === undefined ? { error } : { error, policy };
}

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

// AbortSignal.timeout throws on a negative or fractional delay.
function timeoutSignal(ms: number) {
  return AbortSignal.timeout(Math.max(0, Math.floor(ms)));
}

// The worker's /observe reply, or null when it failed, threw or took longer than timeoutMs.
async function observe(deps: BillMcpDeps, stagehandUrl: string, billId: number, portalUrl: string, timeoutMs: number) {
  try {
    const response = await deps.fetch(joinUrl(stagehandUrl, '/observe'), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${deps.stagehandSecret ?? ''}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ billId, portalUrl }),
      signal: timeoutSignal(timeoutMs),
    });
    return response.ok ? await response.text() : null;
  } catch {
    return null;
  }
}

async function observePortal(deps: BillMcpDeps, userAuth: string, billId: number) {
  const loaded = await loadBill(deps, userAuth, billId);
  if ('error' in loaded) return loaded;
  const stagehand = deps.stagehandUrl;
  if (!stagehand) return { error: 'worker not configured' };
  const portalUrl = await deps.portalUrl(loaded.bill.vendor_id ?? 0);
  if (!portalUrl) return { error: 'no portal url' };
  const observation = await observe(deps, stagehand, loaded.bill.bill_id, portalUrl, OBSERVE_TIMEOUT_MS);
  if (observation === null) return { error: 'worker failed' };
  return { observation };
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

async function readPortal(deps: BillMcpDeps, bill: Bill, timeoutMs: number) {
  if (bill.vendor_id === null) return { error: 'no portal url' as const };
  const portalUrl = await deps.portalUrl(bill.vendor_id);
  if (!portalUrl) return { error: 'no portal url' as const };
  if (!deps.stagehandUrl) return { error: 'worker not configured' as const };
  const observation = await observe(deps, deps.stagehandUrl, bill.bill_id, portalUrl, timeoutMs);
  if (observation === null) return { error: 'worker failed' as const };
  return { portalUrl, text: pageText(observation) };
}

// A real calendar date written YYYY-MM-DD, else null.
function isoDate(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : null;
}

function shownPayment(args: Record<string, unknown>): Shown | null {
  const billId = integer(field(args, 'bill_id', 'billId'));
  const vendorId = integer(field(args, 'vendor_id', 'vendorId'));
  const invoiceNumber = field(args, 'invoice_number', 'invoiceNumber');
  const paymentMethodId = integer(field(args, 'payment_method_id', 'paymentMethodId'));
  const cents = moneyCents(args.amount);
  const feesCents = moneyCents(args.fees);
  const currency = args.currency;
  const paymentDate = isoDate(field(args, 'payment_date', 'paymentDate'));
  if (billId === null || vendorId === null || paymentMethodId === null || cents === null) return null;
  if (feesCents === null || feesCents < 0 || paymentDate === null) return null;
  if (typeof invoiceNumber !== 'string' || invoiceNumber.trim() === '') return null;
  if (typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency)) return null;
  return { billId, vendorId, invoiceNumber, paymentMethodId, cents, feesCents, currency, paymentDate };
}

// What the admin was shown, as authorize_payment's summary. The trigger never sets an account
// reference, so it is null.
function shownSummary(shown: Shown): Record<string, unknown> {
  return {
    bill_id: shown.billId,
    vendor_id: shown.vendorId,
    invoice_number: shown.invoiceNumber,
    account_reference: null,
    payment_method_id: shown.paymentMethodId,
    amount_cents: shown.cents,
    fees_cents: shown.feesCents,
    total_cents: shown.cents + shown.feesCents,
    currency: shown.currency,
    payment_date: shown.paymentDate,
  };
}

// The fields where a bill or a prepared attempt differs from what the admin was shown, in summary order.
function summaryGaps(summary: Record<string, unknown>, actual: Record<string, unknown>, keys: string[]) {
  return keys.filter((key) => actual[key] !== summary[key]).map((key) => FIELD_NAMES[key] ?? key);
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
// the bill's next prepare_payment. cancel_payment needs a signed-in user, so a scheduled attempt
// is only left behind.
async function cancelAndStop<T extends { error: string }>(deps: BillMcpDeps, attempt: Attempt, stop: T, by: Authorizer) {
  if (by.kind === 'admin') {
    await callRpc(deps, 'cancel_payment', { p_payment_id: attempt.payment_id, p_note: stop.error }, 'user');
  }
  return stop;
}

// Sends the bill back for approval by someone other than the submitter. null means the bill needs
// no approval after all (approval_not_required): the caller carries on and prepare_payment decides.
async function sendBackOrContinue(deps: BillMcpDeps, bill: Bill, requestedBy: number, fallback: unknown) {
  const sent = await callRpc(deps, 'send_bill_for_approval', { p_bill_id: bill.bill_id, p_requested_by: requestedBy }, 'service');
  if (!sent.error) return withPolicy('sent_for_approval', policyOf(sent.data) ?? fallback) as PolicyReply;
  if (sent.error.message === 'approval_not_required') return null;
  return rpcStop('send_bill_for_approval', sent.error);
}

// A refusal from prepare or the claim that needs approval: the bill is sent back. If the database
// then says no approval is needed the payment cannot proceed this call (payment_not_started).
async function sendBack(deps: BillMcpDeps, bill: Bill, requestedBy: number, policy: unknown) {
  const sent = await sendBackOrContinue(deps, bill, requestedBy, policy);
  return sent ?? rpcStop('send_bill_for_approval', { message: 'approval_not_required after approval_required' });
}

// The policy check before any portal read: a block stops the payment; a policy needing approval
// sends the bill back. Runs for the admin trigger and the hourly sweep alike. null means go on.
async function policyGate(deps: BillMcpDeps, bill: Bill, preparedBy: () => Promise<number | null>) {
  const evaluated = await callRpc(deps, 'evaluate_bill_policy', { p_bill_id: bill.bill_id }, 'service');
  if (evaluated.error) return rpcStop('evaluate_bill_policy', evaluated.error);
  const policy = policyOf(evaluated.data);
  const decision = policy && typeof policy === 'object' ? (policy as { decision?: unknown }).decision : undefined;
  if (decision === 'block') return withPolicy('policy_blocked', policy);
  if (decision !== 'require_approval') return null;
  const requestedBy = await preparedBy();
  if (requestedBy === null) return { error: 'forbidden' };
  return sendBackOrContinue(deps, bill, requestedBy, policy);
}

// Every payment is prepared with no fees and the summary's date (the one the admin was shown, or
// today for the sweep); a different shown fee is a summary_mismatch.
async function prepareAttempt(
  deps: BillMcpDeps,
  bill: Bill,
  preparedBy: number,
  summary: Record<string, unknown>,
  by: Authorizer,
) {
  const prepared = await callRpc(deps, 'prepare_payment', {
    p_bill_id: bill.bill_id,
    p_prepared_by: preparedBy,
    p_fees_cents: 0,
    p_payment_date: summary.payment_date,
    p_account_reference: null,
  }, 'service');
  if (prepared.error) {
    const code = prepared.error.message;
    if (code === 'policy_blocked') return withPolicy(code, policyOf(prepared.error.details));
    if (code === 'approval_required') return sendBack(deps, bill, preparedBy, policyOf(prepared.error.details));
    return rpcStop('prepare_payment', prepared.error);
  }
  if (!isAttempt(prepared.data)) return rpcStop('prepare_payment', { message: 'no payment row returned' });
  const attempt = prepared.data;
  const gaps = summaryGaps(summary, attempt, SUMMARY_KEYS);
  if (gaps.length > 0) return cancelAndStop(deps, attempt, { error: 'summary_mismatch', fields: gaps }, by);
  return { attempt };
}

// The admin's explicit yes on the summary they were shown (equal to the prepared row), or for the
// sweep authorize_approved_payment, which rechecks the newest approval. Then the atomic claim. A
// refusal cancels the attempt and returns its code; nothing was charged. null means the attempt
// is claimed.
async function authorizeAndClaim(
  deps: BillMcpDeps,
  attempt: Attempt,
  summary: Record<string, unknown>,
  by: Authorizer,
  bill: Bill,
  requestedBy: number,
) {
  const authorized = by.kind === 'admin'
    ? await callRpc(deps, 'authorize_payment', { p_payment_id: attempt.payment_id, p_summary: summary }, 'user')
    : await callRpc(deps, 'authorize_approved_payment', { p_payment_id: attempt.payment_id }, 'service');
  const authorizeName = by.kind === 'admin' ? 'authorize_payment' : 'authorize_approved_payment';
  if (authorized.error) return cancelAndStop(deps, attempt, rpcStop(authorizeName, authorized.error), by);
  const claimed = await callRpc(deps, 'start_payment_submission', { p_payment_id: attempt.payment_id }, 'service');
  if (!claimed.error) return null;
  if (CLAIM_CODES.has(claimed.error.message)) return cancelAndStop(deps, attempt, { error: claimed.error.message }, by);
  if (POLICY_CODES.has(claimed.error.message)) {
    const code = claimed.error.message;
    const policy = policyOf(claimed.error.details);
    if (code === 'approval_required') {
      await cancelAndStop(deps, attempt, { error: code }, by);
      return sendBack(deps, bill, requestedBy, policy);
    }
    return cancelAndStop(deps, attempt, withPolicy(code, policy), by);
  }
  // The claim may have committed with its reply lost. Close it as not submitted; if it never
  // committed, record_payment answers not_processing and the cancel withdraws it.
  console.error(`[bill-mcp] start_payment_submission failed: ${claimed.error.message}`);
  await callRpc(deps, 'record_payment', {
    p_payment_id: attempt.payment_id,
    p_outcome: 'failure',
    p_outcome_code: 'not_submitted',
    p_transaction_reference: null,
    p_message: 'claim reply lost; worker not called',
  }, 'service');
  return cancelAndStop(deps, attempt, { error: 'payment_not_started' }, by);
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

async function runWorker(deps: BillMcpDeps, stagehandUrl: string, portalUrl: string, attempt: Attempt, timeoutMs: number): Promise<Outcome> {
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
      // Ends by the payment deadline, so the outcome is still recorded.
      signal: timeoutSignal(timeoutMs),
    });
  } catch {
    return unknownOutcome('no response from the payment worker');
  }
  return workerOutcome(response);
}

// A record_payment error without a code means the reply was lost (or the call threw), so it is
// tried again with the same arguments, at most twice and only while each try starts before the
// deadline. A coded error is the function's own refusal and is final.
async function recordOutcome(deps: BillMcpDeps, attempt: Attempt, outcome: Outcome, left: () => number) {
  const args = {
    p_payment_id: attempt.payment_id,
    p_outcome: outcome.outcome,
    p_outcome_code: outcome.code,
    p_transaction_reference: outcome.reference,
    p_message: outcome.message,
  };
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let recorded = await callRpc(deps, 'record_payment', args, 'service');
  for (const delay of RECORD_RETRY_DELAYS_MS) {
    if (!recorded.error || recorded.error.code || left() <= delay) break;
    await sleep(delay);
    recorded = await callRpc(deps, 'record_payment', args, 'service');
  }
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

// The portal page must show the bill's invoice and amount before an attempt is prepared, and the
// prepared attempt must equal the summary key for key before it is authorized. Nothing reaches
// /execute unless start_payment_submission claimed the attempt, and every claimed attempt ends in
// record_payment. preparedBy returns the users.user_id the attempt is prepared for.
async function payBill(
  deps: BillMcpDeps,
  bill: Bill,
  summary: Record<string, unknown>,
  preparedBy: () => Promise<number | null>,
  by: Authorizer,
  left: () => number,
) {
  let preparerLookup: Promise<number | null> | undefined;
  const preparerOnce = () => (preparerLookup ??= preparedBy());
  const gated = await policyGate(deps, bill, preparerOnce);
  if (gated) return gated;
  const portal = await readPortal(deps, bill, Math.min(OBSERVE_TIMEOUT_MS, left()));
  if ('error' in portal) return portal;
  const gaps = snapshotGaps(bill, portal.text);
  if (gaps.length > 0) return { error: 'snapshot_mismatch', fields: gaps };
  const stagehandUrl = deps.stagehandUrl;
  if (!stagehandUrl) return { error: 'worker not configured' };
  const preparer = await preparerOnce();
  if (preparer === null) return { error: 'forbidden' };
  if (left() < PREPARE_MIN_LEFT_MS) return { error: 'payment_not_started' };
  const prepared = await prepareAttempt(deps, bill, preparer, summary, by);
  if ('error' in prepared) return prepared;
  const stopped = await authorizeAndClaim(deps, prepared.attempt, summary, by, bill, preparer);
  if (stopped) return stopped;
  const executeMs = Math.min(deps.executeTimeoutMs ?? EXECUTE_TIMEOUT_MS, left());
  const outcome = await runWorker(deps, stagehandUrl, portal.portalUrl, prepared.attempt, executeMs);
  return recordOutcome(deps, prepared.attempt, outcome, left);
}

function deadlineFrom(deps: BillMcpDeps) {
  const now = deps.now ?? Date.now;
  const deadline = now() + (deps.deadlineMs ?? PAYMENT_DEADLINE_MS);
  return () => deadline - now();
}

// The summary the admin confirmed must equal the bill before the portal is read.
async function executeApprovedPayment(deps: BillMcpDeps, userAuth: string, args: Record<string, unknown>) {
  const left = deadlineFrom(deps);
  const shown = shownPayment(args);
  if (shown === null) return { error: 'invalid arguments' };
  const loaded = await loadBill(deps, userAuth, shown.billId);
  if ('error' in loaded) return loaded;
  const bill = loaded.bill;
  if (!PAYABLE_STATUSES.includes(bill.status)) return { error: 'not_payable' };
  const summary = shownSummary(shown);
  const differs = summaryGaps(summary, { ...bill, amount_cents: moneyCents(bill.amount) }, BILL_KEYS);
  if (differs.length > 0) return { error: 'summary_mismatch', fields: differs };
  return payBill(deps, bill, summary, () => deps.callerUserId(), { kind: 'admin' }, left);
}

// What the sweep authorizes for a bill: its own vendor, invoice, method and amount, no fees, USD
// (the only currency payments allow) and today's date. null when the bill lacks one of them.
function scheduledSummary(bill: Bill, paymentDate: string): Record<string, unknown> | null {
  const cents = moneyCents(bill.amount);
  if (bill.vendor_id === null || bill.payment_method_id === null || !bill.invoice_number || cents === null) return null;
  return {
    bill_id: bill.bill_id,
    vendor_id: bill.vendor_id,
    invoice_number: bill.invoice_number,
    account_reference: null,
    payment_method_id: bill.payment_method_id,
    amount_cents: cents,
    fees_cents: 0,
    total_cents: cents,
    currency: 'USD',
    payment_date: paymentDate,
  };
}

// One sweep bill. Only pending_payment is paid: a payment_failed bill waits for a person. The
// newest approval must be approved; its approver prepares the attempt, and
// authorize_approved_payment checks it again.
async function payScheduledBill(
  deps: BillMcpDeps & Required<Pick<BillMcpDeps, 'serviceBill' | 'latestApprover'>>,
  billId: number,
  paymentDate: string,
  left: () => number,
) {
  const bill = await deps.serviceBill(billId);
  if (!bill) return { error: 'not_found' };
  if (bill.status !== 'pending_payment') return { error: 'not_payable' };
  const approver = await deps.latestApprover(billId);
  if (approver === null) return { error: 'not_approved' };
  const summary = scheduledSummary(bill, paymentDate);
  if (summary === null) return { error: 'not_payable' };
  return payBill(deps, bill, summary, async () => approver, { kind: 'scheduled' }, left);
}

// The hourly cron's call. Every bill shares one payment budget, so the sweep ends before
// Supabase's limit with each claimed attempt recorded. A bill that no longer fits is deferred to
// the next hour; nothing is prepared for it.
async function sweepApprovedPayments(deps: BillMcpDeps) {
  const { pendingBillIds, serviceBill, latestApprover } = deps;
  if (!pendingBillIds || !serviceBill || !latestApprover) return { error: 'automation not configured' };
  const left = deadlineFrom(deps);
  const paymentDate = new Date((deps.now ?? Date.now)()).toISOString().slice(0, 10);
  let billIds: number[];
  try {
    billIds = await pendingBillIds();
  } catch (error) {
    console.error(`[bill-mcp] sweep could not list bills: ${error instanceof Error ? error.message : String(error)}`);
    return { error: 'bill list failed' };
  }
  const results: { bill_id: number; outcome: unknown }[] = [];
  const deferred: number[] = [];
  for (const billId of billIds) {
    if (left() < PREPARE_MIN_LEFT_MS) {
      deferred.push(billId);
      continue;
    }
    const outcome = await payScheduledBill({ ...deps, serviceBill, latestApprover }, billId, paymentDate, left);
    const failed = outcome && typeof outcome === 'object' && 'error' in outcome ? outcome.error : null;
    if (failed) console.error(`[bill-mcp] sweep bill ${billId}: ${String(failed)}`);
    results.push({ bill_id: billId, outcome });
  }
  return { ok: true, results, deferred };
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
  if (method === 'sweep_approved_payments') return result(await sweepApprovedPayments(deps));
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
