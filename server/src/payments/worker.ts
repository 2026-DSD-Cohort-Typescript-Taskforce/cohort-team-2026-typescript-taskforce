import { HttpError } from '../middleware/errorHandler';
import type { ExecutionRepository } from './execution-store';
import type {
  ExecuteRequest,
  ExecuteResponse,
  ObserveRequest,
  StagehandWorker,
  ReceiptArtifact,
} from './payment-contract';
import { assertPaymentMatch, requestedCents } from './worker-input';

export interface PortalSession {
  text(): Promise<string>;
  review(): Promise<{ invoice: string; total: string }>;
  submit(
    expected: { invoice: string; cents: number },
    markSubmitting: () => Promise<void>,
  ): Promise<void>;
  confirm(expected: { invoice: string; cents: number }): Promise<void>;
  captureReceipt?(expected: {
    invoice: string;
    cents: number;
  }): Promise<ReceiptArtifact | undefined>;
  close(): Promise<void>;
}

export interface PortalBrowser {
  prepareExecution(input: ExecuteRequest): Promise<{
    unit: 'dollars' | 'cents';
    open(): Promise<PortalSession>;
  }>;
  open(input: ObserveRequest, mode: 'observe' | 'execute'): Promise<PortalSession>;
}

export class BrowserWorker implements StagehandWorker {
  constructor(
    private readonly browser: PortalBrowser,
    private readonly store: ExecutionRepository,
  ) {}

  async receipt(billId: number, key: string) {
    return this.store.receipt(billId, key);
  }

  async observe(input: ObserveRequest) {
    let session: PortalSession | undefined;
    try {
      session = await this.browser.open(input, 'observe');
      return { pageText: await session.text() };
    } catch (error) {
      if (error instanceof HttpError) throw error;
      const failure = new HttpError(502, 'Portal observation failed.', 'portal_error');
      failure.cause = error;
      throw failure;
    } finally {
      await session?.close().catch(() => {});
    }
  }

  async execute(input: ExecuteRequest): Promise<ExecuteResponse> {
    const execution = await this.browser.prepareExecution(input);
    const cents = requestedCents(input.amount, execution.unit);
    const expected = { invoice: input.invoiceNumber, cents };
    const claim = await this.store.claim(input, cents);
    if (claim.replay) return claim.replay;
    let session: PortalSession | undefined;
    let submissionPossible = false;
    try {
      session = await execution.open();
      assertPaymentMatch(await session.review(), expected);
      await session.submit(expected, async () => {
        await claim.submitting();
        submissionPossible = true;
      });
      await session.confirm(expected);
      const result: ExecuteResponse = { confirmed: true };
      // Confirmation is durable before any optional screenshot work can fail.
      await claim.confirmed(result);
      if (session.captureReceipt) {
        try {
          const artifact = await session.captureReceipt(expected);
          if (artifact)
            result.receipt = {
              status: 'captured',
              billId: input.billId,
              vendorId: input.vendorId,
              invoiceNumber: input.invoiceNumber,
              amountMinor: cents,
              ...artifact,
            };
        } catch {
          result.receipt = { status: 'failed' };
        }
        // Losing artifact persistence must never undo a confirmed payment.
        await claim.confirmed(result).catch(() => {});
      }
      return result;
    } catch (error) {
      if (submissionPossible) {
        throw new HttpError(
          409,
          'Payment outcome needs reconciliation. Do not resubmit.',
          'outcome_unknown',
        );
      }
      await claim.retryable();
      if (error instanceof HttpError) throw error;
      const failure = new HttpError(502, 'Portal could not prepare the payment.', 'portal_error');
      failure.cause = error;
      throw failure;
    } finally {
      await session?.close().catch(() => {});
    }
  }
}
