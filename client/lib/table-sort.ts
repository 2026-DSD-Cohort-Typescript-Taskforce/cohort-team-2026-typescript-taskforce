// The sort DataTable applies to a column: numbers numerically, anything else as text with
// digits compared as numbers ("Bill 9" before "Bill 10"; ISO dates come out chronological).
// No imports, so `npm test` (node --test) can load it on its own.

export function compareCells(x: unknown, y: unknown): number {
  return typeof x === "number" && typeof y === "number"
    ? x - y
    : String(x ?? "").localeCompare(String(y ?? ""), undefined, { numeric: true });
}
