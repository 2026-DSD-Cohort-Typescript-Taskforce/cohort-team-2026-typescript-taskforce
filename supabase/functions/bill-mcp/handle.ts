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

export type PaymentAttempt = {
  paymentId: number;
  billId: number;
  idempotencyKey: string;
  summary: Record<string, unknown>;
};

export type PaymentOutcome = {
  paymentId: number;
  outcome: 'success' | 'failure' | 'unknown';
  outcomeCode: string;
  transactionReference: string | null;
  message: string | null;
};

export type RecordedPayment = {
  payment_id: number;
  bill_id: number;
  status: string;
  idempotency_key: string;
};

export type BillMcpDeps = {
  mcpToken: string | undefined;
  clientUrl: string;
  stagehandUrl: string | undefined;
  stagehandSecret: string | undefined;
  canRecord: boolean;
  persistReceipt?: (input: PaymentInput, payment: unknown, receipt: unknown) => Promise<ReceiptResult>;
  receiptPayment?: (billId: number, paymentId: number) => Promise<(PaymentInput & { payment_id: number; bill_id: number; status: string }) | null>;
  fetch: typeof fetch;
  portalUrl: (vendorId: number) => Promise<string | null>;
  latestApproval: (billId: number) => Promise<string | null>;
  preparePayment: (billId: number) => Promise<{ attempt?: PaymentAttempt; error?: string }>;
  authorizePayment: (attempt: PaymentAttempt) => Promise<{ error?: string }>;
  startSubmission: (paymentId: number) => Promise<{ error?: string }>;
  recordOutcome: (outcome: PaymentOutcome) => Promise<{ payment?: RecordedPayment; error?: string }>;
  pendingBillIds?: () => Promise<number[]>;
  billForAutomation?: (billId: number) => Promise<Bill | null>;
  prepareAutomatedPayment?: (billId: number) => Promise<{ attempt?: PaymentAttempt; error?: string }>;
  authorizeAutomatedPayment?: (attempt: PaymentAttempt) => Promise<{ error?: string }>;
};

type Bill = {
  bill_id: number;
  status: string;
  amount: number | string | null;
  vendor_id: number | null;
  invoice_number: string | null;
};

const TOOLS = [
  { name: 'get_bill' },
  { name: 'list_vendors' },
  { name: 'observe_portal' },
  { name: 'execute_approved_payment' },
  { name: 'retry_payment_receipt' },
];

function result(body: unknown, status = 200): McpResult {
  const failed =
    status >= 400 || (body !== null && typeof body === 'object' && 'error' in body);
  if (failed) console.error(`[bill-mcp] ${status} ${JSON.stringify(body)}`);
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
  console.log("im inside the loadbillfunction")
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

async function workerFailure(response: Response) {
  try {
    const body = (await response.json()) as { code?: unknown };
    if (body.code === 'outcome_unknown') return { error: 'outcome_unknown' as const, code: 'outcome_unknown' };
    if (typeof body.code === 'string') return { error: 'worker failed' as const, code: body.code };
  } catch {
    // A non-JSON worker failure stays generic.
  }
  return { error: 'worker failed' as const, code: 'portal_error' };
}

function failureCode(code: string) {
  if (code === 'payment_mismatch' || code === 'portal_rejected' || code === 'portal_error' || code === 'not_submitted') return code;
  return 'not_submitted';
}

function transactionReference(execution: { receipt?: unknown } | null, fallback: string) {
  const receipt = execution?.receipt;
  const reference = receipt && typeof receipt === 'object' && 'reference' in receipt ? receipt.reference : undefined;
  if (typeof reference === 'string' && reference.trim()) return reference.trim();
  return fallback;
}

async function executeApprovedPayment(
  deps: BillMcpDeps,
  userAuth: string,
  args: Record<string, unknown>,
  automated = false,
) {
  const billId = integer(field(args, 'bill_id', 'billId'));
  if (billId === null) return { error: 'invalid arguments' };
  const automatedBill = automated ? await deps.billForAutomation?.(billId) : undefined;
  const loaded = automated
    ? automatedBill
      ? { bill: automatedBill }
      : { error: 'not_found' as const }
    : await loadBill(deps, userAuth, billId);
  if ('error' in loaded) return loaded;
  const bill = loaded.bill;
  if (bill.status !== 'pending_payment') return { error: 'not_pending_payment' };
  const portal = await readPortal(deps, bill);
  if ('error' in portal) return portal;
  const gaps = snapshotGaps(bill, portal.text);
  if (gaps.length > 0) return { error: 'snapshot_mismatch', fields: gaps };
  if ((await deps.latestApproval(bill.bill_id)) !== 'approved' ) return { error: 'not_approved' };
  if (bill.vendor_id === null || bill.invoice_number === null || bill.amount === null || !deps.stagehandUrl || !deps.canRecord) {
    return { error: 'worker not configured' };
  }
  const prepared = automated
    ? await deps.prepareAutomatedPayment?.(bill.bill_id)
    : await deps.preparePayment(bill.bill_id);
  if (!prepared) return { error: 'automation not configured' };
  if (prepared.error || !prepared.attempt) return { error: prepared.error ?? 'prepare_payment failed' };
  const authorized = automated
    ? await deps.authorizeAutomatedPayment?.(prepared.attempt)
    : await deps.authorizePayment(prepared.attempt);
  if (!authorized) return { error: 'automation not configured' };
  if (authorized.error) return { error: authorized.error };
  const started = await deps.startSubmission(prepared.attempt.paymentId);
  if (started.error) return { error: started.error };
  const attempt = prepared.attempt;
  const idempotencyKey = attempt.idempotencyKey;
  const portalUrl = portal.portalUrl;
  const response = await deps.fetch(joinUrl(deps.stagehandUrl, '/execute'), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${deps.stagehandSecret ?? ''}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      billId: bill.bill_id,
      portalUrl,
      amount: bill.amount,
      vendorId: bill.vendor_id,
      invoiceNumber: bill.invoice_number,
      idempotencyKey,
    }),
  });
  if (!response.ok) {
    const failure = await workerFailure(response);
    const recorded = await deps.recordOutcome(
      failure.error === 'outcome_unknown'
        ? { paymentId: attempt.paymentId, outcome: 'unknown', outcomeCode: 'outcome_unknown', transactionReference: null, message: null }
        : { paymentId: attempt.paymentId, outcome: 'failure', outcomeCode: failureCode(failure.code), transactionReference: null, message: null },
    );
    if (recorded.error) return { error: 'record_payment failed' };
    return failure.error === 'outcome_unknown' ? { error: 'outcome_unknown' } : { error: 'worker failed' };
  }
  const execution = (await response.json().catch(() => null)) as {
    confirmed?: boolean;
    receipt?: unknown;
  } | null;
  const recorded = await deps.recordOutcome({
    paymentId: attempt.paymentId,
    outcome: 'success',
    outcomeCode: 'confirmed',
    transactionReference: transactionReference(execution, idempotencyKey),
    message: null,
  });
  if (recorded.error || !recorded.payment) return { error: 'record_payment failed' };
  const input: PaymentInput = { billId: bill.bill_id, amount: Number(bill.amount), vendorId: bill.vendor_id, invoiceNumber: bill.invoice_number, idempotencyKey };
  if (!deps.persistReceipt) return { payment: recorded.payment };
  const receipt = await deps.persistReceipt(input, recorded.payment, execution?.confirmed === true ? execution.receipt : undefined)
    .catch(() => ({ status: 'failed', error: 'upload_failed' } as const));
  return { payment: recorded.payment, receipt };
}

async function sweepApprovedPayments(deps: BillMcpDeps, userAuth: string) {
  if (!deps.pendingBillIds) return { error: 'automation not configured' };
  const billIds = await deps.pendingBillIds();
  const results = [];
  for (const billId of billIds) {
    const outcome = await executeApprovedPayment(deps, userAuth, { bill_id: billId }, true);
    results.push({ bill_id: billId, outcome });
  }
  return { ok: true, results };
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
  if (method === 'sweep_approved_payments') return result(await sweepApprovedPayments(deps, request.userAuthorization));
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
