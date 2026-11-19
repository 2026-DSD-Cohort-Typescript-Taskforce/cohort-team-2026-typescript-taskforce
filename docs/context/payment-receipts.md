# Payment confirmation receipts

Covers: `server/src/payments`, `supabase/functions/bill-mcp`, `supabase/migrations/20261117190000_payment_receipts.sql`, `client/app/api/bills/[id]/payments/[paymentId]/receipt/route.ts`

Last changed by AI: 2026-11-18 · run b308e613-bf1c-4665-a079-b7baf9b3bbc6 · files: supabase/functions/bill-mcp/handle.test.ts, supabase/functions/bill-mcp/handle.ts, supabase/functions/bill-mcp/index.ts

## Current view

A confirmed receipt is stored at payments/<payment id>/receipt.png after record_payment returns success. The worker and the receipt use the attempt idempotency key.

## Lessons

- 2026-11-17 · run cf5b5baf: Persist confirmed state before optional evidence work; upload-only recovery reads the saved execution key.
- 2026-11-17 · run cf5b5baf: One authorization helper governs image access, metadata and retry lookup; revoke legacy direct payment writes first.
- 2026-11-17 · run cf5b5baf: Verify existing-object hashes and isolate screenshot rendering from portal scripts and overlays.

## History

### 2026-11-18 · run b308e613-bf1c-4665-a079-b7baf9b3bbc6 · Make execute_approved_payment claim a payment attempt before charging, record the outcome with the…
**Changed:** execute_approved_payment now prepares, authorizes, and starts an attempt before /execute, then records the outcome with the live record_payment. A confirmed receipt uses the attempt idempotency key. canRecord is on only when the service client exists. The hour still asks the agent. The signed-in user must be allowed to authorize, and a missing portal reference falls back to the attempt key.
**Learned:** The charge waits for start_payment_submission. The receipt waits for a success row. The authorizing user must be a billing operator, financial approver, or system admin.
**Decisive check:** Planned commands: node --run lint; node --run typecheck; node --run format:check. Final outcomes are not yet claimed; inspect run b308e613-bf1c-4665-a079-b7baf9b3bbc6 command receipts separately. Local receipts may not travel with source.
**Files:** supabase/functions/bill-mcp/handle.test.ts@sha256:d5d27ab2558f1a2d5c96d12d768c65c41cbd8ccd2c2213c9f46a28f37a4c9ba4, supabase/functions/bill-mcp/handle.ts@sha256:cae024a1ae6586b68b102fff6590cbf04465b3e94af184cbe95353409e0df297, supabase/functions/bill-mcp/index.ts@sha256:ce59ec08be5877bd781c967c0f68a2181d30d133a92936d89a215238a9e27fd8

### 2026-11-18 · run 111388b7-1ae4-4138-9875-04ae50872341 · Make the hourly bill-mcp sweep ask agent-bills to pay each pending bill, so the agent calls execute…

**Changed:** The hourly sweep now asks agent-bills to pay each pending bill. The agent is the caller of execute_approved_payment. canRecord stays false, so that call still does not charge. The model can skip the tool.
**Learned:** The hour lists bills and the agent pays them. canRecord and the model remain limits.
**Decisive check:** Planned commands: node --run lint; node --run typecheck; node --run format:check. Final outcomes are not yet claimed; inspect run 111388b7-1ae4-4138-9875-04ae50872341 command receipts separately. Local receipts may not travel with source.
**Files:** supabase/functions/bill-mcp/handle.test.ts@sha256:e4737870380c3161a0bdabe79a284560aa41ed883d76f409617c7deb2f0aada9, supabase/functions/bill-mcp/handle.ts@sha256:2127fca435fece23060c9f1ded6c71f67c5d85e0b53e0ae6de1f633379333dbb, supabase/functions/bill-mcp/index.ts@sha256:f07686ed6879252378ab253f398e564f7215e0dc682328d2499dc2584fade4b3

### 2026-11-17 · run cf5b5baf-d7bd-4196-ab52-cc8c0d8f1253 · DC112 capture sanitized payment receipts, store privately and retry evidence without payment

**Changed:** DC112 capture sanitized payment receipts, store privately and retry evidence without payment
**Learned:** See the authored Current view; no user acceptance is inferred.
**Decisive check:** Planned commands: node --run lint; node --run typecheck; node --run format:check. Final outcomes are not yet claimed; inspect run cf5b5baf-d7bd-4196-ab52-cc8c0d8f1253 command receipts separately. Local receipts may not travel with source.
**Files:** client/app/api/bills/[id]/payments/[paymentId]/receipt/route.ts@sha256:6a9ec6560a0e9cbfcead3ed724fdc1f7c185c01b2a167e07d10e1a9f4d5fcc54, server/src/payments/capture-receipt.ts@sha256:35672a700880e887ff7054c0c97b28b62d185c43b7dea406f6d4f2482cc9731f, server/src/payments/execution-store.ts@sha256:2dd6ed17f2bde91e863f0007acb70a979c46b44bf90a38a601cb7bed5ccf68f4, server/src/payments/payment-contract.ts@sha256:2dd3df33c1eb8296c5ba56dc646d4504475f6059d4fc76a591cc4669ff5c1bc9, server/src/payments/stagehand-browser.ts@sha256:7e0cbdc3cb36ce328d0cb4d1bb49bb39ce6ab09cda7a494d90c21ed4f49c7b43, server/src/payments/worker.ts@sha256:34d15c71ad3d03feada2b88c2c389978ca133d631eb3f13a45d25aa665511afa, supabase/functions/bill-mcp/handle.test.ts@sha256:75d87065cbb2ec7941b73de98b862cd13cdc9a75d17c9927d826f0e1fe935b5a, supabase/functions/bill-mcp/handle.ts@sha256:de144c2d39821eb9d87d750897830f749435cda790140198f262407b520c3bf2, supabase/functions/bill-mcp/index.ts@sha256:97fba2b12341eef9c1882dd56f9b79f6b518b9913ad8e41752c19ec5286ec30e, supabase/functions/bill-mcp/receipt.test.ts@sha256:ebddf8423f11293da5b315f3242ce4c39915acf8294c53d1db3ebc40a02e9c4f, supabase/functions/bill-mcp/receipt.ts@sha256:da137874f2ada2a85d88065918bd767efc31188582a3b976a88ddf835fdebac1, supabase/migrations/20261117190000_payment_receipts.sql@sha256:1dffb8fd5befe04ac2fe0bf08f51e395d41b09a98f3919e646aab30eb6afb80d
