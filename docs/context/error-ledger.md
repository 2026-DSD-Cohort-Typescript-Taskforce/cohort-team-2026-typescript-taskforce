# Error ledger

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
