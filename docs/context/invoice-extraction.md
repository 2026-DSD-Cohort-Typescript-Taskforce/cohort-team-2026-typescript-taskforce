# invoice extraction

Covers: supabase/functions/extract-invoices/index.ts

Last changed by AI: 2026-11-18 · run 712a3774-ff10-4d6d-94db-b21ff575b308 · files: supabase/functions/extract-invoices/index.ts, supabase/migrations/20261118170000_submit_bill_auto_approve.sql

## Current view

A complete invoice extraction saves the draft and submits it with `p_needs_approval: true`. The normal approval workflow creates the pending approval; extraction never records the uploader as an approver. Automated payment remains unavailable until a real approval is the newest decision.

## Lessons

## History

### 2026-11-18 · run 712a3774-ff10-4d6d-94db-b21ff575b308 · When invoice extraction submits a complete bill straight to pending payment, record an approved app…

**Changed:** submit_bill records an approved approvals row when extraction asks, and extract-invoices passes that flag on a complete bill.
**Learned:** Autopay reads the newest approvals status, and a straight-through extraction submit previously wrote none.
**Decisive check:** Planned commands: node --run lint; node --run typecheck; node --run format:check. Final outcomes are not yet claimed; inspect run 712a3774-ff10-4d6d-94db-b21ff575b308 command receipts separately. Local receipts may not travel with source.
**Files:** supabase/functions/extract-invoices/index.ts@sha256:5eac01de34b23e4ac5643305114c59bc14e180247cbbc4e1b58d357e6015bf55, supabase/migrations/20261118170000_submit_bill_auto_approve.sql@sha256:1919fa855eb4515a36a4aeda37af6a590fe691c918955928d34a9a878496a7d1
