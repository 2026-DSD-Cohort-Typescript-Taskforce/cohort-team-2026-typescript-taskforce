// The query for GET /api/audit-logs (DC-104): an optional from/to range and a cursor for
// the next page. No imports, so `npm test` (node --test) can load it on its own.

export const PAGE_SIZE = 100;

export const INVALID_RANGE = {
  status: 400,
  body: { error: 'Pick a valid date range.', code: 'invalid_range' },
};

export const AUDIT_FORBIDDEN = {
  status: 403,
  body: {
    error: 'Only financial approvers and system admins can view the audit history.',
    code: 'forbidden',
  },
};

/** Where the next page starts: the last row's created_at and audit_log_id. */
export type Position = { at: string; id: number };

/** The range and position a page is read with. from is inclusive, to exclusive. */
export type AuditQuery = { from: string | null; to: string | null; after: Position | null };

// An ISO 8601 timestamp with an offset, as toISOString() and PostgREST write them.
const ISO =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(?:Z|[+-](\d{2}):(\d{2}))$/;

/**
 * A real calendar timestamp Postgres accepts. Date.parse alone accepts 2026-02-30, 24:00
 * and offsets past Postgres's ±15:59, which would fail the query with a 500.
 */
export function isTimestamp(value: unknown): value is string {
  const match = typeof value === 'string' ? ISO.exec(value) : null;
  if (!match) return false;
  // Z leaves the offset groups empty: Number(undefined ?? 0) is 0.
  const [, year, month, day, hour, minute, second, offsetHours, offsetMinutes] = match.map((part) =>
    Number(part ?? 0),
  );
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day &&
    hour < 24 &&
    minute < 60 &&
    second < 60 &&
    offsetHours < 16 &&
    offsetMinutes < 60
  );
}

/**
 * The query from ?from=&to= or, for a later page, ?cursor=. The cursor carries the range
 * it was made with, so later pages stay inside it. null when anything is invalid.
 */
export function parseAuditQuery(params: URLSearchParams): AuditQuery | null {
  const cursor = params.get('cursor');
  if (cursor !== null) return decodeCursor(cursor);
  return checkRange(params.get('from'), params.get('to'), null);
}

/** The cursor for the page after `last`, keeping the query's range. */
export function encodeCursor(
  query: AuditQuery,
  last: { created_at: string; audit_log_id: number },
) {
  const value = { from: query.from, to: query.to, at: last.created_at, id: last.audit_log_id };
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function decodeCursor(cursor: string): AuditQuery | null {
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString());
    if (!isTimestamp(value?.at) || !Number.isInteger(value.id)) return null;
    return checkRange(value.from, value.to, { at: value.at, id: value.id });
  } catch {
    return null;
  }
}

function checkRange(from: unknown, to: unknown, after: Position | null): AuditQuery | null {
  if (from != null && !isTimestamp(from)) return null;
  if (to != null && !isTimestamp(to)) return null;
  if (from && to && Date.parse(from) > Date.parse(to)) return null;
  return { from: (from as string | null) ?? null, to: (to as string | null) ?? null, after };
}
