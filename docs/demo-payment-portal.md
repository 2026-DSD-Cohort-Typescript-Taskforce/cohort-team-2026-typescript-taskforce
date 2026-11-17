# Demo payment portal

Open `/demo/payments` on the Next.js app (locally, `http://127.0.0.1:3000/demo/payments`).
This public route simulates a vendor checkout and receipt. It never transfers money,
updates a bill, records a payment, or calls Supabase. No additional environment variables are needed.

The fixed sample is bill **7**, vendor **9**, invoice **INV-7**, total **125.00 USD**.
These are synthetic identifiers, not database records. Bank details come from
`client/test-fixtures/bank-account.json`; only those exact strings are accepted.
The test account is prefilled so the Stagehand worker can simply review and click Pay.
Do not enter real bank information.

Click **Pay $125.00** to see a simulated receipt. Refresh recovers the receipt in the
same browser tab using sessionStorage. **Start a new demo** clears it for another run.
This storage is a UI convenience, not durable payment idempotency. The worker must
continue to enforce its own durable idempotency key. A new browser context begins a fresh demo.

## Stagehand profile

On the DC-95 worker branch, add this operator-owned profile to STAGEHAND_PORTALS_FILE:

```json
[
  {
    "portalUrl": "http://127.0.0.1:3000/demo/payments",
    "vendorId": 9,
    "amountUnit": "dollars",
    "invoiceSelector": "#invoice-number",
    "totalSelector": "#payment-total",
    "paySelector": "#pay-button",
    "confirmationSelector": "#payment-success",
    "confirmationInvoiceSelector": "#receipt-invoice",
    "confirmationTotalSelector": "#receipt-total",
    "confirmationReferenceSelector": "#transaction-reference"
  }
]
```

Use the exact deployed origin instead of localhost when hosted. Do not add a trailing
slash unless the URL stored in the vendor profile also has one. A hosted worker's
localhost refers to that worker's machine, not the developer's computer.

The worker is separate work in DC-95; this branch only supplies its demo browser target.
No real bill-mcp connection or database vendor URL is configured by this page.
