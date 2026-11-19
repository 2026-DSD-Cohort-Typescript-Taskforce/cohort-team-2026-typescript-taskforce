import { z } from 'zod';
import { createHash, timingSafeEqual } from 'node:crypto';
import { resolve } from 'node:path';
import express, { Router, type RequestHandler } from 'express';
import { HttpError } from '../middleware/errorHandler';
import type { StagehandWorker } from '../payments/payment-contract';
import { observeSchema, executeSchema } from '../payments/worker-input';
import { BrowserWorker } from '../payments/worker';
import { ExecutionStore } from '../payments/execution-store';
import type { ExecutionRepository } from '../payments/execution-store';
import { SupabaseExecutionStore } from '../payments/supabase-execution-store';
import { StagehandBrowser } from '../payments/stagehand-browser';
import { createClient } from '@supabase/supabase-js';

export function createStagehandRoutes(worker: StagehandWorker, secret: () => string | undefined) {
  const router = Router();
  const jsonBody = express.json({ limit: '16kb' });
  const parseJson: RequestHandler = (req, res, next) => {
    jsonBody(req, res, (error) => {
      if (error?.type === 'entity.parse.failed') {
        next(new HttpError(400, 'The request body is not valid JSON.', 'invalid_request'));
        return;
      }
      next(error);
    });
  };
  const authenticate: RequestHandler = (req, res, next) => {
    const expected = secret();
    const digest = (value: string) => createHash('sha256').update(value).digest();
    if (
      !expected ||
      !timingSafeEqual(digest(req.headers.authorization ?? ''), digest(`Bearer ${expected}`))
    ) {
      res.status(401).json({ code: 'unauthorized', error: 'Unauthorized.' });
      return;
    }
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed.' });
      return;
    }
    next();
  };
  for (const path of ['/observe', '/execute', '/receipt'] as const) {
    router.all(path, authenticate, parseJson, async (req, res) => {
      if (path === '/receipt') {
        const parsed = z
          .strictObject({
            billId: z.number().int().positive(),
            idempotencyKey: z.string().min(1).max(255),
          })
          .safeParse(req.body);
        if (!parsed.success)
          throw new HttpError(400, 'Invalid receipt request.', 'invalid_request');
        if (!worker.receipt)
          throw new HttpError(503, 'Receipt retrieval is unavailable.', 'portal_error');
        res.json({ receipt: await worker.receipt(parsed.data.billId, parsed.data.idempotencyKey) });
      } else if (path === '/observe') {
        const parsed = observeSchema.safeParse(req.body);
        if (!parsed.success)
          throw new HttpError(400, 'Invalid observation request.', 'invalid_request');
        res.json(await worker.observe(parsed.data));
      } else {
        const parsed = executeSchema.safeParse(req.body);
        if (!parsed.success)
          throw new HttpError(400, 'Invalid execution request.', 'invalid_request');
        res.json(await worker.execute(parsed.data));
      }
    });
  }
  return router;
}

export function configuredExecutionRepository(): ExecutionRepository {
  const backend = process.env.STAGEHAND_STATE_BACKEND ?? 'file';
  if (backend === 'file') {
    return new ExecutionStore(
      process.env.STAGEHAND_STATE_DIR || resolve(__dirname, '../../.stagehand-state'),
    );
  }
  if (backend !== 'supabase') {
    throw new Error('STAGEHAND_STATE_BACKEND must be file or supabase.');
  }
  if (process.env.STAGEHAND_STATE_CUTOVER_ACK !== 'supabase-journal-reconciled') {
    throw new Error(
      'Reconcile every legacy Stagehand file-journal record before enabling Supabase state, then set STAGEHAND_STATE_CUTOVER_ACK=supabase-journal-reconciled.',
    );
  }
  const url = process.env.SUPABASE_URL;
  const secret = process.env.STAGEHAND_SUPABASE_SECRET_KEY;
  if (!url || !secret) {
    throw new Error(
      'SUPABASE_URL and STAGEHAND_SUPABASE_SECRET_KEY are required for durable Stagehand state.',
    );
  }
  const client = createClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return new SupabaseExecutionStore(client);
}

function browserProvider() {
  const provider = process.env.STAGEHAND_BROWSER_PROVIDER ?? 'local';
  if (provider !== 'local' && provider !== 'browserbase') {
    throw new Error('STAGEHAND_BROWSER_PROVIDER must be local or browserbase.');
  }
  return provider;
}

export default createStagehandRoutes(
  new BrowserWorker(
    new StagehandBrowser(process.env.STAGEHAND_PORTALS_FILE, {
      profilesJson: process.env.STAGEHAND_PORTALS_JSON,
      provider: browserProvider(),
      browserbaseApiKey: process.env.BROWSERBASE_API_KEY,
    }),
    configuredExecutionRepository(),
  ),
  () => process.env.STAGEHAND_SECRET,
);
