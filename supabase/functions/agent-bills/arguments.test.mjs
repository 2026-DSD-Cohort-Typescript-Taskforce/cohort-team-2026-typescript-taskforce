import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');

function sliceFunction(name) {
  const start = source.indexOf(`async function ${name}`);
  if (start < 0) throw new Error(`${name} is missing`);
  let cursor = source.indexOf('(', start);
  let depth = 0;
  let quote = '';
  for (; cursor < source.length; cursor += 1) {
    const ch = source[cursor];
    if (quote) {
      if (ch === '\\') cursor += 1;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) {
        cursor += 1;
        break;
      }
    }
  }
  while (source[cursor] === ' ' || source[cursor] === '\n') cursor += 1;
  let braces = 0;
  let began = false;
  for (; cursor < source.length; cursor += 1) {
    const ch = source[cursor];
    if (quote) {
      if (ch === '\\') cursor += 1;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '{') {
      braces += 1;
      began = true;
    } else if (ch === '}') {
      braces -= 1;
      if (began && braces === 0) return source.slice(start, cursor + 1);
    }
  }
  throw new Error(`${name} body is incomplete`);
}

function callMcpFromSource(fetch) {
  const fn = sliceFunction('callMcp').replace(
    /^async function callMcp\([\s\S]*?\)\s*\{/,
    'async function callMcp(mcpUrl, mcpToken, userAuth, call) {',
  );
  return new Function('fetch', 'logError', `${fn}\nreturn callMcp;`)(fetch, () => {});
}

function toolCall(argumentsText) {
  return { id: 'call-1', function: { name: 'get_bill', arguments: argumentsText } };
}

test('malformed model arguments do not crash the tool call', async () => {
  const calls = [];
  const callMcp = callMcpFromSource(async (_url, init) => {
    calls.push(init);
    return { ok: true, text: async () => '{"ok":true}' };
  });
  let text;
  try {
    text = await callMcp('http://bill-mcp', 'token', 'Bearer user', toolCall('{'));
  } catch (error) {
    assert.fail(`callMcp threw ${error.name}: ${error.message}`);
  }
  assert.equal(calls.length, 0);
  assert.deepEqual(JSON.parse(text), { error: 'invalid tool arguments' });
});

test('valid JSON arguments are still sent to bill-mcp', async () => {
  const calls = [];
  const callMcp = callMcpFromSource(async (_url, init) => {
    calls.push(init);
    return { ok: true, text: async () => '{"ok":true}' };
  });
  const text = await callMcp('http://bill-mcp', 'token', 'Bearer user', toolCall('{"bill_id":12}'));
  assert.equal(text, '{"ok":true}');
  assert.equal(calls.length, 1);
  assert.deepEqual(JSON.parse(String(calls[0].body)), {
    method: 'tools/call',
    params: { name: 'get_bill', arguments: { bill_id: 12 } },
  });
});
