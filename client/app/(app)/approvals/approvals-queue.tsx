"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { DataTable, type Column } from "@/components/ui/data-table";
import {
  APPROVALS_DEFAULT_SORT,
  FINANCIAL_APPROVER,
  approvalRow,
  decisionBanner,
  type ApprovalRow,
  type Decision,
} from "@/lib/approvals";
import { loadApprovals, loadUserRole } from "@/lib/bill-api";
import { formatDate, type Bill } from "@/lib/bill-view";
import { ErrorAlert, SuccessAlert, colorTransition, focusRing } from "@/app/ui";
import { LoadError } from "../bills/bills-list";
import { StatusChip } from "../bills/status-chip";
import { AmountPill, ReviewDialog } from "./review-dialog";

// Module scope, so DataTable's column definitions stay the same between renders.
const columns: Column<ApprovalRow>[] = [
  { key: "bill_id", label: "Bill ID" },
  { key: "vendor", label: "Vendor Name" },
  { key: "property", label: "Property Name" },
  {
    key: "date_due",
    label: "Bill Due Date",
    render: (row) => <span className="whitespace-nowrap">{row.date_due ? formatDate(row.date_due) : "—"}</span>,
  },
  { key: "payment_type", label: "Bill Payment Type" },
  { key: "amount", label: "Amount Due", render: (row) => <AmountPill amount={row.amount} /> },
  { key: "status", label: "Bill Status", render: (row) => <StatusChip status={row.status} /> },
];

/** The bills waiting for an approval decision, and the review modal (DC-81). */
export function ApprovalsQueue() {
  /** null until the first load succeeds. */
  const [bills, setBills] = useState<Bill[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(true);
  /** null while the role loads; false if it isn't financial_approver or didn't load. */
  const [canDecide, setCanDecide] = useState<boolean | null>(null);
  const [reviewing, setReviewing] = useState<Bill | null>(null);
  const [success, setSuccess] = useState("");
  const [error, setError] = useState("");
  const headingRef = useRef<HTMLHeadingElement>(null);
  // The ⋮ button that opened the modal, which gets focus back when it closes.
  const openerRef = useRef<HTMLButtonElement | null>(null);
  // Only the newest load's answer is shown, if reloads overlap.
  const latest = useRef(0);

  const load = useCallback(() => {
    const request = ++latest.current;
    loadApprovals().then((result) => {
      // null: apiFetch is sending the user to /login.
      if (!result || request !== latest.current) return;
      if (result.ok) {
        setBills(result.data);
        setLoadError("");
      } else {
        setLoadError(result.error);
      }
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Never assumed: the form stays disabled until the role says financial_approver.
  useEffect(() => {
    let active = true;
    loadUserRole().then((result) => {
      if (active && result) setCanDecide(result.ok && result.data === FINANCIAL_APPROVER);
    });
    return () => {
      active = false;
    };
  }, []);

  const rows = useMemo(() => bills?.map(approvalRow) ?? [], [bills]);

  function reload() {
    setLoading(true);
    load();
  }

  function openReview(bill: Bill, opener: HTMLButtonElement) {
    // Cleared now, so the outcome of this review is announced even if it repeats the last one.
    setSuccess("");
    setError("");
    openerRef.current = opener;
    setReviewing(bill);
  }

  function closeReview() {
    setReviewing(null);
    const opener = openerRef.current;
    openerRef.current = null;
    if (opener?.isConnected) opener.focus();
  }

  // The bill's ⋮ button goes with its row (or with the reload), so focus moves to the heading.
  function focusHeading() {
    openerRef.current = null;
    headingRef.current?.focus();
  }

  function decided(billId: number, decision: Decision) {
    setBills((current) => current?.filter((bill) => bill.bill_id !== billId) ?? current);
    setSuccess(decisionBanner(decision, billId));
    focusHeading();
  }

  function conflicted(message: string) {
    setError(message);
    reload();
    focusHeading();
  }

  let content: ReactNode;
  if (!bills) {
    content = loadError ? (
      <LoadError message={loadError} retrying={loading} onRetry={reload} />
    ) : (
      <p role="status" className="text-body text-secondary">
        Loading bills…
      </p>
    );
  } else {
    content = (
      <div className="flex flex-col gap-4">
        {/* A failed reload keeps the table shown. */}
        {loadError && <LoadError message={loadError} retrying={loading} onRetry={reload} />}
        {bills.length === 0 ? (
          <div className="rounded-card border border-subtle bg-surface p-6 sm:p-8">
            <p className="text-body-lg font-medium">No bills are waiting for approval.</p>
          </div>
        ) : (
          <DataTable
            columns={columns}
            rows={rows}
            initialSorting={APPROVALS_DEFAULT_SORT}
            filterable={false}
            rowAction={{
              label: "Review",
              render: (row) => (
                <button
                  type="button"
                  aria-label={`Review bill ${row.bill_id}`}
                  aria-haspopup="dialog"
                  onClick={(event) => openReview(row.bill, event.currentTarget)}
                  className={`inline-flex size-10 items-center justify-center rounded-button text-secondary hover:bg-overlay hover:text-foreground ${colorTransition} ${focusRing}`}
                >
                  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="size-5">
                    <circle cx="12" cy="5" r="1.75" />
                    <circle cx="12" cy="12" r="1.75" />
                    <circle cx="12" cy="19" r="1.75" />
                  </svg>
                </button>
              ),
            }}
          />
        )}
      </div>
    );
  }

  return (
    <>
      {/* tabIndex -1: takes focus after a decision removes the row whose button had it. */}
      <h1 ref={headingRef} tabIndex={-1} className="text-heading outline-none">
        Approvals
      </h1>
      {/* The alerts bring their own margin, so no gap is left while they are empty. */}
      <div className="flex flex-col">
        <SuccessAlert message={success} className="mb-6" />
        <ErrorAlert message={error} className="mb-6" />
        {content}
      </div>
      {reviewing && (
        <ReviewDialog
          key={reviewing.bill_id}
          bill={reviewing}
          canDecide={canDecide}
          onClose={closeReview}
          onDecided={decided}
          onConflict={conflicted}
        />
      )}
    </>
  );
}
