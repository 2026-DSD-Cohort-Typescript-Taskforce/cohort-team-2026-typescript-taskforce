'use client';

import { useState } from 'react';
import { colorTransition, focusRing } from '@/app/ui';

export type Column<T> = {
  key: keyof T & string;
  label: string;
  render?: (row: T) => React.ReactNode;
};

// Pass `title` to replace the sortable column headers with a title bar.
export function DataTable<T extends Record<string, unknown>>({
  columns,
  rows,
  title,
}: {
  columns: Column<T>[];
  rows: T[];
  title?: string;
}) {
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(null);

  const sorted = sort
    ? [...rows].sort((a, b) => {
        const x = a[sort.key];
        const y = b[sort.key];
        const cmp =
          typeof x === 'number' && typeof y === 'number'
            ? x - y
            : String(x ?? '').localeCompare(String(y ?? ''), undefined, { numeric: true });
        return sort.dir === 'asc' ? cmp : -cmp;
      })
    : rows;

  // Click cycles asc -> desc -> unsorted.
  function toggle(key: string) {
    setSort((s) =>
      s?.key !== key ? { key, dir: 'asc' } : s.dir === 'asc' ? { key, dir: 'desc' } : null,
    );
  }

  return (
    <div className="overflow-hidden rounded-card border border-subtle bg-surface">
      <table className="w-full border-collapse text-left text-body">
        {title ? (
          <caption className="border-b border-subtle bg-raised px-6 py-4 text-left font-semibold text-foreground">
            {title}
          </caption>
        ) : (
          <thead className="border-b border-subtle bg-raised">
            <tr>
              {columns.map((c) => {
                const active = sort?.key === c.key;
                return (
                  <th
                    key={c.key}
                    scope="col"
                    aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                    className="p-0 font-semibold"
                  >
                    <button
                      type="button"
                      onClick={() => toggle(c.key)}
                      className={`flex w-full items-center gap-2 px-6 py-4 text-left hover:text-primary ${active ? 'text-primary' : 'text-foreground'} ${colorTransition} ${focusRing}`}
                    >
                      {c.label}
                      <span aria-hidden="true">
                        {active ? (sort.dir === 'asc' ? '▲' : '▼') : '↕'}
                      </span>
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
        )}
        <tbody>
          {sorted.map((row, i) => (
            <tr key={i} className="border-t border-subtle first:border-t-0 hover:bg-primary-hover">
              {columns.map((c) => (
                <td key={c.key} className="px-6 py-4 text-foreground">
                  {c.render ? c.render(row) : String(row[c.key] ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
