import type { ErrorRequestHandler, RequestHandler } from "express";

/** An error whose status and message are safe to send to the client. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

export const notFound: RequestHandler = (_req, res) => {
  res.status(404).json({ error: "Not found." });
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- Express treats only 4-argument handlers as error handlers.
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json(err.code ? { error: err.message, code: err.code } : { error: err.message });
    return;
  }
  // express.json() rejects a malformed body with a 400 "entity.parse.failed".
  if (err?.type === "entity.parse.failed") {
    res.status(400).json({ error: "The request body is not valid JSON." });
    return;
  }
  console.error(err);
  res.status(500).json({ error: "Something went wrong." });
};
