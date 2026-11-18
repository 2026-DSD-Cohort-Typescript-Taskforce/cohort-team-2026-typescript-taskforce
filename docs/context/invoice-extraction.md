# invoice extraction

Covers: supabase/functions/extract-invoices/index.ts, supabase/migrations/20261118170000_submit_bill_auto_approve.sql

Last changed by AI: 2026-11-18 · run 712a3774-ff10-4d6d-94db-b21ff575b308 · files: supabase/functions/extract-invoices/index.ts, supabase/migrations/20261118170000_submit_bill_auto_approve.sql

## Current view

A complete invoice extraction calls submit_bill with p_auto_approve true after the draft is saved. On the pending_payment branch that flag inserts one approvals row in the same transaction: submitted_by and approved_by are the signed-in caller, status is approved, time_approved is now, and the note is "Recorded by invoice extraction so the bill can be paid." execute_approved_payment already requires that newest status, so the bill can be autopaid. A submit that goes to pending_approval ignores the flag and still inserts only a pending row. Form submits omit the flag and still write no approvals row. Signed-in users cannot insert into approvals themselves. The database check is npx supabase test db supabase/tests/database/bills_submit.test.sql.

## Lessons

## History

### 2026-11-18 · run 712a3774-ff10-4d6d-94db-b21ff575b308 · When invoice extraction submits a complete bill straight to pending payment, record an approved app…

**Changed:** submit_bill records an approved approvals row when extraction asks, and extract-invoices passes that flag on a complete bill.
**Learned:** Autopay reads the newest approvals status, and a straight-through extraction submit previously wrote none.
**Decisive check:** Planned commands: node --run lint; node --run typecheck; node --run format:check. Final outcomes are not yet claimed; inspect run 712a3774-ff10-4d6d-94db-b21ff575b308 command receipts separately. Local receipts may not travel with source.
**Files:** supabase/functions/extract-invoices/index.ts@sha256:5eac01de34b23e4ac5643305114c59bc14e180247cbbc4e1b58d357e6015bf55, supabase/migrations/20261118170000_submit_bill_auto_approve.sql@sha256:1919fa855eb4515a36a4aeda37af6a590fe691c918955928d34a9a878496a7d1
