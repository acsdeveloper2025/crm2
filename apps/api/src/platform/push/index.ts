import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import type { Messaging, MulticastMessage } from 'firebase-admin/messaging';
import type { Env } from '@crm2/config';
import { loadEnv } from '@crm2/config';
import { logger } from '@crm2/logger';

/**
 * FCM push seam (ADR-0027 phase 2). Callers depend on the {@link Pusher} interface, never on
 * firebase-admin directly. The factory returns a real FCM pusher only when a service account is
 * configured (`FIREBASE_SERVICE_ACCOUNT_PATH`, the `caseflow-mobile` project — the device's); otherwise
 * a disabled pusher that no-ops. A missing service account is NOT an error — the in-app + socket legs
 * still deliver; only the "wake a killed app" leg is dark (the correct failure mode per v1's outages).
 * firebase-admin is heavy → lazy-imported, loaded only when actually configured. Mirrors `platform/geocode`.
 */
export interface PushResult {
  successCount: number;
  failureCount: number;
  /** tokens FCM rejected as unregistered/invalid — the caller prunes them. */
  invalidTokens: string[];
}

/** Optional user-facing tray block. When present, a backgrounded/killed device renders an OS
 *  notification (a pure data-only message is invisible off-foreground on the device). Omit it for the
 *  silent LOCATION_REQUEST data-ping to keep that LOCKED shape byte-compatible. */
export interface PushNotification {
  title: string;
  body?: string | undefined;
}

export interface Pusher {
  /** Data message to FCM tokens; pass `notification` to also render an OS tray item (off-foreground).
   *  Empty token list → no-op. Omitting `notification` sends a silent data-only message (LOCATION_REQUEST). */
  sendDataMessage(
    tokens: string[],
    data: Record<string, string>,
    notification?: PushNotification,
  ): Promise<PushResult>;
  /** True once the Firebase Admin SDK has successfully initialized (for the health probe). */
  ready(): boolean;
}

const EMPTY: PushResult = { successCount: 0, failureCount: 0, invalidTokens: [] };

const disabledPusher: Pusher = {
  sendDataMessage: () => Promise.resolve(EMPTY),
  ready: () => false,
};

/** True when a Firebase service account is provisioned for this deployment. */
export function pushConfigured(env: Env = loadEnv()): boolean {
  return !!env.FIREBASE_SERVICE_ACCOUNT_PATH;
}

let override: Pusher | null = null;
let cached: Pusher | null = null;

/** For tests: inject a fake pusher (mirrors setGeocoder/setStorage). Pass null to restore the factory. */
export function setPusher(p: Pusher | null): void {
  override = p;
  cached = null;
}

/** The active pusher: real FCM when a service account is configured, else the disabled no-op. */
export function getPusher(env: Env = loadEnv()): Pusher {
  if (override) return override;
  if (cached) return cached;
  cached = pushConfigured(env)
    ? createFirebasePusher(env.FIREBASE_SERVICE_ACCOUNT_PATH as string)
    : disabledPusher;
  return cached;
}

/** Warm the FCM SDK at boot so the health probe reflects real init state + the first ping is fast. */
export async function warmUpPush(env: Env = loadEnv()): Promise<void> {
  if (!pushConfigured(env)) return;
  await getPusher(env).sendDataMessage([], {}); // empty list = init-only, no send
}

// FCM error codes that mean "this token is dead — prune it" (matches v1's auto-deactivate path).
const PRUNE_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-argument',
]);

function createFirebasePusher(saPath: string): Pusher {
  let initialized = false;
  let messagingPromise: Promise<Messaging> | null = null;

  async function messaging(): Promise<Messaging> {
    if (!messagingPromise) {
      messagingPromise = (async () => {
        // Lazy-import firebase-admin only when actually configured (heavy dep).
        const { initializeApp, cert, getApps } = await import('firebase-admin/app');
        const { getMessaging } = await import('firebase-admin/messaging');
        const raw = JSON.parse(readFileSync(resolve(saPath), 'utf8')) as { project_id?: string };
        const app = getApps()[0] ?? initializeApp({ credential: cert(resolve(saPath)) });
        initialized = true;
        logger.info('FCM initialized', { projectId: raw.project_id ?? null });
        return getMessaging(app);
      })().catch((e: unknown) => {
        messagingPromise = null; // a transient failure self-heals on the next call
        logger.warn('FCM init failed', { error: e instanceof Error ? e.message : String(e) });
        throw e;
      });
    }
    return messagingPromise;
  }

  return {
    async sendDataMessage(tokens, data, notification) {
      if (tokens.length === 0) {
        // Warm-up / no recipients: still attempt init so the health probe is truthful.
        try {
          await messaging();
        } catch {
          /* logged in messaging() */
        }
        return EMPTY;
      }
      let fcm: Messaging;
      try {
        fcm = await messaging();
      } catch {
        return EMPTY; // init failure must never throw into the caller (in-app + socket already delivered)
      }
      // Data payload + high priority (byte-compatible with the LOCKED device contract). A user-facing
      // send also carries a `notification` block so a backgrounded/killed device renders an OS tray
      // item; the silent LOCATION_REQUEST ping omits it and stays a pure data-only message.
      const message: MulticastMessage = { tokens, data, android: { priority: 'high' } };
      if (notification) {
        // Build a clean block (body omitted when absent) — the FCM Notification type wants `body?: string`,
        // not an explicit `undefined` (exactOptionalPropertyTypes).
        message.notification = notification.body
          ? { title: notification.title, body: notification.body }
          : { title: notification.title };
      }
      const res = await fcm.sendEachForMulticast(message);
      const invalidTokens: string[] = [];
      res.responses.forEach((r, i) => {
        const code = r.error?.code;
        if (code && PRUNE_CODES.has(code)) {
          const tok = tokens[i];
          if (tok) invalidTokens.push(tok);
        }
      });
      return { successCount: res.successCount, failureCount: res.failureCount, invalidTokens };
    },
    ready: () => initialized,
  };
}
