import Link from "next/link";
import { focusRing, colorTransition } from "@/app/ui";

export type FailedExtraction = {
  id: string;
  title: string;
  message: string;
  severity: "warning" | "error";
  href?: string;
};

const seeMore = `inline-flex h-10 shrink-0 items-center justify-center rounded-button border border-strong px-4 text-body-sm font-semibold text-foreground hover:border-primary hover:bg-raised ${colorTransition} ${focusRing}`;

/**
 * Sits under the bills list (FigJam "Current Issues"). Each row is one extraction that
 * did not finish, with the status message and a way to open it.
 */
export function FailedExtractions({ issues }: { issues: FailedExtraction[] }) {
  return (
    <section aria-label="Failed extractions" className="shrink-0 rounded-card border border-subtle bg-surface">
      <h2 className="flex items-center gap-2 border-b border-subtle px-5 py-4 text-body-lg font-semibold">
        Current issues
        <WarningMark />
      </h2>
      {issues.length === 0 ? (
        <p className="px-5 py-6 text-body text-secondary">No failed extractions.</p>
      ) : (
        <ul className="flex flex-col">
          {issues.map((issue) => (
            <li key={issue.id} className="flex items-center gap-4 border-b border-subtle px-5 py-4 last:border-b-0">
              <span
                aria-hidden="true"
                className={`size-2.5 shrink-0 rounded-full ${issue.severity === "error" ? "bg-danger-bright" : "bg-warning-bright"}`}
              />
              <span className="min-w-0 flex-1">
                <span className="block text-body font-semibold break-words">{issue.title}</span>
                <span className="block text-body-sm text-secondary break-words">Status message: {issue.message}</span>
              </span>
              {issue.href ? (
                <Link href={issue.href} className={seeMore}>
                  See more
                </Link>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function WarningMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-5 text-warning-bright">
      <path
        fill="currentColor"
        d="M12 3.2 1.8 21h20.4L12 3.2Zm0 6.3c.5 0 .9.4.9.9v4.2a.9.9 0 0 1-1.8 0v-4.2c0-.5.4-.9.9-.9Zm0 9.1a1.1 1.1 0 1 1 0-2.2 1.1 1.1 0 0 1 0 2.2Z"
      />
    </svg>
  );
}
