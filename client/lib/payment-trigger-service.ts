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
  if (
    ['not_pending_payment', 'not_approved', 'snapshot_mismatch', 'no portal url'].includes(code)
  ) {
    return {
      status: 409,
      body: {
        outcome: 'ineligible',
        code,
        message: 'This bill is not eligible for automated payment.',
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
