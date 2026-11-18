'use client';

import { Fragment, useEffect, useRef, useState } from 'react';
import { ErrorAlert, Spinner, SuccessAlert, primaryButton, secondaryButton } from '@/app/ui';
import { formatAmount, type Bill } from '@/lib/bill-view';
import { loadUserRole } from '@/lib/bill-api';
import {
  canShowPaymentTrigger,
  paymentTriggerNotice,
  triggerBillPayment,
} from '@/lib/payment-trigger';

type Props = {
  bill: Pick<Bill, 'bill_id' | 'status' | 'invoice_number' | 'amount' | 'vendor'>;
  onCompleted?: () => void | Promise<void>;
};

/** Reusable manual-payment control; the route independently enforces system-admin access. */
export function PaymentAutomationTrigger({ bill, onCompleted }: Props) {
  const [role, setRole] = useState<string | null>();
  const [running, setRunning] = useState(false);
  const [notice, setNotice] = useState<{
    tone: 'success' | 'warning' | 'error';
    message: string;
  } | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    let active = true;
    loadUserRole().then((result) => {
      if (active) setRole(result?.ok ? result.data : null);
    });
    return () => {
      active = false;
    };
  }, []);

  if (!canShowPaymentTrigger(role)) return null;

  const eligible = bill.status === 'pending_payment';
  const summary: [string, string][] = [
    ['Vendor', bill.vendor?.name ?? 'Missing'],
    ['Invoice', bill.invoice_number ?? 'Missing'],
    ['Amount', formatAmount(bill.amount)],
  ];

  async function execute() {
    if (running) return;
    setRunning(true);
    setNotice(null);
    try {
      const result = await triggerBillPayment(bill.bill_id);
      if (result?.ok) {
        setNotice(paymentTriggerNotice(result.data));
        if (result.data.outcome === 'success') await onCompleted?.();
      } else if (result) {
        const outcome = result.code === 'outcome_unknown' ? 'unknown' : 'failed';
        setNotice(paymentTriggerNotice({ outcome, message: result.error }));
      }
    } catch {
      setNotice({ tone: 'error', message: 'The automated payment could not be completed.' });
    } finally {
      setRunning(false);
      dialogRef.current?.close();
    }
  }

  return (
    <section
      aria-label="Payment automation"
      className="mt-6 rounded-card border border-subtle bg-surface p-6 sm:p-8"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-subheading">Payment automation</h2>
          <p className="mt-1 text-body-sm text-secondary">
            {eligible
              ? 'Manually run the approved payment workflow for testing.'
              : 'This bill must be pending payment before automation can run.'}
          </p>
        </div>
        <button
          type="button"
          disabled={!eligible || running}
          onClick={() => dialogRef.current?.showModal()}
          className={primaryButton}
        >
          Trigger payment
        </button>
      </div>

      {notice?.tone === 'success' && <SuccessAlert message={notice.message} className="mt-4" />}
      {notice?.tone === 'error' && <ErrorAlert message={notice.message} className="mt-4" />}
      {notice?.tone === 'warning' && (
        <p
          role="alert"
          className="mt-4 rounded-input border border-warning-border bg-warning-surface px-4 py-2 text-body-sm text-warning-foreground"
        >
          {notice.message}
        </p>
      )}

      <dialog
        ref={dialogRef}
        aria-labelledby="payment-trigger-title"
        aria-describedby="payment-trigger-warning"
        onCancel={(event) => running && event.preventDefault()}
        className="m-auto w-[calc(100%-2rem)] max-w-lg rounded-card border border-strong bg-overlay p-6 text-foreground shadow-l4 backdrop:bg-background/80 sm:p-8"
      >
        <h2 id="payment-trigger-title" className="text-subheading">
          Trigger this payment?
        </h2>
        <dl className="mt-6 grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 text-body">
          {summary.map(([label, value]) => (
            <Fragment key={label}>
              <dt className="text-secondary">{label}</dt>
              <dd className="font-medium">{value}</dd>
            </Fragment>
          ))}
        </dl>
        <p id="payment-trigger-warning" className="mt-6 text-body-sm text-secondary">
          This starts the real automated payment flow. Do not click it again if the outcome is
          uncertain.
        </p>
        <div className="mt-8 flex flex-col-reverse gap-4 sm:flex-row sm:justify-end">
          <button
            type="button"
            disabled={running}
            onClick={() => dialogRef.current?.close()}
            className={secondaryButton}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={running}
            data-pending={running || undefined}
            onClick={execute}
            className={primaryButton}
          >
            {running && <Spinner />}
            {running ? 'Running…' : 'Trigger payment'}
          </button>
        </div>
      </dialog>
    </section>
  );
}
