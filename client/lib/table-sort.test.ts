import assert from "node:assert/strict";
import { test } from "node:test";
import { APPROVALS_DEFAULT_SORT } from "./approvals.ts";
import { compareCells } from "./table-sort.ts";

test("numbers compare as numbers", () => {
  assert.ok(compareCells(9, 10) < 0);
  assert.ok(compareCells(100.5, 20) > 0);
  assert.equal(compareCells(3, 3), 0);
});

test("ISO dates compare chronologically", () => {
  assert.ok(compareCells("2026-11-09", "2026-11-10") < 0);
  assert.ok(compareCells("2026-12-01", "2026-11-30") > 0);
});

test("text with numbers compares naturally; missing values read as empty", () => {
  assert.ok(compareCells("Bill 9", "Bill 10") < 0);
  assert.ok(compareCells(null, "a") < 0);
  assert.equal(compareCells(undefined, null), 0);
});

test("rows sort by due date ascending with the default sort", () => {
  const { id } = APPROVALS_DEFAULT_SORT[0];
  const rows = [
    { date_due: "2026-12-01" },
    { date_due: "2026-11-05" },
    { date_due: "2026-11-20" },
  ] as Record<string, unknown>[];
  rows.sort((a, b) => compareCells(a[id], b[id]));
  assert.deepEqual(
    rows.map((r) => r.date_due),
    ["2026-11-05", "2026-11-20", "2026-12-01"],
  );
});
