// One plain line per rule of a policy draft, for the dialog's review step (DC-91).
// Only imports with a .ts extension, so `npm test` (node --test) can load it.

import type { AmountCondition, Effect, PolicyRuleV1, PropertyRef } from './policy-rule.ts';

const EFFECT_WORDS: Record<Effect, string> = {
  allow: 'Allow',
  require_approval: 'Need approval',
  block: 'Block',
};

/** Always two decimals ("$500.00"), unlike formatCents, so a line reads as money. */
function money(cents: number): string {
  const dollars = Math.floor(cents / 100).toLocaleString('en-US');
  return `$${dollars}.${String(cents % 100).padStart(2, '0')}`;
}

function amountWords(amount: AmountCondition | undefined): string {
  if (!amount) return 'any amount';
  // Both bounds inclusive reads as a range.
  if (amount.gte !== undefined && amount.lte !== undefined) {
    return `${money(amount.gte)} to ${money(amount.lte)}`;
  }
  const lower =
    amount.gt !== undefined
      ? `over ${money(amount.gt)}`
      : amount.gte !== undefined
        ? `${money(amount.gte)} or more`
        : null;
  const upper =
    amount.lt !== undefined
      ? `under ${money(amount.lt)}`
      : amount.lte !== undefined
        ? `${money(amount.lte)} or less`
        : null;
  if (lower && upper) return `${lower} and ${upper}`;
  return lower ?? upper ?? 'any amount';
}

export function ruleLines(rule: PolicyRuleV1, properties: PropertyRef[]): string[] {
  const name = (id: number) =>
    properties.find((p) => p.property_id === id)?.name ?? `property ${id}`;
  return rule.rules.map(({ effect, when }) => {
    const propertyWords = when.property_ids
      ? when.property_ids.map(name).join(', ')
      : when.except_property_ids
        ? `every property except ${when.except_property_ids.map(name).join(', ')}`
        : 'every property';
    const paymentWords = when.payment_types
      ? `${when.payment_types.join(' or ')} only`
      : 'any payment method';
    return [EFFECT_WORDS[effect], amountWords(when.amount_cents), propertyWords, paymentWords].join(
      ' · ',
    );
  });
}
