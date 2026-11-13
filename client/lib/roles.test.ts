import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ROLES, ROLE_LABELS, canManageUsers } from './roles.ts';

test('canManageUsers is true for system_administrator', () => {
  assert.equal(canManageUsers('system_administrator'), true);
});

test('canManageUsers is false for every other value', () => {
  for (const role of ['billing_operator', 'financial_approver', 'admin', '', null, undefined]) {
    assert.equal(canManageUsers(role), false, `expected false for ${String(role)}`);
  }
});

test('every role has a non-empty label', () => {
  for (const role of ROLES) {
    assert.ok(ROLE_LABELS[role]?.trim(), `missing label for ${role}`);
  }
});
