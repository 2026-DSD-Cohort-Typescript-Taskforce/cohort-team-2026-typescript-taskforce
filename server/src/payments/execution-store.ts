import { createHash } from 'node:crypto';
import { mkdir, open, readFile, rename, rmdir } from 'node:fs/promises';
import { join } from 'node:path';
import { HttpError } from '../middleware/errorHandler';
import type { ExecuteRequest, ExecuteResponse, PaymentReceipt } from './payment-contract';

interface RecordData {
  fingerprint: string;
  billId?: number;
  state: 'claimed' | 'submitting' | 'confirmed' | 'blocked' | 'retryable';
  result?: ExecuteResponse;
}

export interface ExecutionClaim {
  replay?: ExecuteResponse;
  submitting(): Promise<void>;
  confirmed(result: ExecuteResponse): Promise<void>;
  retryable(): Promise<void>;
}

const hash = (value: string) => createHash('sha256').update(value).digest('hex');

export const executionKeyHash = (key: string) => hash(key);

export interface ExecutionRepository {
  claim(input: ExecuteRequest, cents: number): Promise<ExecutionClaim>;
  receipt(billId: number, key: string): Promise<PaymentReceipt | undefined>;
}

export function executionIdentity(input: ExecuteRequest, cents: number) {
  return {
    keyHash: executionKeyHash(input.idempotencyKey),
    fingerprint: hash(
      JSON.stringify([
        input.billId,
        input.portalUrl,
        input.amount,
        input.vendorId,
        input.invoiceNumber,
        cents,
      ]),
    ),
  };
}

/** A single durable local volume shared by every process serving these routes. */
export class ExecutionStore implements ExecutionRepository {
  constructor(private readonly directory: string) {}

  async claim(input: ExecuteRequest, cents: number): Promise<ExecutionClaim> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const identity = executionIdentity(input, cents);
    const location = join(this.directory, identity.keyHash);
    const fingerprint = identity.fingerprint;
    const save = async (state: RecordData['state'], result?: ExecuteResponse) => {
      const file = await open(join(location, 'record.tmp'), 'w', 0o600);
      try {
        await file.writeFile(JSON.stringify({ fingerprint, billId: input.billId, state, result }));
        await file.sync();
      } finally {
        await file.close();
      }
      await rename(join(location, 'record.tmp'), join(location, 'record.json'));
      await this.syncDirectory(location);
    };
    const retryLock = join(location, 'retry-claim');
    const handle = (releaseRetryLock: boolean): ExecutionClaim => ({
      submitting: () => save('submitting'),
      confirmed: (result) => save('confirmed', result),
      retryable: async () => {
        await save('retryable');
        if (releaseRetryLock) {
          await rmdir(retryLock);
          await this.syncDirectory(location);
        }
      },
    });
    try {
      await mkdir(location, { mode: 0o700 });
      await this.syncDirectory(this.directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      let previous: RecordData;
      try {
        previous = JSON.parse(await readFile(join(location, 'record.json'), 'utf8'));
      } catch {
        throw new HttpError(409, 'An earlier execution needs reconciliation.', 'outcome_unknown');
      }
      if (previous.fingerprint !== fingerprint) {
        throw new HttpError(
          409,
          'Idempotency key belongs to another request.',
          'idempotency_conflict',
        );
      }
      if (previous.state === 'confirmed' && previous.result?.confirmed === true) {
        return {
          replay: previous.result,
          submitting: async () => {},
          confirmed: async () => {},
          retryable: async () => {},
        };
      }
      if (previous.state === 'retryable') {
        try {
          await mkdir(retryLock, { mode: 0o700 });
          await this.syncDirectory(location);
        } catch (retryError) {
          if ((retryError as NodeJS.ErrnoException).code !== 'EEXIST') throw retryError;
          throw new HttpError(
            409,
            'This request is already retrying or needs reconciliation.',
            'outcome_unknown',
          );
        }
        await save('claimed');
        return handle(true);
      }
      throw new HttpError(
        409,
        'This request already ran or needs reconciliation.',
        'outcome_unknown',
      );
    }
    await save('claimed');
    return handle(false);
  }

  async receipt(billId: number, key: string) {
    try {
      const record: RecordData = JSON.parse(
        await readFile(join(this.directory, hash(key), 'record.json'), 'utf8'),
      );
      if (
        record.billId !== billId ||
        record.state !== 'confirmed' ||
        record.result?.confirmed !== true
      ) {
        throw new Error('Unavailable receipt');
      }
      return record.result.receipt;
    } catch {
      throw new HttpError(404, 'Confirmed receipt is unavailable.', 'portal_error');
    }
  }

  private async syncDirectory(path: string) {
    // Windows refuses fsync on a directory handle (EPERM); NTFS journals the rename/mkdir.
    if (process.platform === 'win32') return;
    const directory = await open(path, 'r');
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  }
}
