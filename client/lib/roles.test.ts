import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ROLES, ROLE_LABELS, canManageUsers, roleLabel } from './roles.ts';

test('canManageUsers is true for system_admin', () => {
  assert.equal(canManageUsers('system_admin'), true);
});

test('canManageUsers is false for every other value', () => {
  for (const role of [
    'billing_operator',
    'financial_approver',
    'system_administrator',
    'admin',
    '',
    null,
    undefined,
  ]) {
    assert.equal(canManageUsers(role), false, `expected false for ${String(role)}`);
  }
});

test('every role has a non-empty label', () => {
  for (const role of ROLES) {
    assert.ok(ROLE_LABELS[role]?.trim(), `missing label for ${role}`);
  }
});

test('roleLabel shows the label for a known role', () => {
  assert.equal(roleLabel('system_admin'), 'System Administrator');
  assert.equal(roleLabel('billing_operator'), 'Billing Operator');
});

test('roleLabel shows an unknown role as it is stored', () => {
  assert.equal(roleLabel('auditor'), 'auditor');
  assert.equal(roleLabel(''), '');
});

test('roleLabel shows a dash for no role', () => {
  assert.equal(roleLabel(null), '—');
});
