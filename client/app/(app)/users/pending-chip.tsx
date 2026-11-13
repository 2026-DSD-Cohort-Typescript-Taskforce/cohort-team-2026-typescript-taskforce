// A user who hasn't accepted the invite yet (no login). The warning tones of
// bills/status-chip.tsx.
export function PendingChip() {
  return (
    <span className="inline-flex shrink-0 items-center rounded-full border border-warning-border bg-warning-surface px-3 py-1 text-caption font-semibold whitespace-nowrap text-warning-foreground">
      Pending confirmation
    </span>
  );
}
