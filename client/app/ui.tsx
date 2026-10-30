// Shared Emerald dark controls. Colours come from the tokens in globals.css.

export const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

// Leaves out outline-color, so the focus ring does not fade in from the text colour.
export const colorTransition = "motion-safe:transition-[color,background-color,border-color]";

// data-pending keeps a busy button mint (with its spinner) instead of the muted disabled look.
export const primaryButton = `inline-flex h-12 items-center justify-center gap-2 rounded-button bg-primary px-6 text-body font-semibold text-on-primary hover:bg-primary-hover active:bg-primary-pressed disabled:cursor-not-allowed disabled:bg-disabled disabled:text-disabled-foreground data-pending:cursor-wait data-pending:bg-primary data-pending:text-on-primary ${colorTransition} ${focusRing}`;

export const secondaryButton = `inline-flex h-12 items-center justify-center gap-2 rounded-button border border-strong px-6 text-body font-semibold text-foreground hover:border-primary hover:bg-raised active:bg-overlay disabled:cursor-not-allowed disabled:border-subtle disabled:text-disabled-foreground data-pending:cursor-wait data-pending:border-strong data-pending:bg-raised data-pending:text-foreground ${colorTransition} ${focusRing}`;

export function Spinner() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="size-5 motion-safe:animate-spin">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.3" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

// The role="alert" element stays mounted so screen readers announce a message when it appears;
// only the box inside it comes and goes.
export function ErrorAlert({
  id,
  message,
  className = "",
}: {
  id?: string;
  message: string;
  className?: string;
}) {
  return (
    <div id={id} role="alert">
      {message && (
        <p
          className={`flex items-start gap-2 rounded-input border border-error-border bg-error-surface px-4 py-2 text-body-sm text-error-foreground ${className}`}
        >
          <svg
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            aria-hidden="true"
            className="size-5 shrink-0"
          >
            <circle cx="10" cy="10" r="7.5" />
            <path d="m7.5 7.5 5 5m0-5-5 5" />
          </svg>
          <span>{message}</span>
        </p>
      )}
    </div>
  );
}
