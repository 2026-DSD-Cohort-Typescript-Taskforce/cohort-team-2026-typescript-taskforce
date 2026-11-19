# Policy versions and enforcement

Proposed for DC-91 and DC-92 review. 2026-11-18. Owner: Lawrence Crasto.

[DC-91](https://one-atlas-ofwi.atlassian.net/browse/DC-91) turns a complete policy draft (ADR [0003](0003-policy-rule-schema.md)) into a confirmed, active version of the vendor's policy. [DC-92](https://one-atlas-ofwi.atlassian.net/browse/DC-92) makes bills obey it. This record covers confirming now; the enforcement sections are added with DC-92. The code is the source of truth: `supabase/migrations/20261118233000_policy_versions.sql` and `supabase/migrations/20261118233100_confirm_policy_draft.sql`.

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
