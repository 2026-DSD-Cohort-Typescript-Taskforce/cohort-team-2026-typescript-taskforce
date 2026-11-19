'use client';

import { Fragment, useEffect, useRef, useState } from 'react';
import { ErrorAlert, Spinner, SuccessAlert, primaryButton, secondaryButton } from '@/app/ui';
import { formatAmount, type Bill } from '@/lib/bill-view';
import { loadUserRole } from '@/lib/bill-api';
import {
  canShowPaymentTrigger,
  loadPaymentReceipt,
  paymentReceiptDetails,
  paymentTriggerNotice,
  triggerBillPayment,
  type PaymentReceiptDetails,
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
  const [receipt, setReceipt] = useState<
    (PaymentReceiptDetails & { loading: boolean; url?: string; error?: string }) | null
  >(null);
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

  useEffect(() => {
    if (!receipt || receipt.status !== 'stored' || receipt.url || receipt.error) return;
    let active = true;
    loadPaymentReceipt(bill.bill_id, receipt.paymentId)
      .then((result) => {
        if (!active || !result) return;
        if (result.ok)
          setReceipt((current) =>
            current ? { ...current, loading: false, url: result.data.url } : null,
          );
        else
          setReceipt((current) =>
            current ? { ...current, loading: false, error: result.error } : null,
          );
      })
      .catch(() => {
        if (active)
          setReceipt((current) =>
            current
              ? { ...current, loading: false, error: 'The receipt could not be loaded.' }
              : null,
          );
      });
    return () => {
      active = false;
    };
  }, [bill.bill_id, receipt]);

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
    setReceipt(null);
    try {
      const result = await triggerBillPayment(bill.bill_id);
      if (result?.ok) {
        setNotice(paymentTriggerNotice(result.data));
        if (result.data.outcome === 'success') {
          const details = paymentReceiptDetails(result.data);
          if (details) setReceipt({ ...details, loading: details.status === 'stored' });
          await onCompleted?.();
        }
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

      {receipt && (
        <div className="mt-4 rounded-input border border-subtle bg-background p-4">
          <h3 className="text-body font-semibold">Payment receipt</h3>
          {receipt.loading && (
            <p role="status" className="mt-2 text-body-sm text-secondary">
              Loading receipt…
            </p>
          )}
          {receipt.url && (
            // The URL is a short-lived, authorized Supabase Storage URL.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={receipt.url}
              alt={`Payment receipt for invoice ${bill.invoice_number ?? bill.bill_id}`}
              onError={() =>
                setReceipt((current) =>
                  current
                    ? {
                        ...current,
                        url: undefined,
                        error: 'Payment completed, but the receipt image could not be displayed.',
                      }
                    : null,
                )
              }
              className="mt-4 max-h-[36rem] w-full rounded-input border border-subtle bg-white object-contain"
            />
          )}
          {!receipt.loading && !receipt.url && (
            <p role="status" className="mt-2 text-body-sm text-secondary">
              {receipt.error ?? 'Payment completed, but the receipt image is not available yet.'}
            </p>
          )}
        </div>
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
