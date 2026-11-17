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
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
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

function sameSnapshot(bill: Bill, args: Record<string, unknown>) {
  return (
    Number(bill.amount) === Number(args.amount) &&
    bill.vendor_id === args.vendor_id &&
    bill.invoice_number === args.invoice_number &&
    typeof args.idempotency_key === 'string' &&
    args.idempotency_key.trim() !== ''
  );
}

async function executeApprovedPayment(deps: BillMcpDeps, userAuth: string, args: Record<string, unknown>) {
  const billId = integer(args.bill_id);
  if (billId === null) return { error: 'invalid arguments' };
  const loaded = await loadBill(deps, userAuth, billId);
  if ('error' in loaded) return loaded;
  const bill = loaded.bill;
  if (bill.status !== 'pending_payment') return { error: 'not_pending_payment' };
  if (!sameSnapshot(bill, args)) return { error: 'snapshot_mismatch' };
  if ((await deps.latestApproval(bill.bill_id)) !== 'approved') return { error: 'not_approved' };
  if (bill.vendor_id === null || bill.invoice_number === null || bill.amount === null) {
    return { error: 'snapshot_mismatch' };
  }
  const portalUrl = await deps.portalUrl(bill.vendor_id);
  if (!portalUrl) return { error: 'no portal url' };
  if (!deps.stagehandUrl || !deps.canRecord) return { error: 'worker not configured' };
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
      idempotencyKey: args.idempotency_key,
    }),
  });
  if (!response.ok) return { error: 'worker failed' };
  const recorded = await deps.recordPayment({
    billId: bill.bill_id,
    amount: Number(bill.amount),
    vendorId: bill.vendor_id,
    invoiceNumber: bill.invoice_number,
    idempotencyKey: String(args.idempotency_key),
  });
  if (recorded.error) return { error: 'record_payment failed' };
  return { payment: recorded.payment };
}

export async function handleBillMcp(
  request: { httpMethod: string; authorization: string | null; body: unknown; userAuthorization: string },
  deps: BillMcpDeps,
): Promise<McpResult> {
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
