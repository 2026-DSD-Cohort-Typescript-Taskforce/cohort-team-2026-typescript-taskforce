'use client';

// The Current issues card under My Bills. It lists every draft that's missing details,
// built from the loaded bills so it survives a reload, then this session's notices
// (duplicate, needs review, rejected, failed). Choosing a draft opens its fix form in
// place of the list.

import Link from 'next/link';
import { currentIssues } from '@/lib/current-issues';
import { colorTransition, focusRing } from '@/app/ui';
import { useBills } from './bills-provider';
import { FixBillForm } from './fix-bill-form';
import { useIntake } from './intake-provider';

const rowButton = `flex w-full items-center gap-4 border-b border-subtle px-5 py-4 text-left last:border-b-0 hover:bg-raised ${colorTransition} ${focusRing}`;
const smallButton = `inline-flex h-10 shrink-0 items-center justify-center rounded-button border border-strong px-4 text-body-sm font-semibold text-foreground hover:border-primary hover:bg-raised ${colorTransition} ${focusRing}`;

/**
 * Under the bills list (FigJam "Current Issues"): drafts missing details, then this
 * session's notices. Choosing a draft opens its fix form here.
 */
export function CurrentIssues() {
  const { bills } = useBills();
  const { panel, setPanel, notices, dismissNotice } = useIntake();
  const issues = currentIssues(bills ?? []);

  return (
    <section
      aria-label="Current issues"
      className="flex shrink-0 flex-col overflow-hidden rounded-card border border-subtle bg-surface lg:min-h-0 lg:flex-1 lg:shrink lg:basis-0"
    >
      <h2 className="flex items-center gap-2 border-b border-subtle px-5 py-4 text-body-lg font-semibold">
        Current issues
        <WarningMark />
      </h2>

      {panel.kind === 'fix' ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <FixBillForm key={panel.billId} billId={panel.billId} />
        </div>
      ) : issues.length === 0 && notices.length === 0 ? (
        <p className="px-5 py-6 text-body text-secondary">No current issues.</p>
      ) : (
        <ul className="flex max-h-72 flex-col overflow-y-auto lg:max-h-none lg:min-h-0 lg:flex-1">
          {issues.map((issue) => (
            <li key={`bill-${issue.billId}`}>
              <button
                type="button"
                onClick={() => setPanel({ kind: 'fix', billId: issue.billId })}
                className={rowButton}
              >
                <Dot severity={issue.severity} />
                <span className="min-w-0 flex-1">
                  <span className="block text-body font-semibold break-words">{issue.title}</span>
                  <span className="block text-body-sm break-words text-secondary">
                    Status message: {issue.message}
                  </span>
                </span>
              </button>
            </li>
          ))}
          {notices.map((notice) => (
            <li
              key={notice.id}
              className="flex items-center gap-4 border-b border-subtle px-5 py-4 last:border-b-0"
            >
              <Dot severity={notice.severity} />
              <span className="min-w-0 flex-1">
                <span className="block text-body font-semibold break-words">{notice.title}</span>
                <span className="block text-body-sm break-words text-secondary">
                  Status message: {notice.message}
                </span>
              </span>
              {notice.billId && (
                <Link href={`/bills/${notice.billId}`} className={smallButton}>
                  See more
                </Link>
              )}
              <button
                type="button"
                onClick={() => dismissNotice(notice.id)}
                className={smallButton}
              >
                Dismiss
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Dot({ severity }: { severity: 'warning' | 'error' }) {
  return (
    <span
      aria-hidden="true"
      className={`size-2.5 shrink-0 rounded-full ${severity === 'error' ? 'bg-danger-bright' : 'bg-warning-bright'}`}
    />
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
