# Error ledger

## 2026-11-15 — DC-95 browser integration

- Initial protected-route test failed with 404 instead of 401 on the original app; routes now authenticate before parsing or browser work.
- First Chrome fixture run failed because Stagehand v4 requires `Stagehand.create({ browser })` before accessing `browser.context`. Attach a client with model actions disabled and close both client and browser.
- Next fixture run reached execution but failed reading review details. Nested named arrow functions inside browser evaluations can retain tsx/esbuild helper references unavailable in Chrome. Removing those nested helper declarations preserved matching and no-submission assertions; the real Chrome fixture then passed observation, redirect blocking, mismatch rejection, confirmed submission, and replay.

- Independent review identified non-atomic receipt reads and profile reload between validation and execution. Pin the validated profile, include normalized cents in the idempotency fingerprint, and validate every receipt field in one browser predicate. Added profile-change regression tests; final Chrome fixture still required on the revised candidate.

## 2026-11-16 — Demo checkout verification

- `npm run dev` cannot start because this checkout lacks nodemon; used installed Next CLI directly.
- Initial Chrome attempts hit connection refused because Next's upgrade advisory stopped startup.
  Retried the unchanged command within its retry window; no configuration was changed.
- Receipt recovery initially updated state synchronously in an effect, rejected by the React
  lint rule. Scheduled browser storage recovery on an animation frame and kept Pay disabled
  until recovery completes. Lint then passed.
- CYC proof was inconclusive because the frozen focused command names a test file absent on
  the original checkout. No behavioral red proof is claimed. CYC then halted because Next
  automatically appended feedback instructions to client/AGENTS.md outside the frozen scope.
  No new run or gate bypass was attempted. Product checks continue independently.
- Repository-wide format check flags existing local CYC files plus paymentMethods.ts and the
  payment contract ADR. No unrelated formatting was changed.

## 2026-11-17 — DC-95 review fixes

- PR review showed that observation bypassed the execution profile lookup, so an authenticated caller could open an arbitrary HTTP(S) destination. Observation now requires an exact operator-profile URL before Chrome launches; the regression rejects an unconfigured loopback URL.
- Pre-submission failures were persisted as permanently blocked even though Pay could not have been clicked. The journal now records them as retryable and uses an exclusive retry claim; concurrent retry coverage proves one submission, while post-intent failures remain `outcome_unknown`.
- Route-local JSON parsing previously fell through to the generic Express error shape. The Stagehand parser now returns `code: invalid_request` without changing other app routes.
- A second review found that submission intent still preceded `submit()`'s readable pre-click checks. `submit()` now verifies invoice, total, confirmation absence, and one visible enabled Pay control before invoking the journal transition immediately before atomic recheck-and-click; a regression proves a pre-callback mismatch can safely retry. Profile-gated Chrome fixtures now configure their worker and redirect URLs so navigation-guard assertions reach the browser.
