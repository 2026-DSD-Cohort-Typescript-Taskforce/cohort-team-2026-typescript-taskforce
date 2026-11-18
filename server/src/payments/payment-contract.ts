/**
 * DC-25 handoff contract implemented by the DC-95 Express browser worker.
 * See docs/adr/0002-payment-execution-contract.md.
 * Runtime schemas must reject unexpected fields, including steps and selectors.
 * Both endpoints require Authorization: Bearer <STAGEHAND_SECRET>.
 */

/** bill-mcp resolves portalUrl from vendors.payment_portal_url. */
export interface ObserveRequest {
  billId: number;
  portalUrl: string;
}

export interface ExecuteRequest extends ObserveRequest {
  // Unit and currency must be agreed with bill-mcp before implementation.
  amount: number;
  vendorId: number;
  invoiceNumber: string;
  // One key identifies one immutable payment request; never submit twice.
  idempotencyKey: string;
}

/** Proposed response JSON; confirm with bill-mcp before implementation. */
export interface ObserveResponse {
  pageText: string;
}

/** Only return with HTTP 2xx after portal payment confirmation. */
export type ReceiptArtifact = {
  pngBase64: string;
  sha256: string;
  reference: string;
};
export type PaymentReceipt =
  | ({
      status: 'captured';
      billId: number;
      vendorId: number;
      invoiceNumber: string;
      amountMinor: number;
    } & ReceiptArtifact)
  | { status: 'failed' };
export interface ExecuteResponse {
  confirmed: true;
  receipt?: PaymentReceipt;
}

/** Non-2xx response JSON; these codes are not database statuses. */
export interface WorkerErrorResponse {
  code:
    | 'unauthorized'
    | 'invalid_request'
    | 'payment_mismatch'
    | 'idempotency_conflict'
    | 'execution_in_progress'
    | 'outcome_unknown'
    | 'portal_error';
  error: string;
}

/**
 * Implemented inside server/ using Stagehand and a real browser.
 * HTTP handlers authenticate bill-mcp before invoking either operation.
 * No approval, decide_bill, record_payment, or database writes belong here.
 */
export interface StagehandWorker {
  /** Open only portalUrl, return page text, and perform no payment actions. */
  observe(input: ObserveRequest): Promise<ObserveResponse>;

  /**
   * Match page total and invoice before paying. Persist idempotency ownership
   * before submission; preserve it after timeouts/restarts. Resolve only after
   * portal confirmation. HTTP handlers return non-2xx for errors or ambiguity.
   */
  execute(input: ExecuteRequest): Promise<ExecuteResponse>;
  receipt?(billId: number, idempotencyKey: string): Promise<PaymentReceipt | undefined>;
}
