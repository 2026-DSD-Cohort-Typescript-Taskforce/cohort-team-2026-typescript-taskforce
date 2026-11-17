# Error ledger

## 2026-11-17 — snapshot_mismatch invoice_number @ execute_approved_payment

- Signature: `snapshot_mismatch fields:["invoice_number"]` while `execute_approved_payment` observes the portal.
- Area: `server/profiles.json` capture steps, used by Stagehand observe before bill-mcp compares page text.
- Status: resolved
- Cause: the shared profile's first click was `a[href='#business']`. That link exists on Copper Ridge and Prairie Grid. The other live hosts never render it, so observe does not reach the signed-in bill list. A page can still show a dollar amount, such as `$518.70`, while the invoice id is only on the bill list.
- Attempt: replace the entry clicks with `footer a[href='#signin/account']`, login, and `.balance-amount`, and open the first pay or statement link before sample details. The profile test failed on the old file for that step list, then passed.
- Fix: `server/profiles.json` now uses that shared sign-in. No commit yet.
- Guard: `the portal file signs in from the shared footer and omits vendor id and url` in `server/test/stagehand.test.ts`.
- Limit: Brightwater, Northline, and Prairie Grid land on a statement page, where `#sample-details` is absent, so this file does not submit those three.

## 2026-11-15 — DC-95 browser integration

- Initial protected-route test failed with 404 instead of 401 on the original app; routes now authenticate before parsing or browser work.
- First Chrome fixture run failed because Stagehand v4 requires `Stagehand.create({ browser })` before accessing `browser.context`. Attach a client with model actions disabled and close both client and browser.
- Next fixture run reached execution but failed reading review details. Nested named arrow functions inside browser evaluations can retain tsx/esbuild helper references unavailable in Chrome. Removing those nested helper declarations preserved matching and no-submission assertions; the real Chrome fixture then passed observation, redirect blocking, mismatch rejection, confirmed submission, and replay.

- Independent review identified non-atomic receipt reads and profile reload between validation and execution. Pin the validated profile, include normalized cents in the idempotency fingerprint, and validate every receipt field in one browser predicate. Added profile-change regression tests; final Chrome fixture still required on the revised candidate.
