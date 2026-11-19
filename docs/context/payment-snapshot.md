# Payment snapshot

Covers: supabase/functions/bill-mcp/handle.ts

Last changed by AI: 2026-11-18 · run b308e613-bf1c-4665-a079-b7baf9b3bbc6 · files: supabase/functions/bill-mcp/handle.ts

## Current view

The snapshot check still runs before any payment attempt is prepared. A mismatch does not charge.

## Lessons

- 2026-11-18 · run 92a5b424: The idempotency key is the bill id, so a caller-supplied key cannot start a second payment. `outcome_unknown` is returned to the caller.
- 2026-11-17 · run 4fc2914b: The snapshot is the portal page text, so a call with only bill_id can pay when that page shows the invoice and amount.
- 2026-11-17 · run e2f144f0: The snapshot check read only snake_case names, so vendorId and invoiceNumber failed even when the values were the bill's values.
- 2026-11-17 · run 92fa34c4: Strict equality on vendor_id rejected a digits-only string of the same vendor, so a tool call that copied the bill as JSON text failed the snapshot.

## History

### 2026-11-18 · run b308e613-bf1c-4665-a079-b7baf9b3bbc6 · Make execute_approved_payment claim a payment attempt before charging, record the outcome with the…
**Changed:** execute_approved_payment now prepares, authorizes, and starts an attempt before /execute, then records the outcome with the live record_payment. A confirmed receipt uses the attempt idempotency key. canRecord is on only when the service client exists. The hour still asks the agent. The signed-in user must be allowed to authorize, and a missing portal reference falls back to the attempt key.
**Learned:** The charge waits for start_payment_submission. The receipt waits for a success row. The authorizing user must be a billing operator, financial approver, or system admin.
**Decisive check:** Planned commands: node --run lint; node --run typecheck; node --run format:check. Final outcomes are not yet claimed; inspect run b308e613-bf1c-4665-a079-b7baf9b3bbc6 command receipts separately. Local receipts may not travel with source.
**Files:** supabase/functions/bill-mcp/handle.ts@sha256:cae024a1ae6586b68b102fff6590cbf04465b3e94af184cbe95353409e0df297

### 2026-11-18 · run 111388b7-1ae4-4138-9875-04ae50872341 · Make the hourly bill-mcp sweep ask agent-bills to pay each pending bill, so the agent calls execute…

**Changed:** The hourly sweep now asks agent-bills to pay each pending bill. The agent is the caller of execute_approved_payment. canRecord stays false, so that call still does not charge. The model can skip the tool.
**Learned:** The hour lists bills and the agent pays them. canRecord and the model remain limits.
**Decisive check:** Planned commands: node --run lint; node --run typecheck; node --run format:check. Final outcomes are not yet claimed; inspect run 111388b7-1ae4-4138-9875-04ae50872341 command receipts separately. Local receipts may not travel with source.
**Files:** supabase/functions/bill-mcp/handle.ts@sha256:2127fca435fece23060c9f1ded6c71f67c5d85e0b53e0ae6de1f633379333dbb

### 2026-11-18 · run 92a5b424-2f02-45aa-b88c-67bb21a2e6bb · Pin execute_approved_payment to portal-${bill.bill_id} and return outcome_unknown from the worker.

**Changed:** execute_approved_payment now always uses portal- plus the bill id and returns outcome_unknown when the worker says so. Other worker failures stay worker failed. The handler tests passed outside the CommonJS package root because node --test cannot load the TypeScript file from the repo.
**Learned:** The payment snapshot now says the key is always portal- plus the bill id and outcome_unknown is returned.
**Decisive check:** Planned commands: node --run lint; node --run typecheck; node --run format:check. Final outcomes are not yet claimed; inspect run 92a5b424-2f02-45aa-b88c-67bb21a2e6bb command receipts separately. Local receipts may not travel with source.
**Files:** supabase/functions/bill-mcp/handle.ts@sha256:06ea914ab4f2396527eac660f42109d9556629c5bb84d76f087f9f2e48048a90

### 2026-11-17 · run 4fc2914b-887d-43f6-b388-3bc7f447ca6f · Make execute_approved_payment confirm the amount and invoice from the portal page instead of caller…

**Changed:** execute_approved_payment now confirms the invoice and amount from the portal page. A call with only bill_id pays when that page shows them.
**Learned:** The snapshot doc now says the portal page supplies the amount and invoice.
**Decisive check:** Planned commands: node --run lint; node --run typecheck; node --run format:check. Final outcomes are not yet claimed; inspect run 4fc2914b-887d-43f6-b388-3bc7f447ca6f command receipts separately. Local receipts may not travel with source.
**Files:** supabase/functions/bill-mcp/handle.ts@sha256:25ea6f216c2ed39eb32e8c02ba88236b658cce24ba57ef5c0d127a78efc704c0

### 2026-11-17 · run e2f144f0-7d99-4efa-85f8-99b177fe359c · Stop a matching payment from returning snapshot_mismatch when the tool uses camelCase field names,…

**Changed:** execute_approved_payment now accepts snake_case or camelCase snapshot names and returns the field that differs. Project typecheck and format were already failing outside this change.
**Learned:** Both owner docs now say the snapshot accepts either field-name style and the mismatch body names the field.
**Decisive check:** Planned commands: node --run lint; node --run typecheck; node --run format:check. Final outcomes are not yet claimed; inspect run e2f144f0-7d99-4efa-85f8-99b177fe359c command receipts separately. Local receipts may not travel with source.
**Files:** supabase/functions/bill-mcp/handle.ts@sha256:6e4111de0cf23d7ce2c495a4083973c0d59cc2da3e89848762e19bb23f70b8f5

### 2026-11-17 · run 92fa34c4-46e8-4acf-a50a-3bc22d2a1188 · Make execute_approved_payment treat numeric strings as the same bill snapshot, and test every snaps…

**Changed:** A digits-only vendor id now matches the bill's numeric vendor id. Amount still uses Number. Invoice equality stays strict. Handler tests cover the string snapshot and vendor, invoice, and blank-key mismatches. Project typecheck and format were already failing outside this change.
**Learned:** The snapshot contract is recorded, including which fields coerce and which stay strict.
**Decisive check:** Planned commands: node --run lint; node --run typecheck; node --run format:check. Final outcomes are not yet claimed; inspect run 92fa34c4-46e8-4acf-a50a-3bc22d2a1188 command receipts separately. Local receipts may not travel with source.
**Files:** supabase/functions/bill-mcp/handle.ts@sha256:c10dfe839fd1ceb8aad3a57ab5d6d94ad8fa8e2cdc923fa70c8c7e00cb9eda5d
