# Stagehand worker

Covers: `server/src/payments`, `server/src/routes/stagehand.routes.ts`, `server/src/app.ts`, `server/profiles.json`

Last changed by AI: 2026-11-17 · run 45eed97d-c6f9-45a8-9bd0-6a4ef64522b0 · files: server/profiles.json

## Current view

The existing Express app exposes POST `/observe` and `/execute` for bill-mcp. `createStagehandRoutes` authenticates the exact bearer secret before parsing a strict 16 KB JSON body. Missing configuration or invalid credentials returns 401. Existing `/api/auth` routes remain separate. No worker module imports Supabase or updates approvals, bills, or payments.

`BrowserWorker` owns execution ordering. Observation opens one isolated browser, runs the portal file's capture clicks through sign-in, waits for the billing amount, returns the visible body text, and closes it. Execution runs those clicks plus the pay clicks, then uses the existing pay button. Payment requests stay blocked during observation. The portal login POST is the one mutation observation allows. Execution pins one validated operator-owned portal profile, converts the request amount to exact USD cents without rounding, claims an idempotency key including the normalized amount, verifies invoice/total, persists submission intent, submits, atomically verifies the confirmation marker, matching invoice/total, and transaction reference in one browser snapshot, then persists and returns `{ confirmed: true }`. Only a confirmed response is HTTP 2xx. Internal errors are translated to safe HTTP messages.

`StagehandBrowser` uses installed Stagehand 4.4.0 and local Chrome through dynamic import in this CommonJS server. It attaches a Stagehand client but disables model-driven actions. Deterministic selectors are server configuration, never request fields. Each browser has a fresh temporary profile; authenticated portals requiring login/MFA need a portal-specific extension. Do not enable an arbitrary live portal with untested selectors.

`navigation-guard.ts` intercepts Chrome document requests, including redirects and new pages, before network navigation. Observation permits only its supplied URL, allows that portal's `/api/login` POST, and blocks other mutation HTTP methods. Execution additionally permits an explicitly configured confirmation URL. Network assets may load; the worker never generates a destination or follows model-provided steps.

`ExecutionStore` uses exclusive hashed-key directories and atomically renamed, fsynced records. A matching confirmed key replays confirmation without opening Chrome. Conflicting payloads, in-progress keys, incomplete records, and ambiguous submissions fail closed. A failed/preparation key is not automatically reused. Keep the state directory on a durable local filesystem shared by every server process; this is not a distributed multi-host lock. Do not delete state or use a new key to bypass reconciliation. bill-mcp remains responsible for bill-level authorization and avoiding another payment with a different key.

### Configuration

Start the existing server with `npm --prefix server run dev`. Chrome and Node 22.18.0 or newer must be installed. Set `STAGEHAND_SECRET` to bill-mcp's shared secret. bill-mcp uses `STAGEHAND_URL=http://127.0.0.1:5000` locally; this server does not consume that caller setting. `STAGEHAND_PORTALS_FILE` points to an operator-owned JSON array. `server/profiles.json` is one click script and does not store a vendor id or portal URL. The portal URL still comes from the vendor record. Capture clicks the footer Account sign in link, `footer a[href='#signin/account']`, which the shared portal script renders on every live host, signs in with the login printed on the page, and waits for `.balance-amount` on the signed-in bill list. Pay clicks the first `a.button` whose href starts with `#pay/` or `#statement/`, then Use sample details, then the authorization checkbox. The pay button itself stays the existing submit step. Brightwater, Northline, and Prairie Grid open a statement page before the payment form, so `#sample-details` is not on that page and those three hosts do not reach submit. Juniper's host returns 404 and has no profile row. `STAGEHAND_STATE_DIR` optionally selects a durable directory; the default is `server/.stagehand-state` for both source and compiled code.

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

Run server build, typecheck, lint, and `npm --prefix server test`. Auth tests require local Supabase and seeded users. The real-browser test is opt-in: from `server/`, run `STAGEHAND_BROWSER_TEST=1 node --import tsx --test test/stagehand-browser.test.ts`. It launches Chrome against temporary local fixtures, not a live vendor. Regular tests exercise HTTP authorization, strict bodies, mismatches, concurrency, durable replay, unknown outcomes, and confirmation ordering.

The real demo portal, its authentication flow, and bill-mcp's final amount convention remain unverified. The worker cannot independently prove the caller read a URL from the database; the shared secret authenticates that trust boundary. Keep portal configuration and state private, and do not expose these endpoints or browser session material to the client. No live payment has been attempted.

## Lessons

- 2026-11-17 · run 45eed97d: The ten live portals share the footer sign-in. A `#business` click fits only Copper Ridge and Prairie Grid, and three statement hosts still need a second hop onto the payment form.
- 2026-11-17 · run c6ad3fd0: Observation stopped on the homepage because every POST was blocked, including the portal's own sign-in.
- 2026-11-17 · run 4b09c0ff: The ten live demo portals share pay-screen selectors, and those selectors are not on the URL execute opens.
- 2026-11-15 · run e30488e3: Stagehand v4's browser handle needs an attached Stagehand client before page access; deterministic browser APIs do not require giving an LLM permission to pay.
- 2026-11-15 · run e30488e3: Persist an exclusive key claim and submission intent before clicking. An ambiguous outcome must remain blocked across process restarts.

## History

### 2026-11-17 · run 45eed97d-c6f9-45a8-9bd0-6a4ef64522b0 · Replace the vendor portal profile with one shared sign-in script that reaches the bill list on ever…

**Changed:** The shared portal profile now signs in from the footer link every live host renders, then opens the first pay or statement link.
**Learned:** One profile can reach the signed-in bill list on all ten live hosts. Brightwater, Northline, and Prairie Grid still stop on the statement page before sample details. Juniper's host is a 404.
**Decisive check:** Planned commands: node --run lint; node --run typecheck; node --run format:check. Final outcomes are not yet claimed; inspect run 45eed97d-c6f9-45a8-9bd0-6a4ef64522b0 command receipts separately. Local receipts may not travel with source.
**Files:** server/profiles.json@sha256:4236d961fba743db6ab3560420c84e6dfcdec652d1f251574d9ddaf5ca9461d2

### 2026-11-17 · run 4b09c0ff-5d88-4a6d-8b1c-c5b452bb9d88 · Add profiles for the ten live vendor portals

**Changed:** server/profiles.json lists vendors 1–10 with shared pay-screen selectors. Vendor 11 is omitted.
**Learned:** The selectors describe the pay screen. Execute opens the bare portal URL.
**Decisive check:** Planned commands: node --run lint; node --run typecheck; node --run format:check. Final outcomes are not yet claimed; inspect run 4b09c0ff-5d88-4a6d-8b1c-c5b452bb9d88 command receipts separately.
**Files:** server/profiles.json@sha256:566fb8d1fb82365cbfbc9647e65e15b8a7a4e2614edf1bbb7e42e4d19d9a609f

### 2026-11-15 · run e30488e3-524f-4d93-be44-fee5edeb4cbd · Implement authenticated Stagehand observe/execute worker endpoints with durable duplicate protection

**Changed:** Implement authenticated Stagehand observe/execute worker endpoints with durable duplicate protection
**Learned:** See the authored Current view; no user acceptance is inferred.
**Decisive check:** Planned commands: node --run lint; node --run typecheck; node --run format:check. Final outcomes are not yet claimed; inspect run e30488e3-524f-4d93-be44-fee5edeb4cbd command receipts separately. Local receipts may not travel with source.
**Files:** server/src/app.ts@sha256:a1d879f05240dd42699d95bd93fb6166fe2440b4331b8579ea895b757d20f335, server/src/payments/execution-store.ts@sha256:86a3625ea8a97597e367d654f4bc60f8d77dae0697067b1426143185272489af, server/src/payments/navigation-guard.ts@sha256:4ef614ae051a3692927fab41db778af7bc300c4fcc32414020c8ad680ad9d24c, server/src/payments/payment-contract.ts@sha256:1028d27b8cdb8217bba385725f590147fd771de21f5fec9e4ce43bc87233618a, server/src/payments/stagehand-browser.ts@sha256:8b844ad7ed2245c6049973f5d3f89e022e303c87eba462a78a04d00e350174a2, server/src/payments/worker-input.ts@sha256:f9fa9cc47ec1b99629da3b8caa9208742254f2be0107ee28f234c31a442ff692, server/src/payments/worker.ts@sha256:1fb5f7f5b38e0107e2802d46d96a84217c8f6ebd08f5e1c4f42cc6541381a9f2, server/src/routes/stagehand.routes.ts@sha256:3f06b3f7884070570aee253dd303b30763ecd83a22fea4fd18232c6faf07f304
