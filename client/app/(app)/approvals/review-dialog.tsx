"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { DECISIONS, NOTE_MAX, noteLength, paymentTypeLabel, type Decision } from "@/lib/approvals";
import { decideBill } from "@/lib/bill-api";
import { formatAmount, formatDate, type Bill } from "@/lib/bill-view";
import { ErrorAlert, Spinner, colorTransition, focusRing, primaryButton } from "@/app/ui";

// Text and border colours are left to each control, which changes them with its state.
const controlClass = `w-full rounded-input border bg-background px-4 text-body disabled:cursor-not-allowed disabled:border-subtle disabled:text-disabled-foreground ${colorTransition} ${focusRing}`;

// Chrome 135+ (appearance: base-select) draws the open list inside the page, in the theme's
// colours, so it also shows in screenshots. Other browsers keep their native select. The long
// option text wraps there, in the list and in the select (min-h, not h), instead of overflowing.
const pickerClass = [
  "[appearance:base-select]",
  "items-center",
  "[&::picker(select)]:[appearance:base-select]",
  "[&::picker(select)]:mt-1",
  "[&::picker(select)]:w-[anchor-size(self-inline)]",
  "[&::picker(select)]:rounded-input",
  "[&::picker(select)]:border-strong",
  "[&::picker(select)]:bg-overlay",
  "[&::picker(select)]:p-1",
  "[&::picker(select)]:text-foreground",
  "[&::picker(select)]:not-italic",
  "[&::picker(select)]:shadow-l4",
  "[&_option]:rounded-input",
  "[&_option]:px-3",
  "[&_option]:py-2",
  "[&_option]:whitespace-normal",
  "[&_option:hover]:bg-raised",
  "[&_option:focus-visible]:bg-raised",
].join(" ");

export function AmountPill({ amount }: { amount: number | null }) {
  return (
    <span className="inline-flex shrink-0 items-center rounded-full border border-strong bg-raised px-3 py-1 text-body-sm font-semibold whitespace-nowrap">
      {formatAmount(amount)}
    </span>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap gap-x-2">
      <dt className="text-secondary">{label}</dt>
      <dd className="font-medium break-words">{value}</dd>
    </div>
  );
}

/**
 * The review modal for one pending bill (mockups 2–4). It opens when mounted; the parent
 * unmounts it on onClose. Anyone can read it; only a financial approver can decide.
 */
export function ReviewDialog({
  bill,
  canDecide,
  onClose,
  onDecided,
  onGone,
}: {
  bill: Bill;
  /** null while the role loads: the form stays disabled, with no notice yet. */
  canDecide: boolean | null;
  onClose: () => void;
  onDecided: (billId: number, decision: Decision) => void;
  /** 409 (someone else decided the bill first) or 404 (it was deleted): it is gone from the queue. */
  onGone: (message: string) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [decision, setDecision] = useState<Decision | "">("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const noteId = useId();
  const counterId = useId();
  const noticeId = useId();

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  const length = noteLength(note);
  const tooLong = length > NOTE_MAX;
  const readOnly = canDecide === false;

  // The server checks the role, the status and the note again.
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canDecide || decision === "" || tooLong || submitting) return;
    setError("");
    setSubmitting(true);
    const result = await decideBill(bill.bill_id, decision, note);
    // null: apiFetch is sending the user to /login.
    if (!result) return;
    setSubmitting(false);
    if (result.ok) {
      dialogRef.current?.close();
      onDecided(bill.bill_id, decision);
    } else if (result.status === 404 || result.status === 409) {
      dialogRef.current?.close();
      onGone(result.error);
    } else {
      setError(result.error);
    }
  }

  const vendor = bill.vendor?.name ?? "—";

  return (
    <dialog
      ref={dialogRef}
      aria-label={`Review bill ${bill.bill_id}`}
      // Esc can't close it while the decision is being saved.
      onCancel={(event) => {
        if (submitting) event.preventDefault();
      }}
      onClose={onClose}
      className="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-xl overflow-y-auto rounded-card border border-strong bg-overlay p-6 text-foreground shadow-l4 backdrop:bg-background/80 sm:p-8"
    >
      <button
        type="button"
        onClick={() => dialogRef.current?.close()}
        disabled={submitting}
        className={`inline-flex items-center gap-2 rounded-button text-body-lg font-medium text-secondary hover:text-foreground disabled:cursor-not-allowed disabled:text-disabled-foreground ${colorTransition} ${focusRing}`}
      >
        <span aria-hidden="true">←</span>
        <span className="underline underline-offset-4">Back</span>
      </button>

      <section aria-label="Bill details" className="mt-6 rounded-card border border-strong p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-1">
            <p className="text-body-sm text-secondary">Bill Vendor</p>
            <h2 className="text-subheading break-words sm:text-heading">{vendor}</h2>
          </div>
          <AmountPill amount={bill.amount} />
        </div>
        <dl className="mt-4 flex flex-col gap-2 text-body">
          <Detail label="Bill #" value={String(bill.bill_id)} />
          <Detail label="Invoice #" value={bill.invoice_number ?? "—"} />
        </dl>
        <div className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <dl className="flex min-w-0 flex-col gap-2 text-body">
            <Detail label="Property" value={bill.property?.name ?? "—"} />
            <Detail label="Payment Type" value={paymentTypeLabel(bill.payment?.payment_type ?? null)} />
            <Detail label="Payment Method" value={bill.payment?.name ?? "—"} />
            <Detail label="Issued" value={bill.date_issued ? formatDate(bill.date_issued) : "—"} />
            <Detail label="Received" value={formatDate(bill.date_received)} />
          </dl>
          <p className="flex shrink-0 flex-col gap-2 text-body text-secondary italic sm:text-right">
            <span>Unpaid</span>
            <span>{bill.date_due ? `Due ${formatDate(bill.date_due)}` : "No due date"}</span>
          </p>
        </div>
      </section>

      <div className="mt-6 flex flex-col gap-1">
        <p className="flex items-center gap-2 text-body text-secondary">
          <span aria-hidden="true" className="size-2.5 shrink-0 rounded-full bg-warning-bright" />
          Bill Status
        </p>
        <p className="pl-4.5 text-body text-secondary">
          <strong className="font-semibold text-foreground">Pending</strong> approval for bill payment
        </p>
        <p className="pl-4.5 text-caption text-secondary">Status Message: Bill submitted for approval.</p>
      </div>

      <form onSubmit={submit} className="mt-6 flex flex-col gap-4">
        {readOnly && (
          <p
            id={noticeId}
            className="rounded-input border border-info-border bg-info-surface px-4 py-2 text-body-sm text-info-foreground"
          >
            Only financial approvers can decide on bills.
          </p>
        )}
        <fieldset
          disabled={!canDecide || submitting}
          aria-describedby={readOnly ? noticeId : undefined}
          className="flex min-w-0 flex-col gap-4"
        >
          <legend className="mb-2 text-body-lg font-medium">Approval Notes</legend>
          {/* The empty first option is the placeholder: hidden from the list, so it can't be chosen. */}
          <select
            aria-label="Approval decision"
            value={decision}
            onChange={(event) => setDecision(event.target.value as Decision)}
            className={`min-h-12 border-strong py-2.5 focus-visible:border-primary ${controlClass} ${decision === "" ? "text-secondary italic" : "text-foreground"} ${pickerClass}`}
          >
            <option value="" disabled hidden>
              Approval decision
            </option>
            {DECISIONS.map((d) => (
              <option key={d.value} value={d.value}>
                {`${d.label} — ${d.description}`}
              </option>
            ))}
          </select>
          <div className="flex flex-col gap-1">
            <label htmlFor={noteId} className="text-body-sm text-secondary">
              Note (optional)
            </label>
            <textarea
              id={noteId}
              rows={3}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              aria-describedby={counterId}
              aria-invalid={tooLong || undefined}
              className={`resize-y py-3 text-foreground ${controlClass} ${tooLong ? "border-danger" : "border-strong focus-visible:border-primary"}`}
            />
            <p
              id={counterId}
              className={`self-end text-caption ${tooLong ? "font-semibold text-danger" : "text-secondary"}`}
            >
              {length}/{NOTE_MAX}
            </p>
          </div>
        </fieldset>
        <ErrorAlert message={error} />
        {/* aria-disabled, not disabled, while submitting: the button keeps focus, so a failed
            save leaves the user on it rather than on the page body. submit() ignores the click. */}
        <button
          type="submit"
          disabled={!canDecide || decision === "" || tooLong}
          aria-disabled={submitting || undefined}
          data-pending={submitting || undefined}
          className={`w-full sm:w-auto sm:min-w-48 sm:self-center ${primaryButton}`}
        >
          {submitting && <Spinner />}
          {submitting ? "Submitting…" : "Submit"}
        </button>
      </form>
    </dialog>
  );
}
