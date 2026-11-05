import { zValidator } from '@hono/zod-validator';
import type { Context, ValidationTargets } from 'hono';
import type { ZodType } from 'zod';
import { errorBody, HttpError } from './errors';

/**
 * `zValidator` with the portal's error shape:
 * 400 `{ error: { code: 'invalid_request', message, details: issues } }`.
 *
 * Usage: `app.post('/x', validate('json', someSchema), (c) => c.req.valid('json'))`
 */
export function validate<Target extends keyof ValidationTargets, Schema extends ZodType>(
  target: Target,
  schema: Schema,
) {
  return zValidator(target, schema, (result, c) => {
    if (!result.success) {
      return c.json(errorBody('invalid_request', 'Invalid request', result.error.issues), 400);
    }
  });
}

/** `c.req.parseBody()`, answering 400 instead of 500 when the multipart body is malformed. */
export async function readMultipart(c: Context) {
  try {
    return await c.req.parseBody();
  } catch {
    throw new HttpError(
      400,
      'invalid_request',
      'The upload could not be read. Choose the file again and retry.',
    );
  }
}
