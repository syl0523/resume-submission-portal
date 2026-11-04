import type { ApiErrorBody } from '@jsp/core';
import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

/** Throw from any route or service; rendered as `{ error: { code, message, details } }`. */
export class HttpError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const notFound = (what: string) => new HttpError(404, 'not_found', `${what} not found`);

export function errorBody(code: string, message: string, details?: unknown): ApiErrorBody {
  return details === undefined
    ? { error: { code, message } }
    : { error: { code, message, details } };
}

export function handleError(err: Error, c: Context): Response {
  if (err instanceof HttpError) {
    return c.json(errorBody(err.code, err.message, err.details), err.status);
  }
  if (err instanceof HTTPException) {
    return c.json(errorBody('http_error', err.message), err.status);
  }
  console.error('Unhandled error', err);
  return c.json(errorBody('internal', 'Something went wrong. Please try again.'), 500);
}
