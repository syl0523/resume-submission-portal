import { describe, expect, it } from 'vitest';
import { describeError, errorSummary } from './errors';

/** Shaped like drizzle's DrizzleQueryError: the message carries every bound parameter. */
class FakeQueryError extends Error {
  constructor(
    readonly query: string,
    readonly params: unknown[],
    cause?: Error,
  ) {
    super(`Failed query: ${query}\nparams: ${params.join(',')}`, { cause });
    this.name = 'DrizzleQueryError';
  }
}

describe('log-safe error summaries', () => {
  it('keeps the SQL and the database message but never the bound values', () => {
    const err = new FakeQueryError(
      'insert into "inbound_emails" ("subject", "snippet") values (?, ?)',
      ['Your application to Contoso', 'Dear Jane, thank you for applying'],
      new Error('D1_ERROR: NOT NULL constraint failed: inbound_emails.provider'),
    );
    expect(errorSummary(err)).toBe(
      'Failed query: insert into "inbound_emails" ("subject", "snippet") values (?, ?) ' +
        '(D1_ERROR: NOT NULL constraint failed: inbound_emails.provider)',
    );
    const logged = describeError(err);
    expect(logged).not.toContain('Contoso');
    expect(logged).not.toContain('Dear Jane');
    expect(logged).toMatch(/\n\s+at /);
  });

  it('describes other errors by name and message, clipped', () => {
    expect(errorSummary(new TypeError('Failed to parse body as FormData.'))).toBe(
      'TypeError: Failed to parse body as FormData.',
    );
    expect(errorSummary('plain text')).toBe('plain text');
    expect(errorSummary(new Error('x'.repeat(2000)))).toHaveLength(500);
  });
});
