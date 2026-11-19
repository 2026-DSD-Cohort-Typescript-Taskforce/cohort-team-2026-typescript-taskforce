'use client';

import { Fragment, useEffect, useRef, useState } from 'react';
import { ErrorAlert, Spinner, SuccessAlert, primaryButton, secondaryButton } from '@/app/ui';
import { loadUserRole } from '@/lib/bill-api';
import {
  canShowPaymentTrigger,
  localDate,
  paymentSummary,
  paymentTriggerNotice,
  triggerBillPayment,
  type PaymentTriggerBill,
} from '@/lib/payment-trigger';

type Props = {
  bill: PaymentTriggerBill;
  onCompleted?: () => void | Promise<void>;
};

/** Reusable manual-payment control; the route independently enforces system-admin access. */
export function PaymentAutomationTrigger({ bill, onCompleted }: Props) {
  const [role, setRole] = useState<string | null>();
  const [running, setRunning] = useState(false);
  // Set when the dialog opens, so the date sent is the one shown.
  const [paymentDate, setPaymentDate] = useState(localDate);
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

  const { rows: summary, shown } = paymentSummary(bill, paymentDate);
  const eligible = shown !== null;

  async function execute() {
    if (running || shown === null) return;
    setRunning(true);
    setNotice(null);
    try {
      const result = await triggerBillPayment(bill.bill_id, shown);
      if (result?.ok) {
        setNotice(paymentTriggerNotice(result.data));
      } else if (result) {
        const outcome = result.code === 'outcome_unknown' ? 'unknown' : 'failed';
        setNotice(paymentTriggerNotice({ outcome, message: result.error }));
      }
      // A policy can send the bill back for approval, so the bill reloads after every answer.
      if (result) await onCompleted?.();
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
              : 'This bill must be pending payment or payment failed, with its vendor, invoice, payment method and amount set, before automation can run.'}
          </p>
        </div>
        <button
          type="button"
          disabled={!eligible || running}
          onClick={() => {
            setPaymentDate(localDate());
            dialogRef.current?.showModal();
          }}
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
