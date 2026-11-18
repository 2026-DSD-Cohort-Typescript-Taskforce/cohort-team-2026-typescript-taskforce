import { createHash, timingSafeEqual } from 'node:crypto';
import { resolve } from 'node:path';
import express, { Router, type RequestHandler } from 'express';
import { HttpError } from '../middleware/errorHandler';
import type { StagehandWorker } from '../payments/payment-contract';
import { observeSchema, executeSchema } from '../payments/worker-input';
import { BrowserWorker } from '../payments/worker';
import { ExecutionStore } from '../payments/execution-store';
import { StagehandBrowser } from '../payments/stagehand-browser';

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
  for (const path of ['/observe', '/execute'] as const) {
    router.all(path, authenticate, parseJson, async (req, res) => {
      if (path === '/observe') {
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

export default createStagehandRoutes(
  new BrowserWorker(
    new StagehandBrowser(process.env.STAGEHAND_PORTALS_FILE),
    new ExecutionStore(
      process.env.STAGEHAND_STATE_DIR || resolve(__dirname, '../../.stagehand-state'),
    ),
  ),
  () => process.env.STAGEHAND_SECRET,
);
