import type { ReactNode } from 'react';

type Tone = 'success' | 'warning' | 'danger';

// Dot colors
const dotTone: Record<Tone, string> = {
  success: 'bg-success-bright',
  warning: 'bg-warning-bright',
  danger: 'bg-danger-bright',
};

// "● label" row in counts + card footer
export function StatusLabel({ tone, label }: { tone: Tone; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-body-sm text-secondary">
      <span aria-hidden="true" className={`size-2 rounded-full ${dotTone[tone]}`} />
      {label}
    </span>
  );
}

// Shared card shell for overview components
export function InfoCard({
  title = '-',
  children,
  className = '',
}: {
  title?: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-card border border-subtle bg-surface p-6 ${className}`}>
      <h3 className="mb-3 text-body-lg text-secondary">{title}</h3>
      {children}
    </section>
  );
}
