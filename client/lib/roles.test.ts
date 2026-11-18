import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ROLES,
  ROLE_LABELS,
  canDecideBills,
  canManageUsers,
  canSubmitBills,
  roleLabel,
} from './roles.ts';

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

test('canSubmitBills is true for billing_operator, financial_approver and system_admin', () => {
  for (const role of ['billing_operator', 'financial_approver', 'system_admin']) {
    assert.equal(canSubmitBills(role), true, `expected true for ${role}`);
  }
});

test('canSubmitBills is false for every other value', () => {
  for (const role of ['viewer', 'system_administrator', 'admin', '', null, undefined]) {
    assert.equal(canSubmitBills(role), false, `expected false for ${String(role)}`);
  }
});

test('canDecideBills is true for financial_approver and system_admin', () => {
  for (const role of ['financial_approver', 'system_admin']) {
    assert.equal(canDecideBills(role), true, `expected true for ${role}`);
  }
});

test('canDecideBills is false for every other value', () => {
  for (const role of ['billing_operator', 'viewer', 'system_administrator', 'admin', '', null, undefined]) {
    assert.equal(canDecideBills(role), false, `expected false for ${String(role)}`);
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
  assert.equal(roleLabel('viewer'), 'Viewer');
});

test('roleLabel shows an unknown role as it is stored', () => {
  assert.equal(roleLabel('auditor'), 'auditor');
  assert.equal(roleLabel(''), '');
});

test('roleLabel shows a dash for no role', () => {
  assert.equal(roleLabel(null), '—');
});
