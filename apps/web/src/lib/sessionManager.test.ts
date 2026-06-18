import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { sessionManager } from './sessionManager.js';
import { hasActiveMutations } from './sdk.js';

// No jsdom in this repo (frozen stack) — stub the few DOM globals the manager touches.
vi.mock('./sdk.js', () => ({ hasActiveMutations: vi.fn(() => false) }));

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

function makeCb() {
  return { onWarning: vi.fn(), onClearWarning: vi.fn(), onLogout: vi.fn() };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-06-18T00:00:00Z'));
  vi.stubGlobal('localStorage', localStorageMock());
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('document', Object.assign(new EventTarget(), { hidden: false }));
  vi.mocked(hasActiveMutations).mockReturnValue(false);
  localStorage.setItem('acs.accessToken', 'tok');
});
afterEach(() => {
  sessionManager.destroy();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it('exempt role (both null) never starts the timer', () => {
  const cb = makeCb();
  sessionManager.init({ idleLogoutMinutes: null, maxSessionMinutes: null }, cb);
  vi.advanceTimersByTime(60 * 60_000);
  expect(cb.onWarning).not.toHaveBeenCalled();
  expect(cb.onLogout).not.toHaveBeenCalled();
});

it('warns ~60s before the idle deadline and logs out at it', () => {
  const cb = makeCb();
  sessionManager.init({ idleLogoutMinutes: 10, maxSessionMinutes: null }, cb);
  vi.advanceTimersByTime(9 * 60_000 + 1000); // 9:01 idle → within the warn window
  expect(cb.onWarning).toHaveBeenCalled();
  expect(cb.onLogout).not.toHaveBeenCalled();
  vi.advanceTimersByTime(60_000); // 10:01 idle → past the logout threshold
  expect(cb.onLogout).toHaveBeenCalledWith('You were signed out due to inactivity.');
});

it('user activity dismisses the warning and resets the clock', () => {
  const cb = makeCb();
  sessionManager.init({ idleLogoutMinutes: 10, maxSessionMinutes: null }, cb);
  vi.advanceTimersByTime(9 * 60_000 + 2000);
  expect(cb.onWarning).toHaveBeenCalled();
  window.dispatchEvent(new Event('mousemove'));
  expect(cb.onClearWarning).toHaveBeenCalled();
  vi.advanceTimersByTime(60_000); // would have logged out without the reset
  expect(cb.onLogout).not.toHaveBeenCalled();
});

it('a force-logout broadcast from another tab triggers logout', () => {
  const cb = makeCb();
  sessionManager.init({ idleLogoutMinutes: 10, maxSessionMinutes: null }, cb);
  window.dispatchEvent(Object.assign(new Event('storage'), { key: 'acs.forceLogout', newValue: '1' }));
  expect(cb.onLogout).toHaveBeenCalledWith('Your session has ended.');
});

it('enforces the absolute session cap regardless of activity', () => {
  const cb = makeCb();
  localStorage.setItem('acs.sessionStartedAt', String(Date.now() - 13 * 60 * 60_000)); // 13h ago
  sessionManager.init({ idleLogoutMinutes: 10, maxSessionMinutes: 720 }, cb);
  vi.advanceTimersByTime(1000);
  expect(cb.onLogout).toHaveBeenCalledWith('Your session reached its maximum length. Please sign in again.');
});

it('pauses the idle timer while a mutation/upload is in flight', () => {
  vi.mocked(hasActiveMutations).mockReturnValue(true);
  const cb = makeCb();
  sessionManager.init({ idleLogoutMinutes: 10, maxSessionMinutes: null }, cb);
  vi.advanceTimersByTime(11 * 60_000); // past the logout threshold, but a save is in flight
  expect(cb.onWarning).not.toHaveBeenCalled();
  expect(cb.onLogout).not.toHaveBeenCalled();
});
