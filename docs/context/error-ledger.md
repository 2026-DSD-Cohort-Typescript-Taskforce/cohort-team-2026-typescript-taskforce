# Error ledger

## 2026-11-15 — DC-95 browser integration

- Initial protected-route test failed with 404 instead of 401 on the original app; routes now authenticate before parsing or browser work.
- First Chrome fixture run failed because Stagehand v4 requires `Stagehand.create({ browser })` before accessing `browser.context`. Attach a client with model actions disabled and close both client and browser.
- Next fixture run reached execution but failed reading review details. Nested named arrow functions inside browser evaluations can retain tsx/esbuild helper references unavailable in Chrome. Removing those nested helper declarations preserved matching and no-submission assertions; the real Chrome fixture then passed observation, redirect blocking, mismatch rejection, confirmed submission, and replay.

- Independent review identified non-atomic receipt reads and profile reload between validation and execution. Pin the validated profile, include normalized cents in the idempotency fingerprint, and validate every receipt field in one browser predicate. Added profile-change regression tests; final Chrome fixture still required on the revised candidate.
