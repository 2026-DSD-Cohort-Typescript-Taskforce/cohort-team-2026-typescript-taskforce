# Demo payment portal

A transactional checkout, preserving the app's Emerald identity. Inter is the primary face;
ui-monospace is the secondary face for invoice identifiers, totals and receipt references.
Existing roles: background #021a15, surface #062b23, raised #0c3b31, border #285047,
foreground #eaf6f0, secondary #a3bdb2, action #10dcb0, on-action #021a15.
Foreground/background and on-action/action exceed WCAG AA; avoid secondary text on action.
Signature: a restrained invoice ledger next to a single payment action; mobile stacks the ledger
above the form. No stock imagery, marketing hero, gradients, decorative cards or new fonts.
Actual heading: “Review your payment”. Total: “$125.00”. Vendor: “Northline Utilities”.
Reject if the amount or demo label is unclear, mobile overflows, or checkout resembles live money movement.

Challenge before implementation: fixed fixture must agree with receipt and browser selectors;
a user-controlled URL or amount must never select a real bill. Browser storage is only demo
convenience, never an authoritative payment ledger. Repeated clicks need synchronous guarding.
No live payment APIs or Supabase writes exist in this route. These constraints address the
spec, consumers, replay edges and the premise that this is a simulated external portal.
