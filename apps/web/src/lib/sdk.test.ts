import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api, hasActiveMutations } from './sdk.js';

/** Minimal localStorage stub so the node test env satisfies tokenStore (no jsdom — frozen stack). */
function localStorageMock(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  } as Storage;
}

beforeEach(() => {
  vi.stubGlobal('localStorage', localStorageMock());
  localStorage.setItem('acs.accessToken', 'tok');
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('counts an in-flight POST as an active mutation, clears after it settles', async () => {
  let resolveFetch: (v: Response) => void = () => {};
  vi.stubGlobal(
    'fetch',
    vi.fn(() => new Promise<Response>((r) => (resolveFetch = r))),
  );
  const p = api('POST', '/x', { a: 1 });
  expect(hasActiveMutations()).toBe(true);
  resolveFetch(new Response('{}', { status: 200 }));
  await p;
  expect(hasActiveMutations()).toBe(false);
});

it('does NOT count a background GET as an active mutation', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('{}', { status: 200 })),
  );
  const p = api('GET', '/x');
  expect(hasActiveMutations()).toBe(false);
  await p;
  expect(hasActiveMutations()).toBe(false);
});

it('decrements even when the request fails', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('{"error":"BOOM"}', { status: 500 })),
  );
  await expect(api('POST', '/x', {})).rejects.toThrow();
  expect(hasActiveMutations()).toBe(false);
});
