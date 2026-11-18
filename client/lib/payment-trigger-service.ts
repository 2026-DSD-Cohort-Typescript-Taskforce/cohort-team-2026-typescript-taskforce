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

function ineligibleReason(code: string, body: Record<string, unknown>): string | null {
  const lead = 'This bill is not eligible for automated payment.';
  if (code === 'not_pending_payment') return `${lead} Its status is not pending payment.`;
  if (code === 'not_approved') return `${lead} The newest approval is not approved.`;
  if (code === 'no portal url') return `${lead} The vendor has no payment portal URL.`;
  if (code !== 'snapshot_mismatch') return null;
  const fields = Array.isArray(body.fields)
    ? body.fields.filter((field) => field === 'amount' || field === 'invoice_number')
    : [];
  const missing =
    fields.length === 1 && fields[0] === 'invoice_number'
      ? 'the invoice number'
      : fields.length === 1
        ? 'the amount'
        : 'the invoice number or the amount';
  return `${lead} The signed-in portal page does not show ${missing}.`;
}

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
  invoke: (billId: number) => Promise<BillMcpReply>;
}): Promise<PaymentTriggerReply> {
  if (input.role !== 'system_admin') return forbidden;
  if (input.billId === null) {
    return { status: 404, body: { code: 'not_found', message: 'Bill not found.' } };
  }

  let upstream: BillMcpReply;
  try {
    upstream = await input.invoke(input.billId);
  } catch {
    // The request may have reached bill-mcp before the connection was lost.
    return uncertain();
  }
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
  if (code === 'outcome_unknown') {
    return uncertain();
  }
  if (code === 'record_payment failed') {
    // Stagehand already confirmed the portal payment before this database write.
    return uncertain();
  }
  const ineligible = ineligibleReason(code, upstream.body);
  if (ineligible) {
    return {
      status: 409,
      body: {
        outcome: 'ineligible',
        code,
        message: ineligible,
      },
    };
  }
  if (code === 'worker not configured') {
    return {
      status: 503,
      body: {
        outcome: 'failed',
        code: 'payment_service_unavailable',
        message: 'Payment automation is not configured.',
      },
    };
  }
  return {
    status: 502,
    body: {
      outcome: 'failed',
      code: 'payment_failed',
      message: 'The automated payment could not be completed.',
    },
  };
}
