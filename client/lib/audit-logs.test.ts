import assert from 'node:assert/strict';
import { test } from 'node:test';
import { encodeCursor, isTimestamp, parseAuditQuery } from './audit-logs.ts';

const query = (search: string) => parseAuditQuery(new URLSearchParams(search));

test('accepts ISO timestamps with an offset, as the screen and PostgREST write them', () => {
  assert.ok(isTimestamp('2026-11-18T05:00:00.000Z'));
  assert.ok(isTimestamp('2026-11-18T17:23:50.185805+00:00'));
  assert.ok(isTimestamp('2026-11-18T00:00:00-05:00'));
});

test('rejects dates that are not real timestamps', () => {
  for (const value of [
    'yesterday',
    '2026-11-18',
    '2026-11-18T00:00:00',
    '2026-02-30T00:00:00Z',
    '2026-13-01T00:00:00Z',
    '2026-11-18T24:00:00Z',
    '2026-11-18T23:60:00Z',
    '',
    42,
  ]) {
    assert.equal(isTimestamp(value), false, String(value));
  }
});

test('rejects offsets Postgres refuses (beyond ±15:59), which would otherwise be a 500', () => {
  assert.ok(isTimestamp('2026-11-18T00:00:00+14:00'));
  assert.ok(isTimestamp('2026-11-18T00:00:00-15:59'));
  assert.equal(isTimestamp('2026-11-18T00:00:00+16:00'), false);
  assert.equal(isTimestamp('2026-11-18T00:00:00+24:00'), false);
  assert.equal(isTimestamp('2026-11-18T00:00:00+05:75'), false);
});

test('no parameters reads the whole log', () => {
  assert.deepEqual(query(''), { from: null, to: null, after: null });
});

test('from and to are each optional', () => {
  assert.deepEqual(query('from=2026-11-01T05:00:00.000Z'), {
    from: '2026-11-01T05:00:00.000Z',
    to: null,
    after: null,
  });
  assert.deepEqual(query('to=2026-11-02T05:00:00.000Z'), {
    from: null,
    to: '2026-11-02T05:00:00.000Z',
    after: null,
  });
});

test('an invalid date or from later than to is refused', () => {
  assert.equal(query('from=nope'), null);
  assert.equal(query('to=2026-02-30T00:00:00Z'), null);
  assert.equal(query('from=2026-11-03T00:00:00Z&to=2026-11-02T00:00:00Z'), null);
});

test('from equal to to is an empty range, not an error', () => {
  assert.ok(query('from=2026-11-02T00:00:00Z&to=2026-11-02T00:00:00Z'));
});

test('the cursor keeps the range it was made with and ignores new from/to', () => {
  const first = query('from=2026-11-01T05:00:00.000Z&to=2026-11-08T05:00:00.000Z')!;
  const cursor = encodeCursor(first, {
    created_at: '2026-11-07T12:00:00.123456+00:00',
    audit_log_id: 40,
  });
  assert.deepEqual(query(`cursor=${cursor}&from=2020-01-01T00:00:00Z`), {
    from: '2026-11-01T05:00:00.000Z',
    to: '2026-11-08T05:00:00.000Z',
    after: { at: '2026-11-07T12:00:00.123456+00:00', id: 40 },
  });
});

test('a damaged or forged cursor is refused', () => {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  assert.equal(query('cursor=not-base64-json'), null);
  assert.equal(query(`cursor=${encode({ at: '2026-11-07T12:00:00Z', id: '1)' })}`), null);
  assert.equal(query(`cursor=${encode({ at: 'x",or(true)', id: 1 })}`), null);
  assert.equal(
    query(`cursor=${encode({ from: 'x', to: null, at: '2026-11-07T12:00:00Z', id: 1 })}`),
    null,
  );
});
