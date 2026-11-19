# Policy versions and enforcement

Proposed for DC-91 and DC-92 review. 2026-11-18. Owner: Lawrence Crasto.

[DC-91](https://one-atlas-ofwi.atlassian.net/browse/DC-91) turns a complete policy draft (ADR [0003](0003-policy-rule-schema.md)) into a confirmed, active version of the vendor's policy. [DC-92](https://one-atlas-ofwi.atlassian.net/browse/DC-92) makes bills obey it. This record covers confirming, evaluating and enforcing. The code is the source of truth: `supabase/migrations/20261118233000_policy_versions.sql`, `supabase/migrations/20261118233100_confirm_policy_draft.sql`, `supabase/migrations/20261118234000_evaluate_bill_policy.sql` and `supabase/migrations/20261118234100_enforce_bill_policy.sql`.

## Policy versions

`policy_versions` has one row per confirmation: the rule (checked by `policy_rule_is_valid`, a SQL copy of the rule schema), the draft's sentences, interpretation, `not_covered` and `answers`, the draft revision it came from, who confirmed it and when. `(policy_id, version)` is unique. Versions are never edited, and are deleted only when their policy or vendor is.

`policies.active_version_id` points at the version the policy enforces. A policy with no active version, or with `is_active = false`, enforces nothing. Managers keep their DC-85 column grants (`vendor_id`, `name`, `description` on insert; `name`, `description`, `is_active`, `updated_at` on update), so only `confirm_policy_draft` can set `active_version_id`. Every signed-in user can read versions. Nobody writes them directly.

## Confirming a draft

`public.confirm_policy_draft(p_vendor_id integer, p_revision integer, p_name text) returns jsonb` returns `{ "policy": <policies row>, "version": <policy_versions row> }`. It is security definer and executable by `authenticated` only. The checks run in this order:

| Check | Error (code, message, details) |
| --- | --- |
| Caller is a policy manager | `PT403` `forbidden` |
| Name, trimmed, is 1 to 100 characters | `PT400` `invalid_policy`, `["name"]` |
| Vendor exists | `PT404` `vendor_not_found` |
| _Lock the vendor's policy row (if any), then the draft row_ | |
| Draft exists | `PT404` `draft_not_found` |
| `draft.revision` equals `p_revision` | `PT409` `stale_draft` |
| `draft.status` is `complete` | `PT409` `draft_not_complete`, details = the status |
| `draft.policy_updated_at` equals the policy's `updated_at` (both null when there is no policy) | `PT409` `policy_changed` |
| `policy_rule_is_valid(draft.rule, p_vendor_id)` | `PT400` `invalid_rule` |

Then, in the same transaction:

- Insert the policy, or update it: the trimmed name, the description, `is_active = true`, `updated_at = now()`.
- Insert the version, numbered one more than the policy's highest (1 for a new policy), with `confirmed_by` the caller's `users.user_id`.
- Set `policies.active_version_id` to it.
- Delete the draft. Users have no delete grant on drafts; the function does it as its owner.

Decisions:

- **Confirming turns the policy on.** There is no separate switch to flip after confirming.
- **The description is the draft's `revised_sentence`.** It falls back to `sentence` when the revised sentence is blank or over 1000 characters (the length `policies.description` allows; the draft allows 2000).
- **A name-only edit makes a draft stale.** The DC-85 route bumps `policies.updated_at`, so confirming an older draft answers `policy_changed` and the manager reviews it again.
- **Confirming deletes the draft.** The version keeps its copy of everything the draft held.

## Evaluating a bill

`public.evaluate_bill_policy(p_bill_id integer) returns jsonb` reads the bill and its vendor's policy and answers, without changing anything: `{ decision, policy_id, version_id, version, rule_index, policy_name, interpretation }`. It is security definer, stable, and executable by `authenticated` and `service_role`. A bill that does not exist raises `PT404` `not_found`.

| Situation | `decision` | Other fields |
| --- | --- | --- |
| Vendor has no policy, the policy is off, or it has no active version | `none` | all null |
| Active version is missing, belongs to another policy, or fails `policy_rule_is_valid` | `block` | policy and version fields filled; `rule_index` null |
| A rule has a condition on a fact the bill lacks | `block` | policy and version fields filled; `rule_index` null |
| No rule matches | `none` | policy and version fields filled; `rule_index` null |
| Otherwise | the strongest matching effect | `rule_index` = lowest zero-based index among matching rules with that effect |

- **Precedence:** `block` over `require_approval` over `allow`. A matching `allow` has no effect on its own beyond naming the rule.
- **Facts:** `amount_cents = round(bills.amount * 100)`; `property_id`; `payment_type` from `payment_methods` through `bills.payment_method_id`.
- **Matching** follows ADR 0003 "Meaning": keys are ANDed, an absent key matches anything, bounds compare whole cents (`$500.00` is not `gt: 50000`, is `gte`/`lte: 50000`).
- **Fail closed:** a present condition key whose fact is null (no amount, no property, no payment method) blocks, even when another key in the same rule would not have matched. An absent key never needs its fact, so a draft with nulls is fine under a rule that does not ask about them.

`public.bill_has_qualifying_approval(p_bill_id integer) returns boolean` is true when the bill's newest approval (`created_at desc, approval_id desc`) is `approved` and `approved_by` is not null and differs from `submitted_by`. A self-approval or an auto-approve row never counts. It has the same security and grants.

## Where it's enforced

The database applies the evaluator's answer wherever a bill moves toward payment. A refusal is `PT409` with the evaluator's JSON (above) as the error's `details`, so a caller can name the policy and show its interpretation. `submit_bill`, `prepare_payment` and `start_payment_submission` keep their signatures and grants.

| Function | Checked | Decision | Result |
| --- | --- | --- | --- |
| `submit_bill(p_bill_id, p_needs_approval)` | after the completeness check | `block` | `PT409` `policy_blocked`; the bill stays a draft, no approvals row |
| | | `require_approval` | `pending_approval` and a `pending` approvals row submitted by the caller, even when `p_needs_approval` is false |
| | | `allow`, `none` | unchanged: `p_needs_approval = true` still goes to approval |
| `prepare_payment(...)` | after `not_payable`, before older attempts are superseded | `block` | `PT409` `policy_blocked` |
| | | `require_approval`, no qualifying approval | `PT409` `approval_required` |
| | | otherwise | prepared, with `policy_refs` = `[{ policy_id, version_id, version, decision }]` for the active version, or `[]` when there is none |
| `start_payment_submission(p_payment_id)` | after `summary_stale` | `block` | `PT409` `policy_blocked` |
| | | active version differs from `policy_refs[0].version_id` (a version appearing or disappearing included) | `PT409` `policy_changed`; the admin triggers the payment again |
| | | `require_approval`, no qualifying approval | `PT409` `approval_required` |

`prepare_payment` still checks `p_policy_refs` is a JSON array, so existing callers keep working, but it no longer stores it.

`public.send_bill_for_approval(p_bill_id integer, p_requested_by integer) returns jsonb` sends a queued bill back to the approver when its vendor's policy now needs an approval. It is security definer and executable by `service_role` only. The checks run in this order:

| Check | Error (code, message, details) |
| --- | --- |
| `p_requested_by` is a `billing_operator`, `financial_approver` or `system_admin` | `PT403` `forbidden` |
| _Lock the bill_ | |
| Bill exists | `PT404` `not_found` |
| Status is `pending_payment` or `payment_failed` | `PT409` `not_payable`, details = the status |
| No `processing` or `unknown` attempt | `PT409` `payment_in_progress`, details = its `payment_id` |
| Decision is `require_approval` and there is no qualifying approval | `PT409` `approval_not_required`, details = the evaluator's JSON |

Then, in the same transaction: the bill's `pending` or `authorized` attempt is expired with `outcome_code = 'superseded'`, the bill becomes `pending_approval`, and a `pending` approvals row is inserted with `submitted_by = p_requested_by`. It returns the evaluator's JSON. The DC-101 row triggers log the changes; nothing is logged by hand.

Decisions:

- **A blocked bill stays a draft.** There is no new status.
- **`allow` never removes an approval the operator asked for.**
- **Only someone else's approval satisfies a policy.** Whoever triggers a send-back is the approval's submitter, so if they approve it themselves, payment is still refused with `approval_required` and the bill can be sent back again.
- **A policy that is switched off is ignored**, including for a bill it already sent to approval: once approved, it is prepared with `policy_refs = []`.
- **At the claim, a block wins over `policy_changed`.** Triggering again cannot help a blocked bill, so the claim says so directly. A different version that does not block answers `policy_changed`, and the next trigger applies it (including a send-back).
- **Lock order.** Like the payment functions, `send_bill_for_approval` locks the bill before its attempt and sets the payments write marker only for its own writes.
