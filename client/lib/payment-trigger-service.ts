export type PaymentTriggerBody = {
  outcome?: 'success' | 'ineligible' | 'failed' | 'unknown';
  message: string;
  code?: string;
  payment?: unknown;
  receipt?: unknown;
};

export type PaymentTriggerReply = { status: number; body: PaymentTriggerBody };

export type BillMcpReply = {
  ok: boolean;
  status: number;
  body: Record<string, unknown> | null;
};

/** The vendor, invoice and amount the admin saw in the confirm dialog. */
export type ShownPayment = { vendor_id: number; invoice_number: string; amount: number | string };

const invalidRequest: PaymentTriggerReply = {
  status: 400,
  body: {
    code: 'invalid_request',
    message: 'Send the vendor, invoice and amount you confirmed.',
  },
};

function parseShown(value: unknown): ShownPayment | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const { vendor_id, invoice_number, amount } = value as Record<string, unknown>;
  if (typeof vendor_id !== 'number' || !Number.isInteger(vendor_id) || vendor_id <= 0) return null;
  if (
    typeof invoice_number !== 'string' ||
    invoice_number.trim() === '' ||
    invoice_number.length > 255
  ) {
    return null;
  }
  const amountOk =
    typeof amount === 'number'
      ? Number.isFinite(amount) && amount > 0
      : typeof amount === 'string' && /^\d+(\.\d{1,2})?$/.test(amount);
  return amountOk ? { vendor_id, invoice_number, amount: amount as number | string } : null;
}

const forbidden: PaymentTriggerReply = {
  status: 403,
  body: { code: 'forbidden', message: 'Only system administrators can run a payment.' },
};

const uncertain = (): PaymentTriggerReply => ({
  status: 409,
  body: {
    outcome: 'unknown',
    code: 'outcome_unknown',
    message: 'The payment outcome is uncertain. Do not retry; reconcile it first.',
  },
});

const unavailable = (): PaymentTriggerReply => ({
  status: 502,
  body: {
    outcome: 'failed',
    code: 'payment_service_unavailable',
    message: 'The payment service is unavailable.',
  },
});

/** Server-side authorization and safe response mapping for the manual trigger route. */
export async function runPaymentTrigger(input: {
  billId: number | null;
  role: string | null;
  shown: unknown;
  invoke: (billId: number, shown: ShownPayment) => Promise<BillMcpReply>;
}): Promise<PaymentTriggerReply> {
  if (input.role !== 'system_admin') return forbidden;
  if (input.billId === null) {
    return { status: 404, body: { code: 'not_found', message: 'Bill not found.' } };
  }
  const shown = parseShown(input.shown);
  if (!shown) return invalidRequest;

  let upstream: BillMcpReply;
  try {
    upstream = await input.invoke(input.billId, shown);
  } catch {
    // The request may have reached bill-mcp before the connection was lost.
    return uncertain();
  }
  // bill-mcp answers 200 for every tool result, so a 5xx means it crashed or was stopped,
  // possibly after the portal took the payment.
  if (upstream.status >= 500) return uncertain();
  if (!upstream.ok || !upstream.body) return unavailable();

  const payment = upstream.body.payment;
  if (
    payment &&
    typeof payment === 'object' &&
    !Array.isArray(payment) &&
    (payment as Record<string, unknown>).bill_id === input.billId &&
    (payment as Record<string, unknown>).status === 'success'
  ) {
    return {
      status: 200,
      body: {
        outcome: 'success',
        message: 'Payment completed.',
        payment,
        ...(upstream.body.receipt === undefined ? {} : { receipt: upstream.body.receipt }),
      },
    };
  }

  const code = typeof upstream.body.error === 'string' ? upstream.body.error : 'worker failed';
  const refused = (
    status: number,
    outcome: 'ineligible' | 'failed',
    message: string,
  ): PaymentTriggerReply => ({ status, body: { outcome, code, message } });

  switch (code) {
    case 'outcome_unknown':
    case 'record_payment failed':
    case 'payment_in_progress':
      // The portal may already have taken the payment.
      return uncertain();
    case 'payment_failed':
      return refused(
        502,
        'failed',
        'The portal did not take the payment. The bill is marked payment failed.',
      );
    case 'not_payable':
    case 'snapshot_mismatch':
    case 'no portal url':
    case 'already_paid':
      return refused(409, 'ineligible', 'This bill is not eligible for automated payment.');
    case 'summary_mismatch':
    case 'summary_stale':
      return refused(
        409,
        'ineligible',
        'The bill changed. Reload it and check the details before paying.',
      );
    case 'authorization_expired':
    case 'not_authorized':
      return refused(409, 'failed', 'The payment did not start. Try again.');
    case 'forbidden':
      return forbidden;
    case 'worker not configured':
      return {
        status: 503,
        body: {
          outcome: 'failed',
          code: 'payment_service_unavailable',
          message: 'Payment automation is not configured.',
        },
      };
    default:
      return {
        status: 502,
        body: {
          outcome: 'failed',
          code: 'payment_failed',
          message: 'The automated payment could not be completed.',
        },
      };
  }
}
