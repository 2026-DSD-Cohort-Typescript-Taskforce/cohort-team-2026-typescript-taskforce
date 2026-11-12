import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parsePropertyId, validateProperty } from './property-validation.ts';

test('a complete form is trimmed, and blank optional fields become null', () => {
  assert.deepEqual(
    validateProperty({ name: '  Maple Junction ', address: ' 1 Main St ', phone: '', email: '  ' }),
    {
      input: { name: 'Maple Junction', address: '1 Main St', phone: null, email: null },
    },
  );
});

test('a create needs a name', () => {
  for (const name of [undefined, null, '', '   ']) {
    assert.deepEqual(validateProperty({ name }).errors, { name: "Enter the property's name." });
  }
});

test('an email must look like one, and every field must be text of a sane length', () => {
  const result = validateProperty({
    name: 5,
    address: 'x'.repeat(256),
    phone: '555-0100',
    email: 'not-an-email',
  });
  assert.deepEqual(Object.keys(result.errors ?? {}).sort(), ['address', 'email', 'name']);
  assert.deepEqual(
    validateProperty({ name: 'A', email: 'ops@maple.example' }).input?.email,
    'ops@maple.example',
  );
});

test('a partial edit checks only the fields it sends', () => {
  assert.deepEqual(validateProperty({ phone: ' 555-0100 ' }, { partial: true }), {
    input: { phone: '555-0100' },
  });
  assert.deepEqual(validateProperty({ name: '' }, { partial: true }).errors, {
    name: "Enter the property's name.",
  });
  assert.deepEqual(validateProperty({}, { partial: true }), { input: {} });
});

test('only a positive Postgres integer is a property id', () => {
  assert.equal(parsePropertyId('42'), 42);
  for (const id of ['0', '-1', '1.5', 'abc', '042', '2147483648'])
    assert.equal(parsePropertyId(id), null);
});
