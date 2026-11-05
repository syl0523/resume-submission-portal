import type { ApiErrorBody } from '@jsp/core';

/** Settings, API client and tiny DOM helpers shared by the popup and options pages. */

export interface Settings {
  portalUrl: string;
  token: string;
}

export async function loadSettings(): Promise<Settings | null> {
  const s = await chrome.storage.local.get(['portalUrl', 'token']);
  const portalUrl = typeof s.portalUrl === 'string' ? s.portalUrl : '';
  const token = typeof s.token === 'string' ? s.token : '';
  return portalUrl && token ? { portalUrl, token } : null;
}

export async function saveSettings(settings: Settings): Promise<void> {
  await chrome.storage.local.set(settings);
}

/** "https://portal.example.com/anything" → "https://portal.example.com". */
export function normalizePortalUrl(input: string): string | null {
  try {
    const u = new URL(input.trim());
    if (
      u.protocol !== 'https:' &&
      !(u.protocol === 'http:' && /^(localhost|127\.0\.0\.1)$/.test(u.hostname))
    )
      return null;
    return u.origin;
  } catch {
    return null;
  }
}

export class ExtApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function extApi<T>(
  settings: Settings,
  path: string,
  init: { method?: string; json?: unknown } = {},
): Promise<T> {
  const res = await fetch(`${settings.portalUrl}/api/ext${path}`, {
    method: init.method ?? (init.json === undefined ? 'GET' : 'POST'),
    headers: {
      authorization: `Bearer ${settings.token}`,
      ...(init.json === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: init.json === undefined ? undefined : JSON.stringify(init.json),
  });
  if (!res.ok) {
    let body: Partial<ApiErrorBody> = {};
    try {
      body = (await res.json()) as ApiErrorBody;
    } catch {
      body = {};
    }
    throw new ExtApiError(
      res.status,
      body.error?.code ?? 'http_error',
      body.error?.message ?? `Request failed (${res.status})`,
    );
  }
  return (await res.json()) as T;
}

/** A binary download from the extension API (resume files for autofill). */
export async function extFile(settings: Settings, path: string): Promise<Blob> {
  const res = await fetch(`${settings.portalUrl}/api/ext${path}`, {
    headers: { authorization: `Bearer ${settings.token}` },
  });
  if (!res.ok) {
    throw new ExtApiError(res.status, 'http_error', `Could not download the file (${res.status})`);
  }
  return res.blob();
}

type Child = Node | string | null | undefined | false;

/** Minimal element builder: h('button', { class: 'primary', onclick }, 'Save'). */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Record<string, unknown> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function')
      el.addEventListener(k.slice(2), v as EventListener);
    else if (k === 'class') el.className = String(v);
    else if (k in el && typeof v !== 'string') (el as unknown as Record<string, unknown>)[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) if (c) el.append(c);
  return el;
}

export function errorText(err: unknown): string {
  if (err instanceof ExtApiError && err.code === 'invalid_token')
    return 'Your token was revoked or is wrong. Create a new one in the portal (Settings).';
  if (err instanceof Error) return err.message;
  return 'Something went wrong';
}
