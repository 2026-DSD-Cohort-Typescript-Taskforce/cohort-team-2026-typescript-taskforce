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

export type BillMcpDeps = {
  mcpToken: string | undefined;
  clientUrl: string;
  stagehandUrl: string | undefined;
  stagehandSecret: string | undefined;
  canRecord: boolean;
  fetch: typeof fetch;
  portalUrl: (vendorId: number) => Promise<string | null>;
  latestApproval: (billId: number) => Promise<string | null>;
  recordPayment: (input: PaymentInput) => Promise<{ payment?: unknown; error?: string }>;
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

async function executeApprovedPayment(deps: BillMcpDeps, userAuth: string, args: Record<string, unknown>) {
  const billId = integer(field(args, 'bill_id', 'billId'));
  if (billId === null) return { error: 'invalid arguments' };
  const loaded = await loadBill(deps, userAuth, billId);
  if ('error' in loaded) return loaded;
  const bill = loaded.bill;
  if (bill.status !== 'pending_payment') return { error: 'not_pending_payment' };
  const portal = await readPortal(deps, bill);
  if ('error' in portal) return portal;
  const gaps = snapshotGaps(bill, portal.text);
  if (gaps.length > 0) return { error: 'snapshot_mismatch', fields: gaps };
  if ((await deps.latestApproval(bill.bill_id)) !== 'approved') return { error: 'not_approved' };
  if (bill.vendor_id === null || bill.invoice_number === null || bill.amount === null || !deps.canRecord) {
    return { error: 'worker not configured' };
  }
  const suppliedKey = field(args, 'idempotency_key', 'idempotencyKey');
  const idempotencyKey =
    typeof suppliedKey === 'string' && suppliedKey.trim() !== ''
      ? suppliedKey.trim()
      : `portal-${bill.bill_id}`;
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
  if (!response.ok) return { error: 'worker failed' };
  const recorded = await deps.recordPayment({
    billId: bill.bill_id,
    amount: Number(bill.amount),
    vendorId: bill.vendor_id,
    invoiceNumber: bill.invoice_number,
    idempotencyKey,
  });
  if (recorded.error) return { error: 'record_payment failed' };
  return { payment: recorded.payment };
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
  if (name === 'execute_approved_payment') {
    return result(await executeApprovedPayment(deps, request.userAuthorization, args));
  }
  return result({ error: 'unknown tool' }, 400);
}
