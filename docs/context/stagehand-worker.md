# Stagehand worker

Covers: `server/src/payments`, `server/src/routes/stagehand.routes.ts`, `server/src/app.ts`, `server/vercel.json`, `server/test/vercel-config.test.ts`

Last changed by AI: 2026-11-19 · run 1a537252-eb67-4436-b57d-68b00dfe095b · files: server/test/vercel-config.test.ts, server/vercel.json

## Current view

The existing Express app exposes POST `/observe` and `/execute` for bill-mcp. `createStagehandRoutes` authenticates the exact bearer secret before parsing a strict 16 KB JSON body. Missing configuration or invalid credentials returns 401. Existing `/api/auth` routes remain separate. No worker module imports Supabase or updates approvals, bills, or payments.

`BrowserWorker` owns execution ordering. Observation opens one isolated browser, returns visible body text, and closes it. Execution pins one validated operator-owned portal profile, converts the request amount to exact USD cents without rounding, claims an idempotency key including the normalized amount, and verifies invoice/total. The portal session repeats every readable pre-click check—including invoice, total, confirmation absence, and one visible enabled Pay control—before invoking the durable submission-intent callback immediately before its atomic recheck-and-click. It then atomically verifies the confirmation marker, matching invoice/total, and transaction reference in one browser snapshot, persists, and returns `{ confirmed: true }`. Only a confirmed response is HTTP 2xx. Internal errors are translated to safe HTTP messages.

`StagehandBrowser` uses Stagehand 4.4.0 with either local Chrome or a fresh Browserbase session. Browserbase sessions preload Stagehand's extension and restrict main-frame navigation to configured portal domains. The adapter also keeps the stricter CDP guard below. It disables model-driven actions; deterministic selectors are server configuration, never request fields. Authenticated portals requiring login/MFA still need portal-specific work.

`navigation-guard.ts` intercepts Chrome document requests, including redirects and new pages, before network navigation. Observation uses the profile whose `portalUrl` matches the request, or the single profile that omits `portalUrl`. That shared profile's `capture` steps run after the page loads and before the body text is returned. Execution still requires an exact `portalUrl` and does not run the shared script. Observation then permits only the requested document URL. A sign-in on that same portal host may use POST. Requests to any other host stay blocked. Execution additionally permits an explicitly configured confirmation URL. Network assets may load; the worker never generates a destination or follows model-provided steps.

The execution repository has two backends. `file` keeps the existing fsynced single-host journal. `supabase` uses service-only, atomic RPCs over `stagehand_executions` for serverless or multi-instance deployments. Both hash idempotency keys, replay confirmed results, permit only safe pre-submit retries, and leave post-intent failures as `outcome_unknown`. Do not delete state or use a new key to bypass reconciliation. bill-mcp remains responsible for bill-level authorization and avoiding another payment with a different key.

For Vercel, `server/vercel.json` explicitly bundles Stagehand's dynamically read extension ZIP. The focused configuration test guards the Express entry point, scalar include path, and installed asset. Local checks cannot inspect Vercel's final bundle, so authenticated production `/observe` remains the decisive post-deployment smoke test.

### DC-96 demo portal integration

PR #52 provides a synthetic checkout at `/demo/payments` on the Next.js app. Keep the DC-96 checkout in a separate worktree while working on DC-95. This branch does not merge the demo page or enable live payments. The checked-in `server/test/fixtures/demo-portals.json` is an operator profile example for `http://localhost:3002/demo/payments`; copy it to an operator-owned file and set `STAGEHAND_PORTALS_FILE` to that absolute path. Replace the origin with the exact running demo URL if using another port or deployment. There is no separate confirmation URL. The fixture uses demo vendor 9, bill 7, invoice INV-7, amount 125 USD; these identifiers are not database records. Do not configure real vendor rows from these sample values.

The adapter waits up to 15 seconds for one visible, enabled Pay control during review before the worker records submission intent. This permits checkout hydration and receipt recovery to finish. The final submit still rechecks invoice, amount, confirmation absence, and control readiness together. A page that changes after review continues to fail closed; never clear durable state to retry an uncertain submission.

With the DC-96 portal running, execute from `server/`:

```sh
STAGEHAND_BROWSER_TEST=1 STAGEHAND_DEMO_URL=http://localhost:3002/demo/payments node --import tsx --test test/stagehand-browser.test.ts test/demo-portal.test.ts
```

The demo test runs actual Chrome through authenticated `/observe` and `/execute` handlers with an ephemeral secret and journal. It checks unauthorized rejection, observation, invoice/amount mismatch rejection, a matching receipt, and confirmed-key replay through both HTTP and a fresh journal instance without another browser opening. It does not call bill-mcp or use production credentials. The test is skipped unless `STAGEHAND_DEMO_URL` is explicitly set. Use only the synthetic DC-96 portal.

### Configuration

Start the server with `npm --prefix server run dev`. Set `STAGEHAND_SECRET` to bill-mcp's shared secret. Locally, use `STAGEHAND_BROWSER_PROVIDER=local`, an absolute `STAGEHAND_PORTALS_FILE`, and the default `file` state backend. A Vercel deployment should use `browserbase`, `BROWSERBASE_API_KEY`, inline `STAGEHAND_PORTALS_JSON`, `supabase`, and `STAGEHAND_SUPABASE_SECRET_KEY`; it does not need local Chrome or a writable durable volume. `server/vercel.json` explicitly includes Stagehand's dynamically read extension ZIP in the Express function bundle; keep that configuration when changing the deployment entry point. Before the first switch to `supabase`, reconcile every legacy file-journal record, especially `submitting` records, then set `STAGEHAND_STATE_CUTOVER_ACK=supabase-journal-reconciled`. bill-mcp's `STAGEHAND_URL` points to this server but is not consumed here.

Example profile for a synthetic portal (replace every URL, vendor ID, and selector with verified portal-specific values):

```json
[
  {
    "portalUrl": "http://127.0.0.1:8080/pay",
    "vendorId": 9,
    "amountUnit": "dollars",
    "invoiceSelector": "#invoice",
    "totalSelector": "#total",
    "paySelector": "#pay",
    "confirmationSelector": "#confirmed",
    "confirmationInvoiceSelector": "#receipt-invoice",
    "confirmationTotalSelector": "#receipt-total",
    "confirmationReferenceSelector": "#reference"
  }
]
```

`amountUnit` must be explicitly agreed with bill-mcp: `dollars` accepts exact decimal amounts with at most two places; `cents` accepts positive safe integers. Portal totals and receipt totals must be USD decimal text. No default amount unit is assumed. An optional `confirmationUrl` permits one additional exact document URL during execution.

### Checks and limitations

Run server build, typecheck, lint, and `npm --prefix server test`. Auth tests require local Supabase and seeded users. The real-browser test is opt-in: from `server/`, run `STAGEHAND_BROWSER_TEST=1 node --import tsx --test test/stagehand-browser.test.ts`. It launches Chrome against temporary local fixtures, not a live vendor. Regular tests exercise HTTP authorization, strict bodies and malformed JSON, configured observation URLs, safe retry concurrency, mismatches, durable replay, unknown outcomes, and confirmation ordering.

The hosted synthetic portal is covered by an opt-in Browserbase observation test. A full production bill-mcp execution and authenticated vendor flow remain unverified. The worker cannot independently prove the caller read a URL from the database; the shared secret authenticates that trust boundary. Keep portal configuration and state private, and do not expose these endpoints or browser session material to the client. No live payment has been attempted.

## Lessons

- 2026-11-15 · run e30488e3: Stagehand v4's browser handle needs an attached Stagehand client before page access; deterministic browser APIs do not require giving an LLM permission to pay.
- 2026-11-15 · run e30488e3: Persist an exclusive key claim and submission intent before clicking. An ambiguous outcome must remain blocked across process restarts.
- 2026-11-17 · run 05303049: Validate observation destinations before Chrome starts. Persist known pre-submission failures as retryable, but claim each retry exclusively and never reopen an uncertain post-intent execution.
- 2026-11-17 · run e2ccbcbd: Let the portal session own the last known-safe pre-click boundary; persist submission intent only after its final readable mismatch check and immediately before atomic check-and-click.
- 2026-11-18 · run 9d05b7a6: Browserbase hides CDP on its Stagehand handle. Create a provider-restricted session with the bundled extension, connect through the Browserbase-aware adapter, and retain its connection URL for the exact navigation guard.

## History

### 2026-11-19 · run 1a537252-eb67-4436-b57d-68b00dfe095b · Ensure Vercel bundles the Stagehand extension archive required before Browserbase session creation.

**Changed:** Added a Vercel includeFiles rule for Stagehand's dynamically read extension ZIP, guarded it with a focused regression, and documented that production /observe must be retested after deployment. The production smoke test is intentionally still pending until the PR deploys.
**Learned:** Retained the dynamic Stagehand asset requirement and the post-deployment verification boundary.
**Decisive check:** Planned commands: node --run lint; node --run typecheck; node --run format:check. Final outcomes are not yet claimed; inspect run 1a537252-eb67-4436-b57d-68b00dfe095b command receipts separately. Local receipts may not travel with source.
**Files:** server/test/vercel-config.test.ts@sha256:20e0fe3204d4dee7f18745d1c765b639d1a1925534d0eef209aec4c9db22b6f2, server/vercel.json@sha256:77e8ac9e008ffe12aa4334451e4de54e222e4769d06e1000d427890f624f10bb

### 2026-11-15 · run e30488e3-524f-4d93-be44-fee5edeb4cbd · Implement authenticated Stagehand observe/execute worker endpoints with durable duplicate protection

**Changed:** Implement authenticated Stagehand observe/execute worker endpoints with durable duplicate protection
**Learned:** See the authored Current view; no user acceptance is inferred.
**Decisive check:** Planned commands: node --run lint; node --run typecheck; node --run format:check. Final outcomes are not yet claimed; inspect run e30488e3-524f-4d93-be44-fee5edeb4cbd command receipts separately. Local receipts may not travel with source.
**Files:** server/src/app.ts@sha256:a1d879f05240dd42699d95bd93fb6166fe2440b4331b8579ea895b757d20f335, server/src/payments/execution-store.ts@sha256:86a3625ea8a97597e367d654f4bc60f8d77dae0697067b1426143185272489af, server/src/payments/navigation-guard.ts@sha256:4ef614ae051a3692927fab41db778af7bc300c4fcc32414020c8ad680ad9d24c, server/src/payments/payment-contract.ts@sha256:1028d27b8cdb8217bba385725f590147fd771de21f5fec9e4ce43bc87233618a, server/src/payments/stagehand-browser.ts@sha256:8b844ad7ed2245c6049973f5d3f89e022e303c87eba462a78a04d00e350174a2, server/src/payments/worker-input.ts@sha256:f9fa9cc47ec1b99629da3b8caa9208742254f2be0107ee28f234c31a442ff692, server/src/payments/worker.ts@sha256:1fb5f7f5b38e0107e2802d46d96a84217c8f6ebd08f5e1c4f42cc6541381a9f2, server/src/routes/stagehand.routes.ts@sha256:3f06b3f7884070570aee253dd303b30763ecd83a22fea4fd18232c6faf07f304
