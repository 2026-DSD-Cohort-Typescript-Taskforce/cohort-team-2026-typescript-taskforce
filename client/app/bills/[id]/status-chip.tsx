import { statusLabel } from "@/lib/bill-view";

// One tone per bill status (bills_status_check). Unknown statuses look like drafts.
const tones: Record<string, string> = {
  draft: "border-strong bg-raised text-foreground",
  pending_approval: "border-warning-border bg-warning-surface text-warning-foreground",
  approval_denied: "border-error-border bg-error-surface text-error-foreground",
  pending_payment: "border-info-border bg-info-surface text-info-foreground",
  processing: "border-warning-border bg-warning-surface text-warning-foreground",
  payment_success: "border-success-border bg-success-surface text-success-foreground",
  payment_failed: "border-error-border bg-error-surface text-error-foreground",
};

export function StatusChip({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full border px-3 py-1 text-caption font-semibold whitespace-nowrap ${tones[status] ?? tones.draft}`}
    >
      {statusLabel(status)}
    </span>
  );
}
