// The sort DataTable applies to a column: numbers numerically, anything else as text with
// digits compared as numbers ("Bill 9" before "Bill 10"; ISO dates come out chronological).
// Only a type import, so `npm test` (node --test) can load it on its own.

import type { SortingFn } from "@tanstack/react-table";

export function compareCells(x: unknown, y: unknown): number {
  return typeof x === "number" && typeof y === "number"
    ? x - y
    : String(x ?? "").localeCompare(String(y ?? ""), undefined, { numeric: true });
}

// The sort options DataTable gives each column. sortUndefined keeps empty cells last whichever
// way the column is sorted, but TanStack only treats undefined as empty, so null is read as
// undefined: a bill with no due date goes after the dated ones instead of first.
export function sortColumn<T>(key: keyof T & string) {
  return {
    accessorFn: (row: T) => row[key] ?? undefined,
    sortingFn: ((a, b, id) => compareCells(a.getValue(id), b.getValue(id))) as SortingFn<T>,
    sortUndefined: "last" as const,
    sortDescFirst: false,
  };
}
