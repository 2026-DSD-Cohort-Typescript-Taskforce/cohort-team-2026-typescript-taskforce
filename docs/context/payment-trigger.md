# Manual payment trigger

Covers: `client/app/(app)/bills/[id]`, `client/app/api/bills/[id]/payment-trigger`, `client/lib/payment-trigger.ts`, `client/lib/payment-trigger-service.ts`

Last changed by AI: 2026-11-18 · run 8e2f0a10-c094-4a12-8e67-3009feaa3b32 · files: client/app/(app)/bills/[id]/bill-details.tsx, client/app/(app)/bills/[id]/payment-automation-trigger.tsx, client/app/api/bills/[id]/payment-trigger/route.ts, client/lib/payment-trigger-service.ts, client/lib/payment-trigger.ts

## Current view

The bill detail page shows a reusable payment trigger only to system administrators. It is a manual test entry point for the existing automated payment flow, not a second payment implementation.

The component confirms the vendor, invoice number and amount. `POST /api/bills/[id]/payment-trigger` independently validates the signed-in user's database role, then calls bill-mcp's `execute_approved_payment` tool with only the bill ID. `BILL_MCP_URL` and `BILL_MCP_TOKEN` stay server-only, while the caller's JWT is forwarded for the existing bill read.

An ineligible result names the stop: the bill is not pending payment, the newest approval is not approved, the vendor has no portal URL, or the signed-in portal page does not show the invoice number or the amount. bill-mcp remains responsible for approval, snapshot, portal, idempotency, payment recording and receipt safeguards. A lost response or payment-recording failure is uncertain because the portal may already have submitted payment; it must not be retried. Success requires a `success` payment row for the requested bill.

`PaymentAutomationTrigger` owns role visibility, confirmation, request state and result messaging. Another page can mount it later without duplicating the payment call.

## Lessons

- 2026-11-18 · run 8e2f0a10: Treat any lost post-dispatch response or database-recording failure as uncertain, and bind success to the requested bill's successful payment row.

## History

### 2026-11-18 · run 8e2f0a10-c094-4a12-8e67-3009feaa3b32 · Add a reusable system-admin-only manual payment trigger to each bill detail page, backed by bill-mc…

**Changed:** Added a reusable system-admin-only manual payment trigger to bill details. The server independently authorizes the caller and invokes the existing bill-mcp payment path. Tests, lint, typecheck, and a webpack production build passed; two unrelated pre-existing format warnings remain.
**Learned:** Recorded the authorization, bill-mcp boundary, uncertain-outcome, and reuse contracts.
**Decisive check:** Planned commands: node --run lint; node --run typecheck; node --run format:check. Final outcomes are not yet claimed; inspect run 8e2f0a10-c094-4a12-8e67-3009feaa3b32 command receipts separately. Local receipts may not travel with source.
**Files:** client/app/(app)/bills/[id]/bill-details.tsx@sha256:f28c61f4119fa0cf59b0a26e6652914157881bd304b7c3ff66d02e820b3872fe, client/app/(app)/bills/[id]/payment-automation-trigger.tsx@sha256:78165d77cb29bc28c72136ac202c658a082072bdd5391a253114bb28cdb1f690, client/app/api/bills/[id]/payment-trigger/route.ts@sha256:9400f87f83a6b19131c4dbc397c38be6c5bcd12ae91652b11dcaf52d8669804e, client/lib/payment-trigger-service.ts@sha256:7a4e8a260017a0521fef3598d4900b475adc9b168a4f6e0136d7b52e35faac10, client/lib/payment-trigger.ts@sha256:e7ea31959564505353fa72a83874d2a3e5b7d46eccc3ef791327d5a5b7397efc
