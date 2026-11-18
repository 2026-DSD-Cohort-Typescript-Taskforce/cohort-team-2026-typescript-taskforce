# Payment confirmation receipts

Covers: `server/src/payments`, `supabase/functions/bill-mcp`, `supabase/migrations/20261117190000_payment_receipts.sql`, `client/app/api/bills/[id]/payments/[paymentId]/receipt/route.ts`

Last changed by AI: 2026-11-17 · run cf5b5baf-d7bd-4196-ab52-cc8c0d8f1253 · files: client/app/api/bills/[id]/payments/[paymentId]/receipt/route.ts, server/src/payments/capture-receipt.ts, server/src/payments/execution-store.ts, server/src/payments/payment-contract.ts, server/src/payments/stagehand-browser.ts, server/src/payments/worker.ts, supabase/functions/bill-mcp/handle.test.ts, supabase/functions/bill-mcp/handle.ts, supabase/functions/bill-mcp/index.ts, supabase/functions/bill-mcp/receipt.test.ts, supabase/functions/bill-mcp/receipt.ts, supabase/migrations/20261117190000_payment_receipts.sql

## Current view

DC-112 builds on the merged testing branch. After verified payment confirmation,
the worker durably records success, captures receipt evidence before closing Chrome,
and caches it in the existing private execution journal. Capture or cache failure
cannot reverse success or permit another charge.

Operator profiles opt in with `receiptSelector` containing all four confirmation
selectors. The capture sanitizes a copy of that receipt, retaining only the verified
invoice, amount, reference and a fixed confirmation heading. Other text, attributes,
inputs and images are removed, then rendered in an isolated blank tab so portal
scripts, styles or dialogs cannot overlay the capture. PNGs are limited to 2 MB. This is sanitized evidence,
not a full-page screenshot or independent proof that money moved.

bill-mcp records payment first, then validates the artifact identity, PNG signature,
size and SHA-256. It uploads without overwrite to private bucket `payment-receipts`
at `payments/<payment_id>/receipt.png`. Existing bytes must match on retry. The
service-only `set_payment_receipt` RPC binds the path to the successful payment,
bill and execution key. Artifact bytes and credentials are never sent to the model.

`receipt_status`/`receipt_error` track evidence separately from payment status.
`retry_payment_receipt` accepts `bill_id` and `payment_id`; it retrieves the cached
artifact through authenticated worker POST `/receipt` and uploads only. It does not
call execute, record_payment or open Chrome. This tool is available through bill-mcp;
the current agent allowlist does not automatically expose it.

Direct anonymous/authenticated payment writes are revoked; controlled backend RPCs
own payment identity and receipt metadata. The shared database access helper permits the bill owner, financial approvers and
system admins to read evidence or retry uploads. Other operators, missing profiles
and anonymous callers are denied. GET `/api/bills/<billId>/payments/<paymentId>/receipt`
returns a five-minute signed image URL using the caller's session and storage policy.

Apply the receipt migration and deploy the updated worker/bill-mcp together. No new
secret or browser package is required. The service role remains in bill-mcp only.
Old journal records or failed/lost captures may have no recoverable image; never retry
payment to obtain one. An orphan upload remains private until its path is associated.
Retention/cleanup and automatic retry scheduling are separate work.

## Lessons

- 2026-11-17 · run cf5b5baf: Persist confirmed state before optional evidence work; upload-only recovery reads the saved execution key.
- 2026-11-17 · run cf5b5baf: One authorization helper governs image access, metadata and retry lookup; revoke legacy direct payment writes first.
- 2026-11-17 · run cf5b5baf: Verify existing-object hashes and isolate screenshot rendering from portal scripts and overlays.

## History

### 2026-11-17 · run cf5b5baf-d7bd-4196-ab52-cc8c0d8f1253 · DC112 capture sanitized payment receipts, store privately and retry evidence without payment

**Changed:** DC112 capture sanitized payment receipts, store privately and retry evidence without payment
**Learned:** See the authored Current view; no user acceptance is inferred.
**Decisive check:** Planned commands: node --run lint; node --run typecheck; node --run format:check. Final outcomes are not yet claimed; inspect run cf5b5baf-d7bd-4196-ab52-cc8c0d8f1253 command receipts separately. Local receipts may not travel with source.
**Files:** client/app/api/bills/[id]/payments/[paymentId]/receipt/route.ts@sha256:6a9ec6560a0e9cbfcead3ed724fdc1f7c185c01b2a167e07d10e1a9f4d5fcc54, server/src/payments/capture-receipt.ts@sha256:35672a700880e887ff7054c0c97b28b62d185c43b7dea406f6d4f2482cc9731f, server/src/payments/execution-store.ts@sha256:2dd6ed17f2bde91e863f0007acb70a979c46b44bf90a38a601cb7bed5ccf68f4, server/src/payments/payment-contract.ts@sha256:2dd3df33c1eb8296c5ba56dc646d4504475f6059d4fc76a591cc4669ff5c1bc9, server/src/payments/stagehand-browser.ts@sha256:7e0cbdc3cb36ce328d0cb4d1bb49bb39ce6ab09cda7a494d90c21ed4f49c7b43, server/src/payments/worker.ts@sha256:34d15c71ad3d03feada2b88c2c389978ca133d631eb3f13a45d25aa665511afa, supabase/functions/bill-mcp/handle.test.ts@sha256:75d87065cbb2ec7941b73de98b862cd13cdc9a75d17c9927d826f0e1fe935b5a, supabase/functions/bill-mcp/handle.ts@sha256:de144c2d39821eb9d87d750897830f749435cda790140198f262407b520c3bf2, supabase/functions/bill-mcp/index.ts@sha256:97fba2b12341eef9c1882dd56f9b79f6b518b9913ad8e41752c19ec5286ec30e, supabase/functions/bill-mcp/receipt.test.ts@sha256:ebddf8423f11293da5b315f3242ce4c39915acf8294c53d1db3ebc40a02e9c4f, supabase/functions/bill-mcp/receipt.ts@sha256:da137874f2ada2a85d88065918bd767efc31188582a3b976a88ddf835fdebac1, supabase/migrations/20261117190000_payment_receipts.sql@sha256:1dffb8fd5befe04ac2fe0bf08f51e395d41b09a98f3919e646aab30eb6afb80d
