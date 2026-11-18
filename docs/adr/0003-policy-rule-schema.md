# Policy rule v1 and the policy draft contract

Proposed for DC-91 and DC-92 review. 2026-11-16. Owner: Lawrence Crasto.

[DC-90](https://one-atlas-ofwi.atlassian.net/browse/DC-90) turns a vendor's policy sentence into a policy draft: a proposed rule, saved but inactive. This record fixes the rule shape and the draft API. DC-91 (confirm and activate) and DC-92 (evaluate bills) build on it. The code is the source of truth: `client/lib/policy-rule.ts`, `client/lib/policy-drafts.ts`, `client/lib/policy-draft-service.ts` and `client/app/api/policies/[vendorId]/draft/route.ts`.

## Policy rule v1

```ts
type PolicyRuleV1 = {
  schema_version: 1;
  vendor_id: number;
  rules: Array<{
    effect: 'allow' | 'require_approval' | 'block';
    when: {
      amount_cents?: { gt?: number; gte?: number; lt?: number; lte?: number };
      property_ids?: number[];
      except_property_ids?: number[];
      payment_types?: Array<'card' | 'bank'>;
    };
  }>;
};
```

| Field                 | Rule                                                                                                                     |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `schema_version`      | Always `1`.                                                                                                              |
| `vendor_id`           | The policy's vendor. The server sets it; the model never does.                                                           |
| `rules`               | 1 to 10 entries.                                                                                                         |
| `effect`              | `allow` (auto-pay is fine), `require_approval`, or `block`.                                                              |
| `amount_cents`        | At least one bound. Whole cents, 0 or more. At most one lower bound (`gt` or `gte`) and one upper bound (`lt` or `lte`). |
| `property_ids`        | 1 to 50 distinct property ids: only these properties.                                                                    |
| `except_property_ids` | 1 to 50 distinct property ids: every property except these. Never together with `property_ids` in one rule.              |
| `payment_types`       | 1 to 2 distinct values from `card`, `bank`.                                                                              |

The schema is strict: unknown keys are rejected. `isPolicyRuleV1` checks a value against it.

### Meaning (for DC-92)

- A rule applies to a bill of this vendor when every key present in `when` matches (AND). A key that is absent matches anything. An empty `when` applies to every bill of the vendor.
- A bill that matches no rule is not affected by the policy. It follows the normal flow.
- A complete draft has no two rules with different effects that can match the same bill (see Conflicts).
- `except_property_ids` also covers properties added later.
- Amounts are integer cents. This is DC-90's own choice. [ADR 0002](0002-payment-execution-contract.md) leaves the unit of the payment `amount` open, and DC-90 does not settle it.
- A payment method is matched on the payment method's `payment_type` (`card` or `bank`), not its id. Ids are stable per row but the type is the shared vocabulary.
- "Except card" is written `payment_types: ['bank']`. There is no payment type exclusion.

### Threshold readings

| Sentence              | Bounds                                                       |
| --------------------- | ------------------------------------------------------------ |
| over $500             | `gt: 50000`                                                  |
| $500 or more          | `gte: 50000`                                                 |
| under $500            | `lt: 50000`                                                  |
| $500 or less          | `lte: 50000`                                                 |
| between $100 and $500 | `gte: 10000, lte: 50000`, unless the sentence says otherwise |

The model is given these readings. The tests pin them.

## What v1 cannot express

The model puts these in `unsupported` instead of a rule.

| Category                    | Examples                                                                                          |
| --------------------------- | ------------------------------------------------------------------------------------------------- |
| Schedules and dates         | due dates, days of the week, "after the 15th"                                                     |
| Per-user or per-role limits | "managers can pay up to $1,000"                                                                   |
| Running totals              | a monthly or yearly total, "total spend"                                                          |
| Other vendors               | a rule that involves a vendor besides the policy's own                                            |
| Other actions               | anything besides allow, require approval or block, such as notifying, splitting payments or holds |

## Policy draft

A draft is the interpretation of one sentence. It is stored in `public.policy_drafts`, one row per vendor. A draft is inactive: it never creates a policy, changes `policies.description` or turns anything on. DC-91 does that.

`policy_drafts` is not authoritative. Any policy manager can write the table directly through PostgREST under row level security: any status, any rule JSON, even another `vendor_id`, because the shape checks live in the route by design. So before activating, DC-91 re-checks `isPolicyRuleV1(rule)`, `rule.vendor_id === vendor_id` and that `findConflicts(rule.rules)` is empty. DC-92 validates a rule before evaluating it.

| Field               | Meaning                                                                                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `vendor_id`         | The vendor.                                                                                                                                                  |
| `revision`          | 1 on the first write, plus 1 on every write. A database trigger sets it.                                                                                     |
| `status`            | `complete`, `needs_clarification`, `unsupported` or `conflicting`.                                                                                           |
| `original_sentence` | The sentence that started the draft. Kept across turns.                                                                                                      |
| `sentence`          | The latest sentence the manager submitted.                                                                                                                   |
| `revised_sentence`  | The model's rewrite with the answers folded in. DC-91 may put it in `policies.description` on confirmation.                                                  |
| `interpretation`    | A plain-language reading of the rule.                                                                                                                        |
| `not_covered`       | A plain-language note of the bills the policy leaves to the normal flow. `null` only when some rule has an empty `when`.                                     |
| `rule`              | The checked `PolicyRuleV1`, or `null` when nothing usable yet.                                                                                               |
| `questions`         | Open questions: `{ id, topic, question }`. Ids are `q1` to `q5`, reassigned on every reply. Topics: `amount`, `property`, `payment_type`, `effect`, `scope`. |
| `unsupported`       | Parts of the sentence v1 cannot express: `{ text, reason }`.                                                                                                 |
| `conflicts`         | `{ rules: [i, j], explanation }`. Indexes are zero-based into `rule.rules`.                                                                                  |
| `answers`           | Every answer so far, in order: `{ question_id, question, answer }`. The question text is copied from the draft when the answer arrives.                      |
| `policy_updated_at` | The saved policy's `updated_at` when the draft started, or `null` when the vendor had no policy. Kept across turns.                                          |
| `updated_at`        | Time of the last write.                                                                                                                                      |

### Status

The server computes it in this order:

| Order | Condition                     | Status                |
| ----- | ----------------------------- | --------------------- |
| 1     | Any `unsupported` part        | `unsupported`         |
| 2     | Any conflict                  | `conflicting`         |
| 3     | Any open question             | `needs_clarification` |
| 4     | Otherwise (at least one rule) | `complete`            |

If there is no question, no unsupported part, no conflict and no rule, the server adds the question "What should this policy do?" (topic `effect`), so the status is `needs_clarification`. At most 5 questions are kept per reply.

Only a `complete` draft is eligible for DC-91's confirmation. DC-91 should also compare `policy_updated_at` with the policy's current `updated_at` and refuse to activate a draft when they differ, because the policy changed after the draft started.

### What the server does to the model's output

- Property ids that are not in the property list the server sent are dropped, and the server asks "Which properties does this policy apply to? One of the properties named isn't in the list." (topic `property`).
- A rule whose property list is entirely unknown ids is dropped, and that same question is asked. It is never widened to all properties.
- Repeated ids and payment types are removed.
- Conflicts are computed by server code (`findConflicts`), never taken from the model.
- `unsupported` entries with a blank `text` or `reason`, or with either over 500 characters, are dropped (not truncated), so they never force the `unsupported` status.
- A rule with both `property_ids` and `except_property_ids`, a fractional or negative amount, or a non-integer id makes the whole reply malformed (502). The server does not repair it.
- `not_covered`: `null` when some rule has an empty `when`. Otherwise the model's text, or when it is blank, "Bills that match none of these rules aren't covered; they follow the normal flow."

### Conflicts

Two rules conflict when their effects differ and one bill can match both:

- their amount ranges intersect (inclusive bounds compared as whole cents),
- their property scopes intersect: absent matches all; two `property_ids` lists share an id; `property_ids` A and `except_property_ids` E intersect unless A is inside E; two except lists always intersect,
- their payment type sets intersect (absent matches all).

A rule whose amount range is empty (for example `gt: 50000` with `lt: 10000`) conflicts with itself: `rules: [i, i]`. Two overlapping rules with the same effect are not a conflict.

## API

Both routes are `/api/policies/[vendorId]/draft`. A signed-out request gets 401 `{ error }`.

### GET

Any signed-in user. 200 `{ draft: PolicyDraft | null }`.

### POST

Policy managers only (`financial_approver`, `system_admin`). Replies are 200 `{ draft }` or an error body `{ error, code, ... }`.

A body with a `revision` key is a **continue**. Any other body is a **start**.

|          | Start                                                                                                                                                                                                                       | Continue                                                                                                                           |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Body     | `{ sentence }`                                                                                                                                                                                                              | `{ revision, answers?, sentence? }`                                                                                                |
| Effect   | Replaces any existing draft for the vendor and bumps its revision (upsert plus trigger), so another client holding the old revision gets 409 on its next continue. `original_sentence` is the sentence; `answers` is empty. | Needs the stored draft at `revision`. New `answers` are appended. A new `sentence` replaces `sentence`; `original_sentence` stays. |
| Required | `sentence`                                                                                                                                                                                                                  | `revision`, and at least one of `answers` or `sentence`                                                                            |

Limits and body rules:

- `sentence`: trimmed, 1 to 1000 characters (counted by code points).
- `answers`: at most 10 per request, each `{ question_id, answer }` with the answer trimmed to 1 to 500 characters. `question_id` is 1 to 20 characters, distinct within the request, and must be a question in the stored draft.
- `revision`: a whole number from 1 to 2147483647.
- `sentence: null` on a continue is invalid. Omit the key to keep the sentence.
- Unknown keys are invalid.
- A draft holds at most 30 answers in total. A continue that would bring it over 30 is rejected with 422 `too_many_revisions`; nothing is trimmed.

Checks run in this order:

1. Policy manager role (403).
2. Vendor id (404).
3. Body shape (400).
4. Vendor exists (404).
5. `OPENROUTER_API_KEY` is set (503). The service logs "Set OPENROUTER_API_KEY. See client/.env.example." only at this step.
6. Continue only: stored draft exists (404), revision matches (409), every `question_id` is a stored question (400), answer cap (422).
7. The model call, then normalisation and conflict checks.
8. The write. A continue writes only if the stored revision still equals `revision`. If it does not, another write landed during the model call: 409 with the current draft, or 404 `draft_not_found` if the draft is gone (the vendor was deleted).

| Status | Code                         | Message                                                            | Extra                                                                                                     |
| ------ | ---------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| 200    |                              |                                                                    | `{ draft }`                                                                                               |
| 400    | `invalid_request`            | Some of the request's details aren't valid.                        | `fields`: names of the failing fields                                                                     |
| 401    |                              | You are not signed in.                                             |                                                                                                           |
| 403    | `forbidden`                  | Only financial approvers and system admins can change policies.    |                                                                                                           |
| 404    | `vendor_not_found`           | This vendor no longer exists.                                      |                                                                                                           |
| 404    | `draft_not_found`            | There's no draft for this policy yet. Start one with a sentence.   |                                                                                                           |
| 409    | `stale_draft`                | This draft changed since you loaded it. Review the latest version. | `draft`: the current draft                                                                                |
| 422    | `too_many_revisions`         | This draft has too many answers. Start the policy again.           |                                                                                                           |
| 502    | `interpretation_failed`      | Couldn't interpret the policy. Try again.                          | `draft`: the stored draft (for a start or a continue), or `null` when there is none. Nothing was written. |
| 503    | `interpretation_unavailable` | Policy interpretation isn't set up yet.                            |                                                                                                           |

A store failure on GET or POST returns the policy error mapping with "Couldn't load the policy draft. Try again." or "Couldn't save the policy draft. Try again."

The model call times out after 30 seconds and is not retried. A network error, a non-2xx reply, a timeout, non-JSON, a schema mismatch or an empty reply all give 502.

### Configuration

Server-only variables (never `NEXT_PUBLIC_`):

| Variable                  | Default                             |
| ------------------------- | ----------------------------------- |
| `OPENROUTER_API_KEY`      | none; unset gives 503               |
| `OPENROUTER_POLICY_MODEL` | `nvidia/nemotron-3.5-super-vl:free` |
| `OPENROUTER_BASE_URL`     | `https://openrouter.ai/api/v1`      |

### Storage and access

`policy_drafts.vendor_id` is the primary key and cascades on vendor delete. Every signed-in user can read. Only policy managers can insert or update (row level security). There is no delete policy. Anonymous users have no access. A trigger sets `revision`, `updated_at` and `updated_by` on every write, whatever the caller sent.

## Not in DC-90

| Not done                                                                              | Where |
| ------------------------------------------------------------------------------------- | ----- |
| Activating a draft, writing `policies.description`, deleting a draft after confirming | DC-91 |
| Policy versions, effective time                                                       | later |
| Evaluating a bill against a rule                                                      | DC-92 |
| Any UI                                                                                | later |
| Audit of drafts or policy changes                                                     | DC-23 |

## Examples

Each block is a full `PolicyDraft`. The vendor and property names are made up. The tests check that every non-null `rule` passes `isPolicyRuleV1` and every `status` is a known status.

### Complete

"Require approval for bills over $500, except at Maple Court." Maple Court is property 3.

```json
{
  "vendor_id": 12,
  "revision": 1,
  "status": "complete",
  "original_sentence": "Require approval for bills over $500, except at Maple Court.",
  "sentence": "Require approval for bills over $500, except at Maple Court.",
  "revised_sentence": "Bills over $500 need approval, except bills for Maple Court.",
  "interpretation": "Bills over $500.00 for any property except Maple Court need approval.",
  "not_covered": "Bills of $500.00 or less, and bills for Maple Court, aren't covered; they follow the normal flow.",
  "rule": {
    "schema_version": 1,
    "vendor_id": 12,
    "rules": [
      {
        "effect": "require_approval",
        "when": { "amount_cents": { "gt": 50000 }, "except_property_ids": [3] }
      }
    ]
  },
  "questions": [],
  "unsupported": [],
  "conflicts": [],
  "answers": [],
  "policy_updated_at": "2026-11-10T15:04:05.000Z",
  "updated_at": "2026-11-16T18:30:00.000Z"
}
```

### Needs clarification

"Auto-pay small bills from Northgate Landscaping." "Small" has no amount, so there is no rule yet.

```json
{
  "vendor_id": 7,
  "revision": 1,
  "status": "needs_clarification",
  "original_sentence": "Auto-pay small bills from Northgate Landscaping.",
  "sentence": "Auto-pay small bills from Northgate Landscaping.",
  "revised_sentence": "Auto-pay bills from Northgate Landscaping below a limit to be set.",
  "interpretation": "Small bills would be paid without approval, but the limit is not stated.",
  "not_covered": "Bills that match none of these rules aren't covered; they follow the normal flow.",
  "rule": null,
  "questions": [
    {
      "id": "q1",
      "topic": "amount",
      "question": "What is the largest bill that should be paid without approval?"
    }
  ],
  "unsupported": [],
  "conflicts": [],
  "answers": [],
  "policy_updated_at": null,
  "updated_at": "2026-11-16T18:32:00.000Z"
}
```

### Unsupported

"Pay Lakeview Electric on the 1st of each month and block bills over $2,000." Payment dates are outside v1. The amount part still becomes a rule.

```json
{
  "vendor_id": 21,
  "revision": 1,
  "status": "unsupported",
  "original_sentence": "Pay Lakeview Electric on the 1st of each month and block bills over $2,000.",
  "sentence": "Pay Lakeview Electric on the 1st of each month and block bills over $2,000.",
  "revised_sentence": "Block bills from Lakeview Electric over $2,000.",
  "interpretation": "Bills over $2,000.00 are blocked. The payment date is not part of the rule.",
  "not_covered": "Bills of $2,000.00 or less aren't covered; they follow the normal flow.",
  "rule": {
    "schema_version": 1,
    "vendor_id": 21,
    "rules": [{ "effect": "block", "when": { "amount_cents": { "gt": 200000 } } }]
  },
  "questions": [],
  "unsupported": [
    {
      "text": "on the 1st of each month",
      "reason": "Policies can't set payment dates yet."
    }
  ],
  "conflicts": [],
  "answers": [],
  "policy_updated_at": "2026-11-12T09:00:00.000Z",
  "updated_at": "2026-11-16T18:35:00.000Z"
}
```

### Conflicting

"Auto-pay bills over $500. Block bills over $1,000." A $1,200 bill matches both rules.

```json
{
  "vendor_id": 5,
  "revision": 2,
  "status": "conflicting",
  "original_sentence": "Auto-pay bills over $500.",
  "sentence": "Auto-pay bills over $500. Block bills over $1,000.",
  "revised_sentence": "Auto-pay bills over $500. Block bills over $1,000.",
  "interpretation": "Bills over $500.00 are auto-paid. Bills over $1,000.00 are blocked.",
  "not_covered": "Bills of $500.00 or less aren't covered; they follow the normal flow.",
  "rule": {
    "schema_version": 1,
    "vendor_id": 5,
    "rules": [
      { "effect": "allow", "when": { "amount_cents": { "gt": 50000 } } },
      { "effect": "block", "when": { "amount_cents": { "gt": 100000 } } }
    ]
  },
  "questions": [],
  "unsupported": [],
  "conflicts": [
    {
      "rules": [0, 1],
      "explanation": "Rule 1 (auto-pay) and rule 2 (blocked) can both apply to the same bill."
    }
  ],
  "answers": [],
  "policy_updated_at": "2026-11-10T15:04:05.000Z",
  "updated_at": "2026-11-16T18:40:00.000Z"
}
```
