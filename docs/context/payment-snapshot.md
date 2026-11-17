# Payment snapshot

Covers: supabase/functions/bill-mcp/handle.ts

Last changed by AI: 2026-11-17 · run 4fc2914b-887d-43f6-b388-3bc7f447ca6f · files: supabase/functions/bill-mcp/handle.ts

## Current view

execute_approved_payment loads the bill, opens that vendor's portal URL, and reads the page text. The amount matches when the page shows the bill amount in dollars, such as $40.50. The invoice matches when the page shows the bill's invoice number. A miss returns snapshot_mismatch with fields naming amount or invoice_number, and does not call execute. The vendor comes from the portal URL lookup. A missing idempotency key becomes portal- plus the bill id. Status and the newest approval stay separate checks.

## Lessons

- 2026-11-17 · run 4fc2914b: The snapshot is the portal page text, so a call with only bill_id can pay when that page shows the invoice and amount.
- 2026-11-17 · run e2f144f0: The snapshot check read only snake_case names, so vendorId and invoiceNumber failed even when the values were the bill's values.
- 2026-11-17 · run 92fa34c4: Strict equality on vendor_id rejected a digits-only string of the same vendor, so a tool call that copied the bill as JSON text failed the snapshot.

## History

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
