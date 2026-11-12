import assert from "node:assert/strict";
import { test } from "node:test";
import { LOGO_SWAP_ATTEMPTS, PAGE_SIZE, readAllRows, replaceLogoPath, type LogoStore } from "./vendor-queries.ts";

/** A table of `total` rows that answers at most `cap` per request, like PostgREST's max_rows. */
function pagedTable(total: number, cap: number) {
  const rows = Array.from({ length: total }, (_, i) => i + 1);
  const ranges: [number, number][] = [];
  const readPage = async (from: number, to: number) => {
    ranges.push([from, to]);
    return { data: rows.slice(from, Math.min(to + 1, from + cap)), error: null, count: rows.length };
  };
  return { rows, ranges, readPage };
}

test("readAllRows pages in PAGE_SIZE ranges of 1,000", () => {
  assert.equal(PAGE_SIZE, 1000);
});

test("readAllRows reads a short table in one request", async () => {
  const table = pagedTable(11, 1000);
  assert.deepEqual(await readAllRows(table.readPage), { data: table.rows, error: null });
  assert.deepEqual(table.ranges, [[0, 999]]);
});

test("readAllRows reads past the 1,000-row cap, in order and without repeats", async () => {
  const table = pagedTable(2500, 1000);
  assert.deepEqual(await readAllRows(table.readPage), { data: table.rows, error: null });
  assert.deepEqual(table.ranges, [[0, 999], [1000, 1999], [2000, 2999]]);
});

test("readAllRows stops after a table of exactly one full page", async () => {
  const table = pagedTable(1000, 1000);
  assert.equal((await readAllRows(table.readPage)).data?.length, 1000);
  assert.deepEqual(table.ranges, [[0, 999]]);
});

test("readAllRows still reads every row when the server caps pages below PAGE_SIZE", async () => {
  const table = pagedTable(700, 300);
  assert.deepEqual(await readAllRows(table.readPage), { data: table.rows, error: null });
  assert.deepEqual(table.ranges, [[0, 999], [300, 1299], [600, 1599]]);
});

test("readAllRows reads an empty table in one request", async () => {
  const table = pagedTable(0, 1000);
  assert.deepEqual(await readAllRows(table.readPage), { data: [], error: null });
  assert.equal(table.ranges.length, 1);
});

test("readAllRows returns the error of a failed page and no rows", async () => {
  const failure = { code: "57014", message: "canceling statement due to statement timeout" };
  let calls = 0;
  const result = await readAllRows(async () =>
    ++calls === 1 ? { data: [1, 2], error: null, count: 4 } : { data: null, error: failure, count: null },
  );
  assert.deepEqual(result, { data: null, error: failure });
});

test("readAllRows stops when rows run out before the count (deleted meanwhile)", async () => {
  let calls = 0;
  const result = await readAllRows(async () => (++calls === 1 ? { data: [1], error: null, count: 5 } : { data: [], error: null, count: 1 }), 1);
  assert.deepEqual(result, { data: [1], error: null });
  assert.equal(calls, 2);
});

type Row = { vendor_id: number; logo_path: string | null };

/** One vendor row whose logo_path another request can change between our read and our update. */
function vendorRow(logoPath: string | null, opts: { otherWrites?: (string | null)[]; deleted?: boolean } = {}) {
  let row: Row | null = opts.deleted ? null : { vendor_id: 7, logo_path: logoPath };
  const otherWrites = [...(opts.otherWrites ?? [])];
  const calls: string[] = [];
  const store: LogoStore<Row, { message: string }> = {
    async read() {
      calls.push("read");
      return { data: row && { logo_path: row.logo_path }, error: null };
    },
    async swap(expected, next) {
      calls.push(`swap ${expected} → ${next}`);
      // Another request's update lands just before ours.
      if (row && otherWrites.length) row = { ...row, logo_path: otherWrites.shift()! };
      if (!row || row.logo_path !== expected) return { data: null, error: null };
      row = { ...row, logo_path: next };
      return { data: row, error: null };
    },
  };
  return { store, calls, row: () => row };
}

test("replaceLogoPath sets the new path and names the file it replaced", async () => {
  const v = vendorRow("7/old.png");
  assert.deepEqual(await replaceLogoPath(v.store, "7/new.png", "7/old.png"), {
    kind: "saved",
    row: { vendor_id: 7, logo_path: "7/new.png" },
    previous: "7/old.png",
  });
  assert.deepEqual(v.calls, ["swap 7/old.png → 7/new.png"]);
});

test("replaceLogoPath clears a logo (next null)", async () => {
  const v = vendorRow("7/old.png");
  const result = await replaceLogoPath(v.store, null, "7/old.png");
  assert.deepEqual(result, { kind: "saved", row: { vendor_id: 7, logo_path: null }, previous: "7/old.png" });
});

test("replaceLogoPath: when another request changed the logo first, it replaces that one instead", async () => {
  const v = vendorRow("7/old.png", { otherWrites: ["7/theirs.png"] });
  const result = await replaceLogoPath(v.store, "7/mine.png", "7/old.png");
  assert.deepEqual(result, { kind: "saved", row: { vendor_id: 7, logo_path: "7/mine.png" }, previous: "7/theirs.png" });
  assert.deepEqual(v.calls, ["swap 7/old.png → 7/mine.png", "read", "swap 7/theirs.png → 7/mine.png"]);
});

test("replaceLogoPath: another request's removal in between is retried against null", async () => {
  const v = vendorRow("7/old.png", { otherWrites: [null] });
  const result = await replaceLogoPath(v.store, "7/mine.png", "7/old.png");
  assert.deepEqual(result, { kind: "saved", row: { vendor_id: 7, logo_path: "7/mine.png" }, previous: null });
});

test("replaceLogoPath reports a vendor that is gone", async () => {
  const v = vendorRow(null, { deleted: true });
  assert.deepEqual(await replaceLogoPath(v.store, "7/mine.png", null), { kind: "missing" });
  assert.deepEqual(v.calls, ["swap null → 7/mine.png", "read"]);
});

test(`replaceLogoPath gives up as busy after ${LOGO_SWAP_ATTEMPTS} lost updates and changes nothing more`, async () => {
  assert.equal(LOGO_SWAP_ATTEMPTS, 3);
  const v = vendorRow("7/a.png", { otherWrites: ["7/b.png", "7/c.png", "7/d.png"] });
  assert.deepEqual(await replaceLogoPath(v.store, "7/mine.png", "7/a.png"), { kind: "busy" });
  assert.equal(v.calls.filter((c) => c.startsWith("swap")).length, LOGO_SWAP_ATTEMPTS);
  assert.equal(v.row()?.logo_path, "7/d.png");
});

test("replaceLogoPath returns a failed update's error", async () => {
  const failure = { message: "permission denied" };
  const store: LogoStore<Row, typeof failure> = {
    read: async () => ({ data: { logo_path: null }, error: null }),
    swap: async () => ({ data: null, error: failure }),
  };
  assert.deepEqual(await replaceLogoPath(store, "7/mine.png", null), { kind: "error", error: failure });
});

test("replaceLogoPath returns a failed re-read's error", async () => {
  const failure = { message: "timeout" };
  const store: LogoStore<Row, typeof failure> = {
    read: async () => ({ data: null, error: failure }),
    swap: async () => ({ data: null, error: null }),
  };
  assert.deepEqual(await replaceLogoPath(store, "7/mine.png", null), { kind: "error", error: failure });
});
