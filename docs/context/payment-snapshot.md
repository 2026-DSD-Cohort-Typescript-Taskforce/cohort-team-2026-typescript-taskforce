# Payment snapshot

Covers: supabase/functions/bill-mcp/handle.ts

Last changed by AI: 2026-11-18 · run 92a5b424-2f02-45aa-b88c-67bb21a2e6bb · files: supabase/functions/bill-mcp/handle.ts

## Current view

execute_approved_payment needs the bill id plus the full payment summary the admin was shown: vendor, invoice number, payment method, amount, fees, currency and payment date (YYYY-MM-DD); a missing or malformed one is invalid arguments. The bill must be pending_payment or payment_failed, else not_payable. The shown vendor, invoice, payment method and amount must equal the bill, amount compared in cents, else summary_mismatch with fields naming vendor_id, invoice_number, payment_method_id or amount. bill-mcp then opens the vendor's portal URL and reads the page text. The amount matches when the page shows it in dollars, such as $40.50, and the invoice when the page shows the invoice number. A miss returns snapshot_mismatch and does not call execute. Next it prepares a DC-89 attempt with prepare_payment for the shown payment date and no fees. Every summary key of the prepared attempt must equal the shown one (account reference null, total = amount + fees), else it is cancelled with summary_mismatch naming the keys (amount, fees and total by those names). It then authorizes exactly the shown summary as the signed-in caller with authorize_payment, and claims it with start_payment_submission. Only a claimed attempt reaches /execute, with that attempt's own idempotency_key; a caller-supplied key is ignored. record_payment stores the worker's result: confirmed with a 1–255 character transaction reference is success, payment_mismatch and portal_error are failures, invalid_request, unauthorized and idempotency_conflict are failure not_submitted, and anything else, including no reply in time, is unknown. Each call has 125 s from its start: /observe gets at most 30 s of it (a timeout or throw is worker failed), prepare_payment is not called with less than 70 s left (payment_not_started), and /execute waits at most 100 s or the time left. A record_payment error with no code (a lost reply) is tried twice more, after 250 ms and 1 s, while time is left; a coded refusal is not retried. There is no approvals check.

## Lessons

- 2026-11-18 · run 92a5b424: The idempotency key is the bill id, so a caller-supplied key cannot start a second payment. `outcome_unknown` is returned to the caller. Superseded by DC-126: the key is the DC-89 attempt's own idempotency_key.
- 2026-11-17 · run 4fc2914b: The snapshot is the portal page text, so a call with only bill_id can pay when that page shows the invoice and amount. Superseded by DC-126: bill_id alone is invalid arguments; the shown vendor, invoice and amount must also equal the bill.
- 2026-11-17 · run e2f144f0: The snapshot check read only snake_case names, so vendorId and invoiceNumber failed even when the values were the bill's values.
- 2026-11-17 · run 92fa34c4: Strict equality on vendor_id rejected a digits-only string of the same vendor, so a tool call that copied the bill as JSON text failed the snapshot.

## History

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
