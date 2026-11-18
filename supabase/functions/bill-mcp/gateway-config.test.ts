import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const config = readFileSync(new URL('../../config.toml', import.meta.url), 'utf8');

function section(name: string) {
  const match = config.match(new RegExp(`^\\[${name}\\]\\n([^\\[]*)`, 'm'));
  return match?.[1] ?? '';
}

test('bill-mcp does not require a user JWT at the gateway', () => {
  assert.match(section('functions.bill-mcp'), /verify_jwt\s*=\s*false/);
});

test('agent-bills keeps the default gateway JWT check', () => {
  assert.equal(section('functions.agent-bills').includes('verify_jwt'), false);
});
