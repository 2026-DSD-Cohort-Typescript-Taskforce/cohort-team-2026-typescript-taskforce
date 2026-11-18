'use client';

// My Bills: every bill the user can see, newest first, with a search box and a status
// filter, scrolling inside its half of the right column. A draft opens its fix form in
// Current issues; any other bill links to its View Bill page.

import Link from 'next/link';
import { useId, useState } from 'react';
import { billRow, filterBills, statusOptions } from '@/lib/bill-list-filter';
import type { Bill } from '@/lib/bill-view';
import { ErrorAlert, Spinner, colorTransition, focusRing, secondaryButton } from '@/app/ui';
import { useBills } from './bills-provider';
import { useIntake } from './intake-provider';
import { StatusChip } from './status-chip';

const controlClass = `h-12 rounded-input border border-strong bg-background px-4 text-body text-foreground placeholder:text-secondary focus-visible:border-primary ${colorTransition} ${focusRing}`;

/** Every bill the user can see, newest first, with a search box and a status filter. */
export function BillsList() {
  const { bills, error, loading, refresh } = useBills();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const searchId = useId();
  const statusId = useId();

  if (!bills) {
    return (
      <div className="h-full min-h-0">
        {error ? (
          <LoadError message={error} retrying={loading} onRetry={refresh} />
        ) : (
          <ListSkeleton />
        )}
      </div>
    );
  }

  if (bills.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-4">
        {error && <LoadError message={error} retrying={loading} onRetry={refresh} />}
        <div className="flex-1 rounded-card border border-subtle bg-surface">
          <p className="px-5 py-6 text-body text-secondary">No bills yet.</p>
        </div>
      </div>
    );
  }

  const options = statusOptions(bills);
  // A status no bill has any more (after a refresh) shows every bill.
  const activeStatus = options.some((option) => option.value === status) ? status : '';
  const shown = filterBills(bills, query, activeStatus);

  function clearFilters() {
    setQuery('');
    setStatus('');
  }

  return (
    <section aria-label="Bills list" className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden">
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <label htmlFor={searchId} className="text-body-sm text-secondary">
            Search
          </label>
          <input
            id={searchId}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Vendor, property, invoice or due date"
            autoComplete="off"
            className={`w-full ${controlClass}`}
          />
        </div>
        <div className="flex flex-col gap-1 sm:w-56">
          <label htmlFor={statusId} className="text-body-sm text-secondary">
            Status
          </label>
          <select
            id={statusId}
            value={activeStatus}
            onChange={(event) => setStatus(event.target.value)}
            className={`w-full ${controlClass}`}
          >
            <option value="">All statuses</option>
            {options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
        {error && <LoadError message={error} retrying={loading} onRetry={refresh} />}

        <p role="status" className="sr-only">
          {shown.length === bills.length
            ? `${bills.length} ${bills.length === 1 ? 'bill' : 'bills'}`
            : `Showing ${shown.length} of ${bills.length} bills`}
        </p>

        {shown.length > 0 ? (
          <ul aria-label="Bills" className="flex flex-col gap-3">
            {shown.map((bill) => (
              <BillRow key={bill.bill_id} bill={bill} />
            ))}
          </ul>
        ) : (
          <div className="flex flex-col items-start gap-4 rounded-card border border-subtle bg-surface p-6">
            <p className="text-body text-secondary">No bills match your search.</p>
            <button type="button" onClick={clearFilters} className={secondaryButton}>
              Clear search
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

/** The load failed: its message and a Retry button. A failed refresh keeps the list shown. */
export function LoadError({
  message,
  retrying,
  onRetry,
}: {
  message: string;
  retrying: boolean;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-col items-start gap-3">
      <ErrorAlert message={message} />
      <button
        type="button"
        onClick={onRetry}
        disabled={retrying}
        data-pending={retrying || undefined}
        className={secondaryButton}
      >
        {retrying && <Spinner />}
        {retrying ? 'Retrying…' : 'Retry'}
      </button>
    </div>
  );
}

/** Four placeholder rows in the rows' shape while the first load runs. */
function ListSkeleton() {
  return (
    <div role="status" className="flex flex-col gap-3">
      <span className="sr-only">Loading the bills…</span>
      {[0, 1, 2, 3].map((row) => (
        <div
          key={row}
          aria-hidden="true"
          className="flex items-start gap-4 rounded-card border border-subtle bg-surface p-4 motion-safe:animate-pulse sm:p-5"
        >
          <span className="size-10 shrink-0 rounded-full bg-raised" />
          <span className="flex flex-1 flex-col gap-2 pt-1">
            <span className="h-5 w-1/2 rounded-input bg-raised" />
            <span className="h-4 w-1/3 rounded-input bg-raised" />
            <span className="h-4 w-2/5 rounded-input bg-raised" />
            <span className="h-4 w-1/4 rounded-input bg-raised" />
          </span>
        </div>
      ))}
    </div>
  );
}

const rowClass = `flex w-full items-start gap-4 rounded-card border border-subtle bg-surface p-4 text-left hover:border-primary hover:bg-raised sm:p-5 ${colorTransition} ${focusRing}`;

/** A draft opens its fix form in Current issues; any other bill opens its View Bill page. */
function BillRow({ bill }: { bill: Bill }) {
  const { setPanel } = useIntake();
  const content = <BillRowContent bill={bill} />;
  return (
    <li>
      {bill.status === 'draft' ? (
        <button
          type="button"
          onClick={() => setPanel({ kind: 'fix', billId: bill.bill_id })}
          className={rowClass}
        >
          {content}
        </button>
      ) : (
        <Link href={`/bills/${bill.bill_id}`} className={rowClass}>
          {content}
        </Link>
      )}
    </li>
  );
}

function BillRowContent({ bill }: { bill: Bill }) {
  const row = billRow(bill);
  return (
    <>
      <span
        aria-hidden="true"
        className="flex size-10 shrink-0 items-center justify-center rounded-full border border-strong bg-raised text-body-sm font-semibold"
      >
        {row.initials}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <span className="flex min-w-0 flex-col">
            <span className="text-body-lg font-semibold break-words">{row.vendor}</span>
            <span className="text-body-sm break-words text-secondary">{row.property}</span>
          </span>
          <StatusChip status={bill.status} />
        </span>
        <span className="text-body-sm break-words">
          {row.payment ?? (
            <>
              <span aria-hidden="true">—</span>
              <span className="sr-only">No payment method</span>
            </>
          )}
        </span>
        <span className="text-body-sm">
          {row.amount} · {row.due}
        </span>
      </span>
    </>
  );
}
