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

export type Column<T> = {
  key: keyof T & string;
  label: string;
  render?: (row: T) => React.ReactNode;
};

// Pass `title` to replace the sortable column headers with a title bar.
export function TanstackDataTable<T extends object>({
  columns,
  rows,
  title,
}: {
  columns: Column<T>[];
  rows: T[];
  title?: string;
}) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [filters, setFilters] = useState<ColumnFiltersState>([]);
  const [open, setOpen] = useState(false);
  const filterId = useId();

  const defs = useMemo<ColumnDef<T>[]>(
    () =>
      columns.map((c) => ({
        id: c.key,
        accessorKey: c.key,
        header: c.label,
        cell: (ctx) => (c.render ? c.render(ctx.row.original) : String(ctx.getValue() ?? '')),
        sortingFn: (a, b, id) => {
          const x = a.getValue(id);
          const y = b.getValue(id);
          return typeof x === 'number' && typeof y === 'number'
            ? x - y
            : String(x ?? '').localeCompare(String(y ?? ''), undefined, { numeric: true });
        },
        sortDescFirst: false,
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
    </tr>
  );

  return (
    <div className="overflow-hidden rounded-card border border-subtle bg-surface">
      <div className="flex items-center justify-between border-b border-subtle bg-raised px-6 py-3 font-semibold text-foreground">
        <span>{title}</span>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={filterId}
          onClick={() => setOpen((o) => !o)}
          className={`flex items-center gap-2 rounded-button px-2 py-1 hover:text-primary ${open || filters.length ? 'text-primary' : 'text-foreground'} ${colorTransition} ${focusRing}`}
        >
          Filter <span aria-hidden="true">{open ? '▲' : '▼'}</span>
        </button>
      </div>
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
            </tr>
          ))}
        </tbody>
      </table>
      {table.getRowModel().rows.length === 0 && (
        <p className="px-6 py-4 text-secondary">No matching rows.</p>
      )}
    </div>
  );
}

export default TanstackDataTable;
