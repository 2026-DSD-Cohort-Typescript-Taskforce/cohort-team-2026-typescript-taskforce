// Query patterns the vendor routes share, kept free of Supabase so node --test can run them.

/** Rows asked for per request. PostgREST answers at most max_rows (1,000 by default) per request. */
export const PAGE_SIZE = 1000;

export type Page<T, E> = { data: T[] | null; error: E | null; count: number | null };

/**
 * Every row of a query, read in pages, because one request stops at max_rows. `readPage(from,
 * to)` is the query with `.range(from, to)` and `{ count: "exact" }`. Each page starts after
 * the rows read so far, so a server cap below PAGE_SIZE still reads them all.
 */
export async function readAllRows<T, E>(
  readPage: (from: number, to: number) => PromiseLike<Page<T, E>>,
  pageSize = PAGE_SIZE,
): Promise<{ data: T[]; error: null } | { data: null; error: E }> {
  const rows: T[] = [];
  for (;;) {
    const { data, error, count } = await readPage(rows.length, rows.length + pageSize - 1);
    if (error) return { data: null, error };
    if (!data?.length) return { data: rows, error: null };
    rows.push(...data);
    if (count === null || rows.length >= count) return { data: rows, error: null };
  }
}

/** Updates of logo_path tried before giving up while other requests keep changing it. */
export const LOGO_SWAP_ATTEMPTS = 3;

/** One vendor's logo_path, as the logo routes read and change it. */
export type LogoStore<R, E> = {
  /** The vendor's logo_path now; `data` is null once the vendor is gone. */
  read(): PromiseLike<{ data: { logo_path: string | null } | null; error: E | null }>;
  /** Sets logo_path to `next` only while it still equals `expected`; `data` is null if it didn't. */
  swap(expected: string | null, next: string | null): PromiseLike<{ data: R | null; error: E | null }>;
};

export type LogoSwap<R, E> =
  | { kind: "saved"; row: R; previous: string | null }
  | { kind: "missing" }
  | { kind: "error"; error: E }
  | { kind: "busy" };

/**
 * Points a vendor at a new logo file (or none) and says which file it replaced, so the caller
 * deletes exactly that one. The update applies only while logo_path still holds the value last
 * read. When another request changed it in between, this reads it again and retries, so two
 * logo changes at once can't both delete the same old file and leave a new one unused.
 */
export async function replaceLogoPath<R, E>(
  store: LogoStore<R, E>,
  next: string | null,
  expected: string | null,
): Promise<LogoSwap<R, E>> {
  let current = expected;
  for (let attempt = 1; attempt <= LOGO_SWAP_ATTEMPTS; attempt++) {
    const swapped = await store.swap(current, next);
    if (swapped.error) return { kind: "error", error: swapped.error };
    if (swapped.data) return { kind: "saved", row: swapped.data, previous: current };
    if (attempt === LOGO_SWAP_ATTEMPTS) break;
    const read = await store.read();
    if (read.error) return { kind: "error", error: read.error };
    if (!read.data) return { kind: "missing" };
    current = read.data.logo_path;
  }
  return { kind: "busy" };
}
