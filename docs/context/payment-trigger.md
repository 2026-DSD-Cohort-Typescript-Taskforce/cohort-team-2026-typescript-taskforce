# Manual payment trigger

Covers: `client/app/(app)/bills/[id]`, `client/app/api/bills/[id]/payment-trigger`, `client/lib/payment-trigger.ts`, `client/lib/payment-trigger-service.ts`

Last changed by AI: 2026-11-18 · run 8e2f0a10-c094-4a12-8e67-3009feaa3b32 · files: client/app/(app)/bills/[id]/bill-details.tsx, client/app/(app)/bills/[id]/payment-automation-trigger.tsx, client/app/api/bills/[id]/payment-trigger/route.ts, client/lib/payment-trigger-service.ts, client/lib/payment-trigger.ts

## Current view

The bill detail page shows a reusable payment trigger only to system administrators. It is a manual test entry point for the existing automated payment flow, not a second payment implementation.

The component's confirm dialog lists every value bill-mcp will authorize: vendor, invoice number, payment method, amount, fees ($0.00), total, currency (USD) and payment date (the admin's local date when the dialog opens). `POST /api/bills/[id]/payment-trigger` independently validates the signed-in user's database role, then forwards those confirmed values (vendor ID, invoice number, payment method ID, amount, fees, currency, payment date; validated first, else 400 `invalid_request`) with the bill ID to bill-mcp's `execute_approved_payment` tool. `BILL_MCP_URL` and `BILL_MCP_TOKEN` stay server-only, while the caller's JWT is forwarded for the existing bill read.

bill-mcp prepares the payment, authorizes it as the admin and claims a DC-89 payment attempt; it is also responsible for snapshot, portal, idempotency, payment recording and receipt safeguards. The trigger works for bills in `pending_payment` or `payment_failed`, and only when vendor, invoice, payment method and amount are all present.

Outcome mapping (never forwards upstream text or rows on failure): `outcome_unknown`, `record_payment failed`, `payment_in_progress` are uncertain (409, do not retry); `payment_failed` is 502 and the bill is marked payment failed; `not_payable`, `snapshot_mismatch`, `no portal url`, `already_paid` are ineligible (409); `summary_mismatch`, `summary_stale`, `invalid_payment` mean the bill or the date changed (409, reload); `authorization_expired`, `not_authorized` mean the payment did not start (409, try again); `forbidden` is 403; `worker not configured` is 503; anything else is a generic 502. A lost response, a bill-mcp 5xx (it answers 200 for every tool result, so a 5xx means it crashed or was stopped) or a payment-recording failure is uncertain because the portal may already have submitted payment; it must not be retried. Other non-2xx replies, such as a 401, are 502 `payment_service_unavailable`. Success requires a `success` payment row for the requested bill.

`PaymentAutomationTrigger` owns role visibility, confirmation, request state and result messaging. Another page can mount it later without duplicating the payment call.

## Lessons

- 2026-11-18 · run 8e2f0a10: Treat any lost post-dispatch response or database-recording failure as uncertain, and bind success to the requested bill's successful payment row.

## History

### 2026-11-18 · run 8e2f0a10-c094-4a12-8e67-3009feaa3b32 · Add a reusable system-admin-only manual payment trigger to each bill detail page, backed by bill-mc…

**Changed:** Added a reusable system-admin-only manual payment trigger to bill details. The server independently authorizes the caller and invokes the existing bill-mcp payment path. Tests, lint, typecheck, and a webpack production build passed; two unrelated pre-existing format warnings remain.
**Learned:** Recorded the authorization, bill-mcp boundary, uncertain-outcome, and reuse contracts.
**Decisive check:** Planned commands: node --run lint; node --run typecheck; node --run format:check. Final outcomes are not yet claimed; inspect run 8e2f0a10-c094-4a12-8e67-3009feaa3b32 command receipts separately. Local receipts may not travel with source.
**Files:** client/app/(app)/bills/[id]/bill-details.tsx@sha256:f28c61f4119fa0cf59b0a26e6652914157881bd304b7c3ff66d02e820b3872fe, client/app/(app)/bills/[id]/payment-automation-trigger.tsx@sha256:78165d77cb29bc28c72136ac202c658a082072bdd5391a253114bb28cdb1f690, client/app/api/bills/[id]/payment-trigger/route.ts@sha256:9400f87f83a6b19131c4dbc397c38be6c5bcd12ae91652b11dcaf52d8669804e, client/lib/payment-trigger-service.ts@sha256:7a4e8a260017a0521fef3598d4900b475adc9b168a4f6e0136d7b52e35faac10, client/lib/payment-trigger.ts@sha256:e7ea31959564505353fa72a83874d2a3e5b7d46eccc3ef791327d5a5b7397efc

## Policy outcomes (DC-92)

bill-mcp checks the vendor's policy with `evaluate_bill_policy` after the bill loads and the status check, before any portal read, on both the admin trigger and the hourly sweep. A `block` returns `policy_blocked`; `require_approval` calls `send_bill_for_approval` and returns `sent_for_approval` (if the database answers `approval_not_required`, the payment continues and `prepare_payment` decides). `prepare_payment` and `start_payment_submission` enforce the same rules: their `policy_blocked` and `approval_required` refusals pass through or send the bill back, and a claim refused with `policy_changed` cancels the attempt. Each reply carries the evaluator's `policy`. The trigger route maps `policy_blocked` and `sent_for_approval` to `ineligible` and `policy_changed` to `failed` ("This vendor's policy changed. Trigger the payment again."), and the bill page reloads after every answer.
