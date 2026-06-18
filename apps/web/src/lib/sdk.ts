/**
 * API wrapper carrying the JWT access token (ADR-0014). On a 401 it transparently
 * refreshes once (single-flight, so concurrent 401s share one rotation) and retries;
 * if refresh fails it clears the session and notifies the registered handler.
 */
import type { ExportOutcome, JobView } from '@crm2/sdk';
import { tokenStore } from './auth.js';

const HTTP_UNAUTHORIZED = 401;
const HTTP_ACCEPTED = 202;

/** Error carrying the HTTP status + parsed body so callers can read OCC conflict payloads (`current`). */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly body?: unknown,
  ) {
    super(code);
    this.name = 'ApiError';
  }
}

let onUnauthorized: () => void = () => {};
/** AuthProvider registers this to drop the user back to the login screen. */
export function setUnauthorizedHandler(fn: () => void): void {
  onUnauthorized = fn;
}

/**
 * Idle-logout pause signal (ADR-0045): count of in-flight user-initiated mutations (non-GET) and
 * uploads. The session manager skips its idle tick while this is > 0 so a long save/upload never
 * times out mid-flight. Background GET refetches are deliberately NOT counted — a noisy polling tab
 * must not be able to keep a walked-away session alive.
 */
let activeMutations = 0;
export function hasActiveMutations(): boolean {
  return activeMutations > 0;
}

let refreshing: Promise<boolean> | null = null;

async function doRefresh(): Promise<boolean> {
  const refreshToken = tokenStore.refresh();
  if (!refreshToken) return false;
  const res = await fetch('/api/v2/auth/refresh', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  });
  if (!res.ok) return false;
  const json = (await res.json()) as { tokens: { accessToken: string; refreshToken: string } };
  tokenStore.set(json.tokens.accessToken, json.tokens.refreshToken);
  return true;
}

/** Single-flight: many simultaneous 401s trigger exactly one refresh (refresh is single-use). */
function refreshOnce(): Promise<boolean> {
  refreshing ??= doRefresh().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

export async function api<T>(method: string, path: string, body?: unknown, retry = false): Promise<T> {
  // Count only the top-level non-GET call (the retry recursion passes retry=true) so the session
  // manager treats an active save/upload as activity. `return await` keeps the count up across retry.
  const tracked = !retry && method.toUpperCase() !== 'GET';
  if (tracked) activeMutations += 1;
  try {
    const accessToken = tokenStore.access();
    const init: RequestInit = {
      method,
      headers: {
        'content-type': 'application/json',
        ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      },
    };
    if (body !== undefined) init.body = JSON.stringify(body);

    const res = await fetch(path, init);

    if (res.status === HTTP_UNAUTHORIZED && !retry && tokenStore.refresh()) {
      if (await refreshOnce()) return await api<T>(method, path, body, true);
      tokenStore.clear();
      onUnauthorized();
      throw new Error('UNAUTHENTICATED');
    }

    const text = await res.text();
    const json = text ? JSON.parse(text) : null;
    if (!res.ok) throw new ApiError(res.status, json?.error ?? `HTTP ${res.status}`, json);
    return json as T;
  } finally {
    if (tracked) activeMutations -= 1;
  }
}

/**
 * GET a file (DataGrid export — IMPORT_EXPORT_STANDARD): returns the blob + the server-suggested
 * filename (Content-Disposition). Shares the same single-flight 401-refresh path as `api`; on error
 * the body is JSON (e.g. 413 EXPORT_TOO_LARGE) → thrown as ApiError.
 */
export async function apiBlob(path: string, retry = false): Promise<{ blob: Blob; filename: string }> {
  const accessToken = tokenStore.access();
  const res = await fetch(path, {
    method: 'GET',
    headers: { ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}) },
  });

  if (res.status === HTTP_UNAUTHORIZED && !retry && tokenStore.refresh()) {
    if (await refreshOnce()) return apiBlob(path, true);
    tokenStore.clear();
    onUnauthorized();
    throw new Error('UNAUTHENTICATED');
  }

  if (!res.ok) {
    const text = await res.text();
    const json = text ? JSON.parse(text) : null;
    throw new ApiError(res.status, json?.error ?? `HTTP ${res.status}`, json);
  }

  const disp = res.headers.get('content-disposition') ?? '';
  const match = /filename="?([^"]+)"?/.exec(disp);
  return { blob: await res.blob(), filename: match?.[1] ?? 'export' };
}

/**
 * GET an export (DataGrid — ADR-0030/B-13): a small set returns a `file` blob; an `all` export ≥ the
 * job threshold returns a 202 + the JSON job row (`kind:'job'`) which the FE tracks + downloads later.
 * Same single-flight 401-refresh + JSON-error handling as {@link apiBlob}.
 */
export async function apiExport(path: string, retry = false): Promise<ExportOutcome> {
  const accessToken = tokenStore.access();
  const res = await fetch(path, {
    method: 'GET',
    headers: { ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}) },
  });

  if (res.status === HTTP_UNAUTHORIZED && !retry && tokenStore.refresh()) {
    if (await refreshOnce()) return apiExport(path, true);
    tokenStore.clear();
    onUnauthorized();
    throw new Error('UNAUTHENTICATED');
  }

  if (!res.ok) {
    const text = await res.text();
    const json = text ? JSON.parse(text) : null;
    throw new ApiError(res.status, json?.error ?? `HTTP ${res.status}`, json);
  }

  // 202 ⇒ enqueued background job (JSON body); anything else is the streamed file.
  if (res.status === HTTP_ACCEPTED) {
    return { kind: 'job', job: (await res.json()) as JobView };
  }
  const disp = res.headers.get('content-disposition') ?? '';
  const match = /filename="?([^"]+)"?/.exec(disp);
  return { kind: 'file', blob: await res.blob(), filename: match?.[1] ?? 'export' };
}

/**
 * POST a file's raw bytes (DataGrid import — IMPORT_EXPORT_STANDARD §5). The body is the file itself
 * (no multipart); the original name rides in `x-filename` for the import_log. Shares the single-flight
 * 401-refresh path; a JSON error body (413 IMPORT_TOO_LARGE, 400 validation) is thrown as ApiError.
 */
export async function apiUpload<T>(path: string, file: Blob, fileName: string, retry = false): Promise<T> {
  const tracked = !retry; // uploads are user-initiated mutations — pause idle while one is in flight
  if (tracked) activeMutations += 1;
  try {
    const accessToken = tokenStore.access();
    const res = await fetch(path, {
      method: 'POST',
      headers: {
        'content-type': 'application/octet-stream',
        'x-filename': encodeURIComponent(fileName), // header must be latin1-safe; server treats it as a label
        ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      },
      body: file,
    });

    if (res.status === HTTP_UNAUTHORIZED && !retry && tokenStore.refresh()) {
      if (await refreshOnce()) return await apiUpload<T>(path, file, fileName, true);
      tokenStore.clear();
      onUnauthorized();
      throw new Error('UNAUTHENTICATED');
    }

    const text = await res.text();
    const json = text ? JSON.parse(text) : null;
    if (!res.ok) throw new ApiError(res.status, json?.error ?? `HTTP ${res.status}`, json);
    return json as T;
  } finally {
    if (tracked) activeMutations -= 1;
  }
}
