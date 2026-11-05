import type { ApiErrorBody } from '@jsp/core';
import { truncate } from '@jsp/integrations';
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
  console.error('Unhandled error', describeError(err));
  return c.json(errorBody('internal', 'Something went wrong. Please try again.'), 500);
}

/**
 * One-line summary of an unexpected error that is safe to log or store. drizzle's query errors put
 * every bound parameter in their message (email subjects and bodies, resume text, profile details),
 * so for those only the SQL and the database's own message are kept.
 */
export function errorSummary(err: unknown): string {
  if (!(err instanceof Error)) return truncate(String(err), 500);
  const { query, params } = err as { query?: unknown; params?: unknown };
  if (typeof query === 'string' && Array.isArray(params)) {
    const cause = err.cause instanceof Error ? ` (${err.cause.message})` : '';
    return truncate(`Failed query: ${query}${cause}`, 500);
  }
  return truncate(`${err.name}: ${err.message}`, 500);
}

/** `errorSummary` plus the first stack frames, for console logs. */
export function describeError(err: unknown): string {
  const frames =
    err instanceof Error
      ? (err.stack ?? '')
          .split('\n')
          .filter((line) => /^\s+at /.test(line))
          .slice(0, 8)
      : [];
  return [errorSummary(err), ...frames].join('\n');
}
