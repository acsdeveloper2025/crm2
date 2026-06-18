/**
 * Idle / inactivity auto-logout (ADR-0045) — v2 port of the v1 web session manager.
 *
 * DESK web roles run a warn-then-logout idle timer whose window the SERVER decides
 * (`idleLogoutMinutes`); a `null` window (FIELD_AGENT and any exempt role) means the manager never
 * starts. A second, optional absolute cap (`maxSessionMinutes`) forces re-login regardless of
 * activity. Cross-tab via `localStorage`; the timer pauses while a user mutation/upload is in flight.
 * UI + the actual sign-out are injected via callbacks so this module stays free of React/router/SDK.
 */
import { tokenStore } from './auth.js';
import { hasActiveMutations } from './sdk.js';

const WARN_BEFORE_LOGOUT_S = 60;
const CHECK_INTERVAL_VISIBLE = 1000;
const CHECK_INTERVAL_HIDDEN = 30_000;
const ACTIVITY_THROTTLE_MS = 1000;
const MS_PER_S = 1000;
const MS_PER_MIN = 60_000;
const LAST_ACTIVITY_KEY = 'acs.lastActivity';
const FORCE_LOGOUT_KEY = 'acs.forceLogout';
const SESSION_STARTED_KEY = 'acs.sessionStartedAt';
const ACTIVITY_EVENTS = [
  'mousemove',
  'mousedown',
  'keydown',
  'scroll',
  'touchstart',
  'click',
  'visibilitychange',
] as const;

export interface IdleConfig {
  idleLogoutMinutes: number | null;
  maxSessionMinutes: number | null;
}
export interface IdleCallbacks {
  onWarning: (remainingSeconds: number) => void;
  onClearWarning: () => void;
  onLogout: (reason: string) => void;
}

const IDLE_REASON = 'You were signed out due to inactivity.';
const MAX_SESSION_REASON = 'Your session reached its maximum length. Please sign in again.';
const FORCED_REASON = 'Your session has ended.';

class SessionManager {
  private idleMs = Number.POSITIVE_INFINITY;
  private warnMs = Number.POSITIVE_INFINITY;
  private maxSessionMs: number | null = null;
  private lastActivity = Date.now();
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private warned = false;
  private started = false;
  private cb: IdleCallbacks | null = null;

  init(config: IdleConfig, cb: IdleCallbacks): void {
    if (this.started) return;
    if (config.idleLogoutMinutes == null && config.maxSessionMinutes == null) return; // exempt role
    if (config.idleLogoutMinutes != null) {
      this.idleMs = config.idleLogoutMinutes * MS_PER_MIN;
      this.warnMs = Math.max(0, this.idleMs - WARN_BEFORE_LOGOUT_S * MS_PER_S);
    }
    this.maxSessionMs = config.maxSessionMinutes != null ? config.maxSessionMinutes * MS_PER_MIN : null;
    this.cb = cb;
    this.started = true;
    this.lastActivity = this.readStoredActivity() ?? Date.now();
    this.updateActivity();
    for (const e of ACTIVITY_EVENTS) window.addEventListener(e, this.onActivity, { passive: true });
    window.addEventListener('storage', this.onStorage);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.startPolling();
  }

  destroy(): void {
    if (!this.started) return;
    this.stopPolling();
    for (const e of ACTIVITY_EVENTS) window.removeEventListener(e, this.onActivity);
    window.removeEventListener('storage', this.onStorage);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.cb = null;
    this.started = false;
    this.warned = false;
    this.idleMs = Number.POSITIVE_INFINITY;
    this.warnMs = Number.POSITIVE_INFINITY;
    this.maxSessionMs = null;
  }

  /** "Stay Logged In" — reset the idle clock and dismiss the warning. */
  extend(): void {
    this.warned = false;
    this.updateActivity();
    this.cb?.onClearWarning();
  }

  private readStoredActivity(): number | null {
    const v = localStorage.getItem(LAST_ACTIVITY_KEY);
    return v ? parseInt(v, 10) : null;
  }
  private updateActivity(): void {
    this.lastActivity = Date.now();
    localStorage.setItem(LAST_ACTIVITY_KEY, String(this.lastActivity));
  }
  private clearWarningIfShown(): void {
    if (this.warned) {
      this.warned = false;
      this.cb?.onClearWarning();
    }
  }
  private onActivity = (): void => {
    if (Date.now() - this.lastActivity > ACTIVITY_THROTTLE_MS) {
      this.clearWarningIfShown();
      this.updateActivity();
    }
  };
  private onStorage = (e: StorageEvent): void => {
    if (e.key === FORCE_LOGOUT_KEY && e.newValue) {
      this.trigger(FORCED_REASON);
    } else if (e.key === LAST_ACTIVITY_KEY && e.newValue) {
      const t = parseInt(e.newValue, 10);
      if (t > this.lastActivity) {
        this.lastActivity = t;
        this.clearWarningIfShown();
      }
    }
  };
  private onVisibility = (): void => {
    if (!this.intervalId) return;
    this.stopPolling();
    this.startPolling();
    this.check(); // resume-from-suspend: re-evaluate immediately, don't wait for the next tick
  };
  private startPolling(): void {
    const hidden = typeof document !== 'undefined' && document.hidden;
    this.intervalId = setInterval(this.check, hidden ? CHECK_INTERVAL_HIDDEN : CHECK_INTERVAL_VISIBLE);
  }
  private stopPolling(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  private check = (): void => {
    if (!tokenStore.access()) return; // session sentinel — nothing to police
    const now = Date.now();
    if (this.maxSessionMs != null) {
      const start = parseInt(localStorage.getItem(SESSION_STARTED_KEY) ?? '0', 10);
      if (start > 0 && now - start >= this.maxSessionMs) {
        this.trigger(MAX_SESSION_REASON);
        return;
      }
    }
    if (hasActiveMutations()) {
      this.updateActivity(); // a save/upload is in flight — treat as active
      return;
    }
    const stored = this.readStoredActivity();
    if (stored && stored > this.lastActivity) this.lastActivity = stored;
    const idle = now - this.lastActivity;
    if (idle >= this.idleMs) {
      this.trigger(IDLE_REASON);
    } else if (idle >= this.warnMs) {
      this.warned = true;
      this.cb?.onWarning(Math.max(0, Math.ceil((this.idleMs - idle) / MS_PER_S)));
    }
  };

  private trigger(reason: string): void {
    if (!tokenStore.access()) return; // idempotent — already signed out
    localStorage.setItem(FORCE_LOGOUT_KEY, String(Date.now()));
    const cb = this.cb;
    this.destroy();
    cb?.onLogout(reason);
  }
}

export const sessionManager = new SessionManager();
