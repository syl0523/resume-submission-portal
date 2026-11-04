import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api, errorMessage, qs } from './api';
import {
  formatPercent,
  formatSalary,
  fromDateInput,
  relativeDay,
  splitList,
  toDateInput,
} from './format';

describe('format helpers', () => {
  const now = new Date('2026-11-04T15:00:00');

  it('describes nearby days in words and far ones as dates', () => {
    expect(relativeDay('2026-11-04T08:00:00', now)).toBe('today');
    expect(relativeDay('2026-11-03T22:00:00', now)).toBe('yesterday');
    expect(relativeDay('2026-11-05T09:00:00', now)).toBe('tomorrow');
    expect(relativeDay('2026-10-31T09:00:00', now)).toBe('4 days ago');
    expect(relativeDay('2026-11-10T09:00:00', now)).toBe('in 6 days');
    expect(relativeDay(null, now)).toBe('—');
    expect(relativeDay('2026-08-01T09:00:00', now)).not.toMatch(/ago/);
  });

  it('formats salaries, percentages and lists', () => {
    expect(formatSalary(65000, 85000, 'USD')).toBe('$65,000–$85,000');
    expect(formatSalary(null, null, 'USD')).toBeNull();
    expect(formatSalary(70000, null, null)).toBe('$70,000');
    expect(formatPercent(0.714)).toBe('71%');
    expect(splitList(' Workday, HRIS ,\nFMLA,, ')).toEqual(['Workday', 'HRIS', 'FMLA']);
  });

  it('round-trips date inputs without shifting the day', () => {
    const iso = fromDateInput('2026-11-04');
    expect(iso).not.toBeNull();
    expect(toDateInput(iso)).toBe('2026-11-04');
    expect(fromDateInput('')).toBeNull();
  });
});

describe('api client', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('builds query strings without empty values', () => {
    expect(qs({ q: 'hr', status: '', limit: 50, onlyNew: false, sort: undefined })).toBe(
      '?q=hr&limit=50',
    );
    expect(qs({})).toBe('');
  });

  it('turns error bodies into ApiError with code and details', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: {
                code: 'duplicate',
                message: 'You already saved this job',
                details: { applicationId: 'a1' },
              },
            }),
            {
              status: 409,
            },
          ),
      ),
    );
    const err = await api('/api/applications', { method: 'POST', json: {} }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 409, code: 'duplicate', details: { applicationId: 'a1' } });
    expect(errorMessage(err)).toBe('You already saved this job');
  });

  it('sends JSON and returns undefined for 204', async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(null, { status: 204 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await expect(api('/api/tokens/x', { method: 'DELETE' })).resolves.toBeUndefined();
    await api('/api/profile', { method: 'PUT', json: { fullName: 'Jane' } });
    const init = fetchMock.mock.calls[1]?.[1];
    expect(init?.body).toBe('{"fullName":"Jane"}');
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers['content-type']).toBe('application/json');
  });
});
