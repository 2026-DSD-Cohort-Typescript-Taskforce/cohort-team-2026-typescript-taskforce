'use client';

// The View Bill page's content: one bill's details and status. A complete draft can be
// submitted for payment from here after a confirmation; a draft that's still missing
// details offers "Finish this bill" instead, which opens its fix form on the Bills page.

import Link from 'next/link';
import { Fragment, useEffect, useRef, useState } from 'react';
import { apiFetch } from '@/lib/api-fetch';
import { FIELD_LABELS, formatAmount, formatDate, type Bill } from '@/lib/bill-view';
import { billMissing } from '@/lib/current-issues';
import { ErrorAlert, Spinner, SuccessAlert, primaryButton, secondaryButton } from '@/app/ui';
import { StatusChip } from '../status-chip';

const UNREACHABLE = 'Could not reach the server. Try again.';

/** The bill, a readable error, or null when apiFetch is sending the user to /login. */
async function fetchBill(id: string): Promise<{ bill: Bill } | { error: string } | null> {
  try {
    const res = await apiFetch(`/api/bills/${encodeURIComponent(id)}`);
    if (!res) return null;
    const body = await res.json().catch(() => null);
    if (res.ok) return { bill: body.bill };
    return { error: body?.error ?? "Couldn't load the bill. Try again." };
  } catch {
    return { error: UNREACHABLE };
  }
}

export function BillDetails({ id }: { id: string }) {
  const [bill, setBill] = useState<Bill | null>(null);
  const [loadError, setLoadError] = useState('');
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    let active = true;
    fetchBill(id).then((result) => {
      if (!active || !result) return;
      if ('bill' in result) setBill(result.bill);
      else setLoadError(result.error);
    });
    return () => {
      active = false;
    };
  }, [id]);

  // The server checks the role, status and required fields; the page doesn't pre-check.
  async function submit() {
    if (!bill || submitting) return;
    // Cleared first, so a repeated message is announced again.
    setSuccess('');
    setError('');
    setSubmitting(true);
    try {
      const res = await apiFetch(`/api/bills/${bill.bill_id}/submit`, { method: 'POST' });
      if (!res) return;
      const body = await res.json().catch(() => null);
      if (res.ok) {
        setBill({ ...bill, status: body.bill.status });
        setSuccess('Bill submitted for payment.');
      } else if (body?.code === 'incomplete_bill' && body.fields.length > 0) {
        const labels = body.fields.map((field: string) => FIELD_LABELS[field] ?? field);
        setError(`This bill is missing: ${labels.join(', ')}.`);
      } else {
        setError(body?.error ?? "Couldn't submit the bill. Try again.");
        // The bill is no longer a draft: show what it is now.
        if (res.status === 409) {
          const result = await fetchBill(id);
          if (result && 'bill' in result) setBill(result.bill);
        }
      }
    } catch {
      setError(UNREACHABLE);
    } finally {
      setSubmitting(false);
      dialogRef.current?.close();
    }
  }

  if (!bill) {
    return loadError ? (
      <ErrorAlert message={loadError} />
    ) : (
      <p role="status" className="text-body text-secondary">
        Loading the bill…
      </p>
    );
  }

  const missing = billMissing(bill);
  const vendor = bill.vendor?.name ?? null;
  const property = bill.property?.name ?? null;
  // What submit_bill() requires, as the confirmation lists it.
  const required: [string, string | null][] = [
    ['Vendor', vendor],
    ['Property', property],
    ['Payment type', bill.payment?.name ?? null],
    ['Invoice number', bill.invoice_number],
    ['Amount', formatAmount(bill.amount)],
    ['Due date', bill.date_due && formatDate(bill.date_due)],
  ];
  const details: [string, string | null][] = [
    ...required,
    ['Issued', bill.date_issued && formatDate(bill.date_issued)],
    ['Received', formatDate(bill.date_received)],
  ];

  return (
    <>
      {/* The alerts bring their own margin, so no gap is left while they are empty. */}
      <div className="flex flex-col">
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <h1 className="text-heading">{vendor ?? 'Bill'}</h1>
              <StatusChip status={bill.status} />
            </div>
            {bill.invoice_number && (
              <p className="text-body text-secondary">Invoice {bill.invoice_number}</p>
            )}
          </div>
          {bill.status === 'draft' &&
            (missing.length > 0 ? (
              <Link href={`/bills?fix=${bill.bill_id}`} className={`shrink-0 ${primaryButton}`}>
                Finish this bill
              </Link>
            ) : (
              <button
                type="button"
                onClick={() => dialogRef.current?.showModal()}
                className={`shrink-0 ${primaryButton}`}
              >
                Submit for payment
              </button>
            ))}
        </div>

        <SuccessAlert message={success} className="mb-6" />
        <ErrorAlert message={error} className="mb-6" />

        <section
          aria-label="Bill details"
          className="rounded-card border border-subtle bg-surface p-6 sm:p-8"
        >
          <dl className="grid gap-x-8 gap-y-6 sm:grid-cols-2">
            {details.map(([label, value]) => (
              <div key={label} className="flex flex-col gap-1">
                <dt className="text-body-sm text-secondary">{label}</dt>
                <dd className={value ? 'text-body-lg font-medium' : 'text-body-lg text-secondary'}>
                  {value ?? (label === 'Issued' ? 'Not set' : 'Missing')}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      </div>

      <dialog
        ref={dialogRef}
        aria-labelledby="submit-title"
        aria-describedby="submit-warning"
        // Esc can't close it while the request is in flight.
        onCancel={(event) => {
          if (submitting) event.preventDefault();
        }}
        className="m-auto w-[calc(100%-2rem)] max-w-lg rounded-card border border-strong bg-overlay p-6 text-foreground shadow-l4 backdrop:bg-background/80 sm:p-8"
      >
        <h2 id="submit-title" className="text-subheading">
          Submit this bill for payment?
        </h2>
        <dl className="mt-6 grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 text-body">
          {required.map(([label, value]) => (
            <Fragment key={label}>
              <dt className="text-secondary">{label}</dt>
              <dd className={value ? 'font-medium' : 'font-semibold text-danger'}>
                {value ?? 'Missing'}
              </dd>
            </Fragment>
          ))}
        </dl>
        <p id="submit-warning" className="mt-6 text-body-sm text-secondary">
          This sends the bill for payment with no approval step. You can&apos;t edit it afterwards.
        </p>
        <div className="mt-8 flex flex-col-reverse gap-4 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={() => dialogRef.current?.close()}
            disabled={submitting}
            className={secondaryButton}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={submitting}
            data-pending={submitting || undefined}
            className={primaryButton}
          >
            {submitting && <Spinner />}
            {submitting ? 'Submitting…' : 'Submit'}
          </button>
        </div>
      </dialog>
    </>
  );
}
