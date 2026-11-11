'use client';

import { useId, useMemo, useState } from 'react';
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnFiltersState,
  type SortingState,
} from '@tanstack/react-table';
import { colorTransition, focusRing } from '@/app/ui';
import { sortColumn } from '@/lib/table-sort';

export type Column<T> = {
  key: keyof T & string;
  label: string;
  render?: (row: T) => React.ReactNode;
};

// A control at the end of each row, e.g. a button that opens the row. `label` names the
// column for screen readers.
export type RowAction<T> = { label: string; render: (row: T) => React.ReactNode };

// Pass `title` to replace the sortable column headers with a title bar. `filterable={false}`
// drops the Filter button, and the bar with it when there's no title.
export function DataTable<T extends object>({
  columns,
  rows,
  title,
  initialSorting = [],
  filterable = true,
  rowAction,
}: {
  columns: Column<T>[];
  rows: T[];
  title?: string;
  initialSorting?: SortingState;
  filterable?: boolean;
  rowAction?: RowAction<T>;
}) {
  const [sorting, setSorting] = useState<SortingState>(initialSorting);
  const [filters, setFilters] = useState<ColumnFiltersState>([]);
  const [open, setOpen] = useState(false);
  const filterId = useId();

  const defs = useMemo<ColumnDef<T>[]>(
    () =>
      columns.map((c) => ({
        id: c.key,
        ...sortColumn<T>(c.key),
        header: c.label,
        cell: (ctx) => (c.render ? c.render(ctx.row.original) : String(ctx.getValue() ?? '')),
        filterFn: 'includesString' as const, // the 'auto' default treats numbers as ranges
      })),
    [columns],
  );

  const table = useReactTable({
    data: rows,
    columns: defs,
    state: { sorting, columnFilters: filters },
    onSortingChange: setSorting,
    onColumnFiltersChange: setFilters,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    enableSortingRemoval: true, // asc -> desc -> none
  });

  const filterRow = open && (
    <tr id={filterId}>
      {table.getHeaderGroups()[0].headers.map((h) => (
        <th key={h.id} scope="col" className="px-6 py-4 font-normal">
          {rows.some((r) => r[h.column.id as keyof T] != null) && (
            <input
              type="search"
              aria-label={`Filter ${String(h.column.columnDef.header)}`}
              placeholder="Filter…"
              value={(h.column.getFilterValue() as string) ?? ''}
              onChange={(e) => h.column.setFilterValue(e.target.value || undefined)}
              className={`h-10 w-full rounded-input border border-strong bg-background px-3 text-body text-foreground placeholder:text-secondary focus-visible:border-primary ${colorTransition} ${focusRing}`}
            />
          )}
        </th>
      ))}
      {rowAction && <td />}
    </tr>
  );

  return (
    <div className="overflow-hidden border border-subtle bg-surface">
      {(title || filterable) && (
        <div className="flex items-center justify-between border-b border-subtle bg-raised px-6 py-3 font-semibold text-foreground">
          <span>{title}</span>
          {filterable && (
            <button
              type="button"
              aria-expanded={open}
              aria-controls={filterId}
              onClick={() => setOpen((o) => !o)}
              className={`flex items-center gap-2 rounded-button px-2 py-1 hover:text-primary ${open || filters.length ? 'text-primary' : 'text-foreground'} ${colorTransition} ${focusRing}`}
            >
              Filter <span aria-hidden="true">{open ? '▲' : '▼'}</span>
            </button>
          )}
        </div>
      )}
      {/* Wide tables scroll sideways inside the border instead of widening the page. relative:
          the clip also has to catch absolutely positioned content such as sr-only labels. */}
      <div className="relative overflow-x-auto">
        <table className="w-full border-collapse text-left text-body">
          {title ? (
            <caption className="sr-only">{title}</caption>
          ) : (
            <thead className="border-b border-subtle bg-raised">
              {table.getHeaderGroups().map((hg) => (
                <tr key={hg.id}>
                  {hg.headers.map((h) => {
                    const dir = h.column.getIsSorted();
                    return (
                      <th
                        key={h.id}
                        scope="col"
                        aria-sort={
                          dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : 'none'
                        }
                        className="p-0 font-semibold"
                      >
                        <button
                          type="button"
                          onClick={h.column.getToggleSortingHandler()}
                          className={`flex w-full items-center gap-2 px-6 py-4 text-left hover:text-primary ${dir ? 'text-primary' : 'text-foreground'} ${colorTransition} ${focusRing}`}
                        >
                          {flexRender(h.column.columnDef.header, h.getContext())}
                          <span aria-hidden="true">
                            {dir === 'asc' ? '▲' : dir === 'desc' ? '▼' : '↕'}
                          </span>
                        </button>
                      </th>
                    );
                  })}
                  {rowAction && (
                    <th scope="col" className="p-0">
                      <span className="sr-only">{rowAction.label}</span>
                    </th>
                  )}
                </tr>
              ))}
              {filterRow}
            </thead>
          )}
          {title && open && <thead className="border-b border-subtle bg-raised">{filterRow}</thead>}
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr key={row.id} className="border-t border-subtle first:border-t-0 hover:bg-raised">
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="px-6 py-4 text-foreground">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
                {rowAction && (
                  <td className="px-4 py-2 text-right">{rowAction.render(row.original)}</td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {table.getRowModel().rows.length === 0 && (
        <p className="px-6 py-4 text-secondary">No matching rows.</p>
      )}
    </div>
  );
}

export default DataTable;
