import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mailpitUrl } from './helpers/mailpit-url';

test('Mailpit defaults for missing, empty, or whitespace environment values', () => {
  for (const value of [undefined, '', '   ']) {
    assert.equal(mailpitUrl(value), 'http://127.0.0.1:54324');
  }
});

test('Mailpit preserves an explicitly configured URL', () => {
  assert.equal(mailpitUrl('http://localhost:54324'), 'http://localhost:54324');
});
