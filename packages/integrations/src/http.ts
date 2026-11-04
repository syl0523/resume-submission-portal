import { UpstreamError } from './errors';

export interface FetchOptions {
  fetch?: typeof fetch;
  signal?: AbortSignal;
}

/** GET (or POST) JSON with a clear UpstreamError on network failures and non-2xx answers. */
export async function getJson<T>(
  url: string,
  opts: FetchOptions = {},
  init: RequestInit = {},
  label = new URL(url).hostname,
): Promise<T> {
  const doFetch = opts.fetch ?? fetch;
  let res: Response;
  try {
    res = await doFetch(url, {
      ...init,
      headers: { accept: 'application/json', ...(init.headers ?? {}) },
      signal: opts.signal,
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new UpstreamError(`${label} is unreachable (${reason})`);
  }
  if (!res.ok) {
    await res.body?.cancel();
    const hint =
      res.status === 404 ? 'not found' : res.status === 429 ? 'rate limited' : `HTTP ${res.status}`;
    throw new UpstreamError(`${label} answered ${hint}`, res.status);
  }
  try {
    return (await res.json()) as T;
  } catch {
    throw new UpstreamError(`${label} returned something that is not JSON`, res.status);
  }
}

export function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

export function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function num(value: unknown): number | null {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

/** Clip to a schema limit without cutting inside a surrogate pair. */
export function clip(value: string | null | undefined, max: number): string | null {
  if (!value) return null;
  return value.length <= max ? value : Array.from(value).slice(0, max).join('');
}
