import { randomUUID } from 'node:crypto';
import {
  RegisterPushTokenSchema,
  type Notification,
  type NotifyInput,
  type UnreadCount,
  type MarkAllReadResult,
  type Paginated,
  type PushTokenRegistration,
  type RequestLocationResult,
} from '@crm2/sdk';
import { notificationRepository as repo } from './repository.js';
import { tokenRepository } from './token.repository.js';
import { resolvePage, buildPage, type PageSpec } from '../../platform/pagination.js';
import { getRealtime } from '../../platform/realtime/index.js';
import { getPusher } from '../../platform/push/index.js';
import { AppError } from '../../platform/errors.js';

/** Only `createdAt` is sortable; the feed is newest-first by default. */
const NOTIFICATION_PAGE_SPEC: PageSpec = {
  sortMap: { createdAt: 'created_at' },
  defaultSort: 'createdAt',
  defaultOrder: 'desc',
};

/**
 * In-app notifications (ADR-0027). `notify()` is the ONE producer path: persist the durable row, then
 * push it live to the recipient's sockets (best-effort — a disconnected user still has the row + badge
 * on next load). Reads are own-user scoped (identity, not a permission).
 */
export const notificationService = {
  async notify(input: NotifyInput): Promise<Notification> {
    const row = await repo.insert(input);
    getRealtime().emitToUser(input.userId, 'notification', row);
    return row;
  },

  async list(userId: string, rawQuery: Record<string, unknown>): Promise<Paginated<Notification>> {
    const page = resolvePage(rawQuery, NOTIFICATION_PAGE_SPEC);
    const unreadOnly = rawQuery['unreadOnly'] === 'true';
    const [items, totalCount] = await Promise.all([
      repo.list({
        userId,
        limit: page.limit,
        offset: page.offset,
        sortColumn: page.sortColumn,
        sortOrder: page.sortOrder,
        unreadOnly,
      }),
      repo.count(userId, unreadOnly),
    ]);
    return buildPage(items, totalCount, page, { unreadOnly });
  },

  async unreadCount(userId: string): Promise<UnreadCount> {
    return { count: await repo.count(userId, true) };
  },

  async markRead(userId: string, id: string): Promise<Notification> {
    const row = await repo.markRead(userId, id);
    if (!row) throw AppError.notFound();
    return row;
  },

  async markAllRead(userId: string): Promise<MarkAllReadResult> {
    return { updated: await repo.markAllRead(userId) };
  },

  // ── FCM push (ADR-0027 phase 2) ──

  /** Register the caller's device FCM token (POST /api/v2/auth/notifications/register). */
  async registerToken(userId: string, rawBody: unknown): Promise<PushTokenRegistration> {
    const b = RegisterPushTokenSchema.parse(rawBody);
    return tokenRepository.register({
      userId,
      token: b.pushToken,
      platform: b.platform,
      deviceId: b.deviceId ?? null,
    });
  },

  /**
   * Admin "request location" ping. Reproduces the LOCKED silent data-message byte-compatibly and
   * delivers it over BOTH FCM (wakes a backgrounded app) and the `user:<id>` socket (`location:request`,
   * for a foregrounded app). The device replies via /location/capture keyed by `requestId` (idempotent).
   * Best-effort: with no tokens (or push unconfigured) the socket leg still reaches a connected device.
   */
  async requestDeviceLocation(targetUserId: string, requestedBy: string): Promise<RequestLocationResult> {
    const requestId = randomUUID();
    const data = {
      type: 'LOCATION_REQUEST' as const,
      requestId,
      requestedBy,
      requestedAt: new Date().toISOString(),
    };

    const tokens = await tokenRepository.activeTokensFor(targetUserId);
    const push = await getPusher().sendDataMessage(tokens, data);
    if (push.invalidTokens.length > 0) await tokenRepository.deactivate(push.invalidTokens);

    getRealtime().emitToUser(targetUserId, 'location:request', data);

    return { requestId, tokensTargeted: tokens.length };
  },
};
