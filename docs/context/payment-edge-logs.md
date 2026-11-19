# Payment edge logs

Covers: supabase/functions/agent-bills/index.ts, supabase/functions/bill-mcp/handle.ts, supabase/functions/bill-mcp/index.ts

Last changed by AI: 2026-11-18 · run b308e613-bf1c-4665-a079-b7baf9b3bbc6 · files: supabase/functions/bill-mcp/handle.ts, supabase/functions/bill-mcp/index.ts

## Current view

A start failure is logged before /execute. After a charge, outcome_unknown and other worker failures are recorded and logged.

## Lessons

- 2026-11-18 · run 887b43da: Malformed tool arguments are returned as invalid tool arguments and are not sent to bill-mcp. JSON.parse no longer throws out of the request.
- 2026-11-16 · run 5f5079db: Edge function console.error is visible in the edge-runtime container, and a JSON error response alone does not show there.

## History

### 2026-11-18 · run b308e613-bf1c-4665-a079-b7baf9b3bbc6 · Make execute_approved_payment claim a payment attempt before charging, record the outcome with the…
**Changed:** execute_approved_payment now prepares, authorizes, and starts an attempt before /execute, then records the outcome with the live record_payment. A confirmed receipt uses the attempt idempotency key. canRecord is on only when the service client exists. The hour still asks the agent. The signed-in user must be allowed to authorize, and a missing portal reference falls back to the attempt key.
**Learned:** The charge waits for start_payment_submission. The receipt waits for a success row. The authorizing user must be a billing operator, financial approver, or system admin.
**Decisive check:** Planned commands: node --run lint; node --run typecheck; node --run format:check. Final outcomes are not yet claimed; inspect run b308e613-bf1c-4665-a079-b7baf9b3bbc6 command receipts separately. Local receipts may not travel with source.
**Files:** supabase/functions/bill-mcp/handle.ts@sha256:cae024a1ae6586b68b102fff6590cbf04465b3e94af184cbe95353409e0df297, supabase/functions/bill-mcp/index.ts@sha256:ce59ec08be5877bd781c967c0f68a2181d30d133a92936d89a215238a9e27fd8

### 2026-11-18 · run 111388b7-1ae4-4138-9875-04ae50872341 · Make the hourly bill-mcp sweep ask agent-bills to pay each pending bill, so the agent calls execute…

**Changed:** The hourly sweep now asks agent-bills to pay each pending bill. The agent is the caller of execute_approved_payment. canRecord stays false, so that call still does not charge. The model can skip the tool.
**Learned:** The hour lists bills and the agent pays them. canRecord and the model remain limits.
**Decisive check:** Planned commands: node --run lint; node --run typecheck; node --run format:check. Final outcomes are not yet claimed; inspect run 111388b7-1ae4-4138-9875-04ae50872341 command receipts separately. Local receipts may not travel with source.
**Files:** supabase/functions/bill-mcp/handle.ts@sha256:2127fca435fece23060c9f1ded6c71f67c5d85e0b53e0ae6de1f633379333dbb, supabase/functions/bill-mcp/index.ts@sha256:f07686ed6879252378ab253f398e564f7215e0dc682328d2499dc2584fade4b3

### 2026-11-18 · run 887b43da-df6b-47e8-b81c-2f122d4b161b · Stop malformed model tool arguments from crashing the agent-bills request.

**Changed:** Malformed tool arguments no longer throw out of callMcp. A SyntaxError returns invalid tool arguments and does not call bill-mcp. Valid JSON is still sent. Format still fails on two files this change does not edit.
**Learned:** agent-bills now returns invalid tool arguments instead of throwing, and that contract is in the payment edge logs.
**Decisive check:** Planned commands: node --run lint; node --run typecheck; node --run format:check. Final outcomes are not yet claimed; inspect run 887b43da-df6b-47e8-b81c-2f122d4b161b command receipts separately. Local receipts may not travel with source.
**Files:** supabase/functions/agent-bills/index.ts@sha256:12857573260a82cedc4c72adb5bff43909efcdfee0c6216ca90a003e2270b8a1

### 2026-11-17 · run 4fc2914b-887d-43f6-b388-3bc7f447ca6f · Make execute_approved_payment confirm the amount and invoice from the portal page instead of caller…

**Changed:** execute_approved_payment now confirms the invoice and amount from the portal page. A call with only bill_id pays when that page shows them.
**Learned:** The snapshot doc now says the portal page supplies the amount and invoice.
**Decisive check:** Planned commands: node --run lint; node --run typecheck; node --run format:check. Final outcomes are not yet claimed; inspect run 4fc2914b-887d-43f6-b388-3bc7f447ca6f command receipts separately. Local receipts may not travel with source.
**Files:** supabase/functions/bill-mcp/handle.ts@sha256:25ea6f216c2ed39eb32e8c02ba88236b658cce24ba57ef5c0d127a78efc704c0, supabase/functions/agent-bills/index.ts@sha256:16860267bac36003e0a741cd0556e5625ed46fb267ab8843530fbd07f7813e08, supabase/functions/bill-mcp/index.ts@sha256:325a35887dcf2146bc856773ff29ba92f09b7a43e4d6e25b37029d4685359908

### 2026-11-17 · run e2f144f0-7d99-4efa-85f8-99b177fe359c · Stop a matching payment from returning snapshot_mismatch when the tool uses camelCase field names,…

**Changed:** execute_approved_payment now accepts snake_case or camelCase snapshot names and returns the field that differs. Project typecheck and format were already failing outside this change.
**Learned:** Both owner docs now say the snapshot accepts either field-name style and the mismatch body names the field.
**Decisive check:** Planned commands: node --run lint; node --run typecheck; node --run format:check. Final outcomes are not yet claimed; inspect run e2f144f0-7d99-4efa-85f8-99b177fe359c command receipts separately. Local receipts may not travel with source.
**Files:** supabase/functions/bill-mcp/handle.ts@sha256:6e4111de0cf23d7ce2c495a4083973c0d59cc2da3e89848762e19bb23f70b8f5, supabase/functions/agent-bills/index.ts@sha256:16860267bac36003e0a741cd0556e5625ed46fb267ab8843530fbd07f7813e08, supabase/functions/bill-mcp/index.ts@sha256:325a35887dcf2146bc856773ff29ba92f09b7a43e4d6e25b37029d4685359908

### 2026-11-17 · run 5f5079db-36a1-44e6-aab3-8147a6ddcf1d · Log agent-bills and bill-mcp failures to the edge-runtime terminal, including missing env names, wi…

**Changed:** agent-bills and bill-mcp now print failure reasons with console.error. Secrets are not logged. The lines appear in the edge-runtime container.
**Learned:** Failure logs belong in the edge-runtime container. The npm run dev window does not show them.
**Decisive check:** Planned commands: node --run lint; node --run typecheck; node --run format:check. Final outcomes are not yet claimed; inspect run 5f5079db-36a1-44e6-aab3-8147a6ddcf1d command receipts separately. Local receipts may not travel with source.
**Files:** supabase/functions/agent-bills/index.ts@sha256:16860267bac36003e0a741cd0556e5625ed46fb267ab8843530fbd07f7813e08, supabase/functions/bill-mcp/handle.ts@sha256:33882fe3d249ee395ec8c289f8224595011984a93664ae93f80719e5768f5fac, supabase/functions/bill-mcp/index.ts@sha256:6740a09ca0e985bd48ca3569e9d12392cf5e61896c6f4ac76281aabf41ea1f89
