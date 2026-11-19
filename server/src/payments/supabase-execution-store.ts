import { HttpError } from '../middleware/errorHandler';
import {
  executionIdentity,
  executionKeyHash,
  type ExecutionClaim,
  type ExecutionRepository,
} from './execution-store';
import type { ExecuteRequest, ExecuteResponse, PaymentReceipt } from './payment-contract';

type RpcResult = { data: unknown; error: { message?: string } | null };
export type ExecutionRpcClient = {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<RpcResult>;
};

type ClaimReply = {
  status?: 'claimed' | 'replay' | 'conflict' | 'outcome_unknown';
  result?: ExecuteResponse;
};

/** Cross-instance execution journal backed by service-only atomic Supabase RPCs. */
export class SupabaseExecutionStore implements ExecutionRepository {
  constructor(private readonly client: ExecutionRpcClient) {}

  private async rpc(name: string, args: Record<string, unknown>) {
    const { data, error } = await this.client.rpc(name, args);
    if (error) {
      const failure = new HttpError(
        503,
        'Durable payment execution state is unavailable.',
        'portal_error',
      );
      failure.cause = new Error(error.message || 'Supabase RPC failed');
      throw failure;
    }
    return data;
  }

  async claim(input: ExecuteRequest, cents: number): Promise<ExecutionClaim> {
    const identity = executionIdentity(input, cents);
    const reply = (await this.rpc('claim_stagehand_execution', {
      p_key_hash: identity.keyHash,
      p_fingerprint: identity.fingerprint,
      p_bill_id: input.billId,
    })) as ClaimReply | null;

    if (reply?.status === 'conflict') {
      throw new HttpError(
        409,
        'Idempotency key belongs to another request.',
        'idempotency_conflict',
      );
    }
    if (reply?.status === 'outcome_unknown') {
      throw new HttpError(409, 'An earlier execution needs reconciliation.', 'outcome_unknown');
    }
    if (reply?.status === 'replay' && reply.result?.confirmed === true) {
      return {
        replay: reply.result,
        submitting: async () => {},
        confirmed: async () => {},
        retryable: async () => {},
      };
    }
    if (reply?.status !== 'claimed') {
      throw new HttpError(503, 'Durable payment execution state is invalid.', 'portal_error');
    }

    const transition = async (
      expected: string[],
      state: 'submitting' | 'confirmed' | 'retryable',
      result?: ExecuteResponse,
    ) => {
      const changed = await this.rpc('transition_stagehand_execution', {
        p_key_hash: identity.keyHash,
        p_fingerprint: identity.fingerprint,
        p_expected_states: expected,
        p_to_state: state,
        p_result: result ?? null,
      });
      if (changed !== true) {
        throw new HttpError(
          409,
          'Payment execution state changed unexpectedly.',
          'outcome_unknown',
        );
      }
    };
    return {
      submitting: () => transition(['claimed'], 'submitting'),
      confirmed: (result) => transition(['submitting', 'confirmed'], 'confirmed', result),
      retryable: () => transition(['claimed'], 'retryable'),
    };
  }

  async receipt(billId: number, key: string) {
    const receipt = await this.rpc('get_stagehand_execution_receipt', {
      p_bill_id: billId,
      p_key_hash: executionKeyHash(key),
    });
    if (!isPaymentReceipt(receipt)) {
      throw new HttpError(404, 'Confirmed receipt is unavailable.', 'portal_error');
    }
    return receipt;
  }
}

function isPaymentReceipt(value: unknown): value is PaymentReceipt {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const receipt = value as Record<string, unknown>;
  if (receipt.status === 'failed') return true;
  return (
    receipt.status === 'captured' &&
    Number.isInteger(receipt.billId) &&
    Number.isInteger(receipt.vendorId) &&
    typeof receipt.invoiceNumber === 'string' &&
    Number.isInteger(receipt.amountMinor) &&
    typeof receipt.pngBase64 === 'string' &&
    typeof receipt.sha256 === 'string' &&
    typeof receipt.reference === 'string'
  );
}
