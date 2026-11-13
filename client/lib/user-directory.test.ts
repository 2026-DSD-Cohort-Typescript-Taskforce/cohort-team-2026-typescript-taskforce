import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  EMAIL_INVALID,
  EMAIL_REQUIRED,
  NAME_REQUIRED,
  ROLE_REQUIRED,
  toUserRow,
  validateNewUser,
  type NewUserInput,
  type UserRecord,
} from './user-directory.ts';

const record: UserRecord = {
  user_id: 7,
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  phone: '555-010-1234',
  role: 'system_admin',
  auth_user_id: '9f0c3c1e-0000-4000-8000-000000000000',
  properties: { name: 'Maple Court' },
};

const valid: NewUserInput = {
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  role: 'billing_operator',
  propertyIds: [],
};

test('toUserRow keeps the details and labels the role', () => {
  assert.deepEqual(toUserRow(record), {
    user_id: 7,
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    phone: '555-010-1234',
    role: 'system_admin',
    roleLabel: 'System Administrator',
    properties: 'Maple Court',
    pending: false,
  });
});

test('toUserRow marks a user with no login as pending', () => {
  assert.equal(toUserRow({ ...record, auth_user_id: null }).pending, true);
});

test('toUserRow joins a list of properties', () => {
  const row = toUserRow({ ...record, properties: [{ name: 'Maple Court' }, { name: 'Oak Row' }] });
  assert.equal(row.properties, 'Maple Court, Oak Row');
});

test('toUserRow shows a dash when there are no properties', () => {
  assert.equal(toUserRow({ ...record, properties: null }).properties, '—');
  assert.equal(toUserRow({ ...record, properties: [] }).properties, '—');
  assert.equal(toUserRow({ ...record, properties: [{ name: null }] }).properties, '—');
});

test('toUserRow shows an unknown role as stored, and no role as a dash', () => {
  assert.equal(toUserRow({ ...record, role: 'auditor' }).roleLabel, 'auditor');
  assert.equal(toUserRow({ ...record, role: null }).roleLabel, '—');
});

test('toUserRow turns a missing name into an empty string', () => {
  assert.equal(toUserRow({ ...record, name: null }).name, '');
});

test('validateNewUser accepts valid details without phone or properties', () => {
  assert.deepEqual(validateNewUser(valid), {});
});

test('validateNewUser accepts a phone and properties', () => {
  assert.deepEqual(validateNewUser({ ...valid, phone: '555-010-1234', propertyIds: [1, 2] }), {});
});

test('validateNewUser requires a name', () => {
  assert.deepEqual(validateNewUser({ ...valid, name: '   ' }), { name: NAME_REQUIRED });
});

test('validateNewUser requires an email', () => {
  assert.deepEqual(validateNewUser({ ...valid, email: '' }), { email: EMAIL_REQUIRED });
});

test('validateNewUser rejects a malformed email', () => {
  for (const email of ['ada', 'ada@', 'ada@example', 'ada @example.com', '@example.com']) {
    assert.deepEqual(validateNewUser({ ...valid, email }), { email: EMAIL_INVALID }, email);
  }
});

test('validateNewUser requires a known role', () => {
  for (const role of ['', 'admin', 'system_administrator']) {
    assert.deepEqual(validateNewUser({ ...valid, role }), { role: ROLE_REQUIRED }, role);
  }
});

test('validateNewUser reports every failing field at once', () => {
  assert.deepEqual(validateNewUser({ name: '', email: '', role: '', propertyIds: [] }), {
    name: NAME_REQUIRED,
    email: EMAIL_REQUIRED,
    role: ROLE_REQUIRED,
  });
});
