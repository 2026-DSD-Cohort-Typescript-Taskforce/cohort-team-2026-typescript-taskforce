# Stagehand worker contract

Proposed for [DC-25](https://one-atlas-ofwi.atlassian.net/browse/DC-25) review. Updated 2026-11-15. Owner: Joe Gallego.

## Runtime and caller

Add `/observe` and `/execute` to the existing Express app in `server/`. `npm run dev` in that directory runs Node on port 5000, where Stagehand can launch local Chrome. For local development, bill-mcp uses `STAGEHAND_URL=http://127.0.0.1:5000`.

bill-mcp is the only authorized caller. Both endpoints require `Authorization: Bearer <STAGEHAND_SECRET>` and reject missing or invalid credentials before browser work. Keep the secret server-side; the Next.js client must not receive it.

## Endpoints

| Endpoint        | JSON request                                                             | Behavior                                                                                                                                                                                                    |
| --------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /observe` | `{ billId, portalUrl }`                                                  | Open only the supplied portal URL and return page text. Do not click pay or open any other URL.                                                                                                             |
| `POST /execute` | `{ billId, portalUrl, amount, vendorId, invoiceNumber, idempotencyKey }` | Open the supplied portal URL. Submit only when the page total equals `amount` and the invoice equals `invoiceNumber`. Return non-2xx on mismatch without paying; return 2xx only after portal confirmation. |

bill-mcp resolves `portalUrl` from `vendors.payment_portal_url`. The worker accepts no model-provided URLs, browser instructions, or selectors. Reject unexpected request fields at runtime; TypeScript interfaces alone do not validate requests. The shared secret authenticates the trusted caller; it does not independently prove a URL's database origin.

Repeated `idempotencyKey` values must never submit another payment, including concurrent requests and retries after restart. Reusing a key with changed payment details must fail. If submission may have occurred but confirmation is missing, return non-2xx and reconcile before any resubmission. A successful click is not payment confirmation.

## Ownership and ordering

Before calling `/execute`, bill-mcp checks:

- The bill is `pending_payment`.
- The newest approval is `approved`.
- The amount, vendor, and invoice match the bill row.

Only after the worker returns 2xx does bill-mcp call `record_payment`. If `STAGEHAND_URL` is unset, bill-mcp makes no worker call and writes nothing.

Joe owns browser execution and confirmation. He does not approve bills, call `decide_bill`, insert into `payments`, or change bill statuses. Keep the existing database schema and statuses.

## Boundaries and remaining decisions

The DC-25 pass defines the contract. DC-95 implements it in the existing Express server, including the separately authorized Stagehand package installation. Neither pass adds a Next.js route, change to `extract-invoices`, browser in a Supabase edge function, second approval path, or database migration. A separate `worker/` process or Browserbase can be considered later.

DC-95 uses operator-owned portal profiles to explicitly configure the URL, vendor, amount unit (dollars or cents), and verified selectors. Execution fails closed without a matching profile. It returns `{ confirmed: true }` only after confirmation, and observation returns `{ pageText }`. Idempotency records live in a durable local directory shared by server processes, outside the payments table. Confirm the real demo portal, credentials, and amount convention with bill-mcp before enabling it. The installed Stagehand v4 uses `localBrowser.launch()` rather than the older `env: "LOCAL"` setup.

The [TypeScript contract](../../server/src/payments/payment-contract.ts) records request shapes and proposed response types. DC-95 implements and tests authentication, observation without navigation/payment, mismatch rejection, duplicate prevention, confirmed success, and ambiguous submission recovery. bill-mcp integration tests cover its preconditions, `record_payment` ordering, and the unset-URL case.
