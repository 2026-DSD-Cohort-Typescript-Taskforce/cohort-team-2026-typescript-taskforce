import { createHash } from 'node:crypto';
import { mkdir, open, readFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { HttpError } from '../middleware/errorHandler';
import type { ExecuteRequest, ExecuteResponse } from './payment-contract';

interface RecordData {
  fingerprint: string;
  state: 'claimed' | 'submitting' | 'confirmed' | 'blocked';
  result?: ExecuteResponse;
}

export interface ExecutionClaim {
  replay?: ExecuteResponse;
  submitting(): Promise<void>;
  confirmed(result: ExecuteResponse): Promise<void>;
  blocked(): Promise<void>;
}

const hash = (value: string) => createHash('sha256').update(value).digest('hex');

/** A single durable local volume shared by every process serving these routes. */
export class ExecutionStore {
  constructor(private readonly directory: string) {}

  async claim(input: ExecuteRequest, cents: number): Promise<ExecutionClaim> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const location = join(this.directory, hash(input.idempotencyKey));
    const fingerprint = hash(
      JSON.stringify([
        input.billId,
        input.portalUrl,
        input.amount,
        input.vendorId,
        input.invoiceNumber,
        cents,
      ]),
    );
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
          blocked: async () => {},
        };
      }
      throw new HttpError(
        409,
        'This request already ran or needs reconciliation.',
        'outcome_unknown',
      );
    }

    const save = async (state: RecordData['state'], result?: ExecuteResponse) => {
      const file = await open(join(location, 'record.tmp'), 'w', 0o600);
      try {
        await file.writeFile(JSON.stringify({ fingerprint, state, result }));
        await file.sync();
      } finally {
        await file.close();
      }
      await rename(join(location, 'record.tmp'), join(location, 'record.json'));
      await this.syncDirectory(location);
    };
    await save('claimed');
    return {
      submitting: () => save('submitting'),
      confirmed: (result) => save('confirmed', result),
      blocked: () => save('blocked'),
    };
  }

  private async syncDirectory(path: string) {
    const directory = await open(path, 'r');
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  }
}
