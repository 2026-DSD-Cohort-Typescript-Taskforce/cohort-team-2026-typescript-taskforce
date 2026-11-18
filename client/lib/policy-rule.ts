// DC-90 policy rule v1: the structured rule a vendor's policy sentence is turned into.
// This is the contract DC-91 (confirmation) and DC-92 (enforcement) build on; see
// docs/adr/0003-policy-rule-schema.md. Pure TypeScript: no I/O, so `node --test` loads it.
import { z } from 'zod';

export const EFFECTS = ['allow', 'require_approval', 'block'] as const;
export const PAYMENT_TYPES = ['card', 'bank'] as const;
export const QUESTION_TOPICS = ['amount', 'property', 'payment_type', 'effect', 'scope'] as const;
export const DRAFT_STATUSES = [
  'complete',
  'needs_clarification',
  'unsupported',
  'conflicting',
] as const;

export type Effect = (typeof EFFECTS)[number];
export type PaymentType = (typeof PAYMENT_TYPES)[number];
export type QuestionTopic = (typeof QUESTION_TOPICS)[number];
export type DraftStatus = (typeof DRAFT_STATUSES)[number];

export type AmountCondition = { gt?: number; gte?: number; lt?: number; lte?: number };
export type RuleConditions = {
  amount_cents?: AmountCondition;
  property_ids?: number[];
  except_property_ids?: number[];
  payment_types?: PaymentType[];
};
export type PolicyRuleEntry = { effect: Effect; when: RuleConditions };
export type PolicyRuleV1 = { schema_version: 1; vendor_id: number; rules: PolicyRuleEntry[] };
export type DraftQuestion = { id: string; topic: QuestionTopic; question: string };
export type UnsupportedPart = { text: string; reason: string };
export type RuleConflict = { rules: [number, number]; explanation: string };
export type PropertyRef = { property_id: number; name: string };

export const GENERIC_NOT_COVERED =
  "Bills that match none of these rules aren't covered; they follow the normal flow.";
export const NO_RULE_QUESTION = 'What should this policy do?';
export const UNKNOWN_PROPERTY_QUESTION =
  "Which properties does this policy apply to? One of the properties named isn't in the list.";

const MAX_RULES = 10;
const MAX_IDS = 50;
const MAX_QUESTIONS = 5;
const MAX_TEXT = 2000;
const MAX_NOT_COVERED = 1000;

const cents = z.number().int().min(0);
const id = z.number().int().min(0);
const distinct = (values: readonly unknown[]) => new Set(values).size === values.length;
const idList = z
  .array(id)
  .min(1)
  .max(MAX_IDS)
  .refine(distinct, { message: 'ids must be distinct' });

const amountSchema = z
  .strictObject({
    gt: cents.optional(),
    gte: cents.optional(),
    lt: cents.optional(),
    lte: cents.optional(),
  })
  .refine((a) => Object.values(a).some((v) => v !== undefined), { message: 'needs a bound' })
  .refine((a) => a.gt === undefined || a.gte === undefined, { message: 'one lower bound' })
  .refine((a) => a.lt === undefined || a.lte === undefined, { message: 'one upper bound' });

const conditionsSchema = z
  .strictObject({
    amount_cents: amountSchema.optional(),
    property_ids: idList.optional(),
    except_property_ids: idList.optional(),
    payment_types: z
      .array(z.enum(PAYMENT_TYPES))
      .min(1)
      .max(PAYMENT_TYPES.length)
      .refine(distinct, { message: 'payment types must be distinct' })
      .optional(),
  })
  .refine((w) => w.property_ids === undefined || w.except_property_ids === undefined, {
    message: 'property_ids and except_property_ids cannot be combined',
  });

export const policyRuleV1Schema = z.strictObject({
  schema_version: z.literal(1),
  vendor_id: id,
  rules: z
    .array(z.strictObject({ effect: z.enum(EFFECTS), when: conditionsSchema }))
    .min(1)
    .max(MAX_RULES),
});

export function isPolicyRuleV1(value: unknown): value is PolicyRuleV1 {
  return policyRuleV1Schema.safeParse(value).success;
}

// What the model returns: every key present, optional values nullable (strict JSON schema).
export type ModelOutput = {
  interpretation: string;
  revised_sentence: string;
  not_covered: string | null;
  rules: Array<{
    effect: Effect;
    amount: { gt: number | null; gte: number | null; lt: number | null; lte: number | null } | null;
    property_ids: number[] | null;
    except_property_ids: number[] | null;
    payment_types: PaymentType[] | null;
  }>;
  questions: Array<{ topic: QuestionTopic; question: string }>;
  unsupported: Array<{ text: string; reason: string }>;
};

const nullableCents = cents.nullable();

export const modelOutputSchema = z.strictObject({
  interpretation: z.string(),
  revised_sentence: z.string(),
  not_covered: z.string().nullable(),
  rules: z.array(
    z.strictObject({
      effect: z.enum(EFFECTS),
      amount: z
        .strictObject({
          gt: nullableCents,
          gte: nullableCents,
          lt: nullableCents,
          lte: nullableCents,
        })
        .nullable(),
      property_ids: z.array(id).nullable(),
      except_property_ids: z.array(id).nullable(),
      payment_types: z.array(z.enum(PAYMENT_TYPES)).nullable(),
    }),
  ),
  questions: z.array(z.strictObject({ topic: z.enum(QUESTION_TOPICS), question: z.string() })),
  unsupported: z.array(z.strictObject({ text: z.string(), reason: z.string() })),
});

const nullableNumber = { type: ['integer', 'null'] };

export const MODEL_OUTPUT_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'interpretation',
    'revised_sentence',
    'not_covered',
    'rules',
    'questions',
    'unsupported',
  ],
  properties: {
    interpretation: { type: 'string' },
    revised_sentence: { type: 'string' },
    not_covered: { type: ['string', 'null'] },
    rules: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['effect', 'amount', 'property_ids', 'except_property_ids', 'payment_types'],
        properties: {
          effect: { type: 'string', enum: [...EFFECTS] },
          amount: {
            type: ['object', 'null'],
            additionalProperties: false,
            required: ['gt', 'gte', 'lt', 'lte'],
            properties: {
              gt: nullableNumber,
              gte: nullableNumber,
              lt: nullableNumber,
              lte: nullableNumber,
            },
          },
          property_ids: { type: ['array', 'null'], items: { type: 'integer' } },
          except_property_ids: { type: ['array', 'null'], items: { type: 'integer' } },
          payment_types: {
            type: ['array', 'null'],
            items: { type: 'string', enum: [...PAYMENT_TYPES] },
          },
        },
      },
    },
    questions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['topic', 'question'],
        properties: {
          topic: { type: 'string', enum: [...QUESTION_TOPICS] },
          question: { type: 'string' },
        },
      },
    },
    unsupported: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['text', 'reason'],
        properties: { text: { type: 'string' }, reason: { type: 'string' } },
      },
    },
  },
} as const;

export type NormalizedDraft = {
  status: DraftStatus;
  interpretation: string;
  revised_sentence: string;
  not_covered: string | null;
  rule: PolicyRuleV1 | null;
  questions: DraftQuestion[];
  unsupported: UnsupportedPart[];
  conflicts: RuleConflict[];
};

type NormalizeResult = { ok: true; draft: NormalizedDraft } | { ok: false; reason: string };

const fail = (reason: string): NormalizeResult => ({ ok: false, reason });
const isSafeInt = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n);
const present = <T>(list: T[] | null): T[] => list ?? [];

export function normalizeModelOutput(
  output: ModelOutput,
  ctx: { vendorId: number; propertyIds: ReadonlySet<number> },
): NormalizeResult {
  const interpretation = output.interpretation?.trim();
  const revised = output.revised_sentence?.trim();
  if (!interpretation || interpretation.length > MAX_TEXT)
    return fail('interpretation is blank or too long');
  if (!revised || revised.length > MAX_TEXT) return fail('revised_sentence is blank or too long');
  const modelNotCovered = output.not_covered?.trim() ?? '';
  if (modelNotCovered.length > MAX_NOT_COVERED) return fail('not_covered is too long');
  if (output.rules.length > MAX_RULES) return fail('too many rules');

  // Integer checks first, so a fractional or string value is malformed, not an unknown id.
  for (const r of output.rules) {
    for (const value of [...present(r.property_ids), ...present(r.except_property_ids)]) {
      if (!isSafeInt(value)) return fail('property id is not an integer');
    }
    for (const value of Object.values(r.amount ?? {})) {
      if (value !== null && (!isSafeInt(value) || value < 0))
        return fail('amount is not a whole number of cents');
    }
  }

  let droppedUnknown = false;
  const rules: PolicyRuleEntry[] = [];
  for (const r of output.rules) {
    if (present(r.property_ids).length > 0 && present(r.except_property_ids).length > 0) {
      return fail('rule has both property_ids and except_property_ids');
    }
    const when: RuleConditions = {};
    if (r.amount) {
      const amount: AmountCondition = {};
      for (const key of ['gt', 'gte', 'lt', 'lte'] as const) {
        const value = r.amount[key];
        if (value !== null) amount[key] = value;
      }
      if (Object.keys(amount).length > 0) when.amount_cents = amount;
    }
    let scopeLost = false;
    for (const key of ['property_ids', 'except_property_ids'] as const) {
      const given = present(r[key]);
      if (given.length === 0) continue;
      const known = [...new Set(given)].filter((value) => ctx.propertyIds.has(value));
      if (known.length < new Set(given).size) droppedUnknown = true;
      // Dropping every named property would silently widen the rule to all properties.
      if (known.length === 0) scopeLost = true;
      else when[key] = known;
    }
    if (present(r.payment_types).length > 0) when.payment_types = [...new Set(r.payment_types)];
    if (scopeLost) continue;
    rules.push({ effect: r.effect, when });
  }

  const rule: PolicyRuleV1 | null =
    rules.length > 0 ? { schema_version: 1, vendor_id: ctx.vendorId, rules } : null;
  if (rule && !isPolicyRuleV1(rule)) return fail('rule does not match schema v1');

  const questionTexts: Array<{ topic: QuestionTopic; question: string }> = [];
  if (droppedUnknown) {
    questionTexts.push({ topic: 'property', question: UNKNOWN_PROPERTY_QUESTION });
  }
  for (const q of output.questions) {
    const question = q.question?.trim();
    if (!question) return fail('blank question');
    questionTexts.push({ topic: q.topic, question });
  }
  const conflicts = findConflicts(rules);
  // Blank or overlong (over 500 characters) entries are dropped, not truncated.
  const unsupported = output.unsupported
    .map((u) => ({ text: u.text.trim(), reason: u.reason.trim() }))
    .filter((u) => u.text && u.reason && [...u.text].length <= 500 && [...u.reason].length <= 500);
  if (questionTexts.length === 0 && unsupported.length === 0 && conflicts.length === 0 && !rule) {
    questionTexts.push({ topic: 'effect', question: NO_RULE_QUESTION });
  }
  const questions = questionTexts
    .slice(0, MAX_QUESTIONS)
    .map((q, i) => ({ id: `q${i + 1}`, ...q }));

  const status: DraftStatus =
    unsupported.length > 0
      ? 'unsupported'
      : conflicts.length > 0
        ? 'conflicting'
        : questions.length > 0
          ? 'needs_clarification'
          : 'complete';

  const coversEverything = rules.some((r) => Object.keys(r.when).length === 0);
  const not_covered = coversEverything ? null : modelNotCovered || GENERIC_NOT_COVERED;

  return {
    ok: true,
    draft: {
      status,
      interpretation,
      revised_sentence: revised,
      not_covered,
      rule,
      questions,
      unsupported,
      conflicts,
    },
  };
}

const EFFECT_LABELS: Record<Effect, string> = {
  allow: 'auto-pay',
  require_approval: 'needs approval',
  block: 'blocked',
};

function amountRange(a: AmountCondition | undefined): [number, number] {
  const lower = a?.gte ?? (a?.gt !== undefined ? a.gt + 1 : 0);
  const upper = a?.lte ?? (a?.lt !== undefined ? a.lt - 1 : Number.MAX_SAFE_INTEGER);
  return [lower, upper];
}

function propertiesOverlap(a: RuleConditions, b: RuleConditions): boolean {
  if (a.property_ids && b.property_ids)
    return a.property_ids.some((p) => b.property_ids!.includes(p));
  if (a.property_ids && b.except_property_ids)
    return !a.property_ids.every((p) => b.except_property_ids!.includes(p));
  if (a.except_property_ids && b.property_ids)
    return !b.property_ids.every((p) => a.except_property_ids!.includes(p));
  // Absent scope matches everything; two except-lists always share a property (now or later).
  return true;
}

function paymentTypesOverlap(a: RuleConditions, b: RuleConditions): boolean {
  if (!a.payment_types || !b.payment_types) return true;
  return a.payment_types.some((t) => b.payment_types!.includes(t));
}

export function findConflicts(rules: PolicyRuleEntry[]): RuleConflict[] {
  const conflicts: RuleConflict[] = [];
  const ranges = rules.map((r) => amountRange(r.when.amount_cents));
  rules.forEach((_, i) => {
    const [lower, upper] = ranges[i]!;
    if (lower > upper) {
      conflicts.push({
        rules: [i, i],
        explanation: `Rule ${i + 1} can never apply: its amount range is empty.`,
      });
    }
  });
  for (let i = 0; i < rules.length; i++) {
    for (let j = i + 1; j < rules.length; j++) {
      const a = rules[i]!;
      const b = rules[j]!;
      if (a.effect === b.effect) continue;
      const [aLow, aHigh] = ranges[i]!;
      const [bLow, bHigh] = ranges[j]!;
      if (aLow > aHigh || bLow > bHigh) continue;
      if (Math.max(aLow, bLow) > Math.min(aHigh, bHigh)) continue;
      if (!propertiesOverlap(a.when, b.when) || !paymentTypesOverlap(a.when, b.when)) continue;
      conflicts.push({
        rules: [i, j],
        explanation: `Rule ${i + 1} (${EFFECT_LABELS[a.effect]}) and rule ${j + 1} (${EFFECT_LABELS[b.effect]}) can both apply to the same bill.`,
      });
    }
  }
  return conflicts;
}

export function formatCents(value: number): string {
  const dollars = Math.floor(value / 100).toLocaleString('en-US');
  const remainder = value % 100;
  return remainder === 0 ? `$${dollars}` : `$${dollars}.${String(remainder).padStart(2, '0')}`;
}
