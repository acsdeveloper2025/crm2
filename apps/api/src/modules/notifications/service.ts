import { randomUUID } from 'node:crypto';
import {
  RegisterPushTokenSchema,
  MuteNotificationSchema,
  UpdateNotificationPreferencesSchema,
  type Notification,
  type NotifyInput,
  type UnreadCount,
  type MarkAllReadResult,
  type NotificationBulkResult,
  type NotificationMute,
  type NotificationMuteList,
  type NotificationPreferences,
  type Paginated,
  type PushTokenRegistration,
  type RequestLocationResult,
} from '@crm2/sdk';
import { notificationRepository as repo } from './repository.js';
import { settingsRepository as settings } from './settings.repository.js';
import { tokenRepository } from './token.repository.js';
import { resolvePage, buildPage, type PageSpec } from '../../platform/pagination.js';
import { getRealtime } from '../../platform/realtime/index.js';
import { getPusher } from '../../platform/push/index.js';
import { AppError } from '../../platform/errors.js';
import { logger } from '@crm2/logger';

/**
 * Build the silent FCM data payload from a durable feed row. FCM `data.*` MUST be all-strings with no
 * nulls (firebase-admin rejects non-strings) — every value is coerced and empty/absent keys are dropped.
 * The key set is exactly what the device's FcmDataSchema reads (type/taskId/taskNumber/caseId/caseNumber/
 * title/message) and the handler navigates on (`type` + `taskId`); `actionUrl` is intentionally omitted —
 * the device sanitizes it against a host allowlist and falls back to `type`+`taskId`, so a synthesized
 * URL would only be dropped + log-warned on-device. `notificationId` is passed through for future ack.
 */
function buildPushData(row: Notification): Record<string, string> {
  const data: Record<string, string> = { type: row.type, title: row.title, notificationId: row.id };
  const put = (key: string, value: string | null | undefined): void => {
    if (value != null && value !== '') data[key] = value;
  };
  put('message', row.message ?? row.body);
  put('taskId', row.taskId);
  put('taskNumber', row.taskNumber);
  put('caseId', row.caseId);
  put('caseNumber', row.caseNumber);
  return data;
}

/**
 * Best-effort FCM "wake-leg": push the durable row to the recipient's active device tokens so a
 * killed/backgrounded app is woken (the socket leg only reaches a foregrounded app). Prunes tokens FCM
 * rejects. Returns true iff FCM accepted >=1 token (optimistic "delivered", matching v1). Never throws.
 */
async function deliverPush(userId: string, row: Notification): Promise<boolean> {
  const tokens = await tokenRepository.activeTokensFor(userId);
  if (tokens.length === 0) return false;
  const result = await getPusher().sendDataMessage(tokens, buildPushData(row));
  if (result.invalidTokens.length > 0) await tokenRepository.deactivate(result.invalidTokens);
  return result.successCount > 0;
}

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
    // Live legs: the socket reaches a foregrounded app; FCM wakes a killed/backgrounded one (v1 parity —
    // every v1 NotificationService.create() pushed). Both are best-effort and never fail the producer; the
    // durable row + badge already landed. The delivery lifecycle is then stamped on the row.
    getRealtime().emitToUser(input.userId, 'notification', row);
    try {
      const delivered = await deliverPush(input.userId, row);
      return (await repo.markDelivery(row.id, delivered ? 'DELIVERED' : 'SENT')) ?? row;
    } catch (e) {
      logger.warn('notification delivery leg failed', {
        notificationId: row.id,
        error: e instanceof Error ? e.message : String(e),
      });
      return row;
    }
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

  // ── Feed management: trash + restore (mobile parity) ──

  /** Trashed feed (soft-deleted rows), paginated like the active feed. */
  async listTrash(userId: string, rawQuery: Record<string, unknown>): Promise<Paginated<Notification>> {
    const page = resolvePage(rawQuery, NOTIFICATION_PAGE_SPEC);
    const [items, totalCount] = await Promise.all([
      repo.listTrash({
        userId,
        limit: page.limit,
        offset: page.offset,
        sortColumn: page.sortColumn,
        sortOrder: page.sortOrder,
        unreadOnly: false,
      }),
      repo.countTrash(userId),
    ]);
    return buildPage(items, totalCount, page, {});
  },

  /** Soft-delete one own row. 404 if absent/already trashed (the device treats 404 as success). */
  async deleteOne(userId: string, id: string): Promise<Notification> {
    const row = await repo.softDeleteOne(userId, id);
    if (!row) throw AppError.notFound();
    return row;
  },

  /** Clear-all: soft-delete every visible own row. */
  async clearAll(userId: string): Promise<NotificationBulkResult> {
    return { count: await repo.softDeleteAll(userId) };
  },

  /** Restore one own trashed row. 404 if absent/not trashed. */
  async restoreOne(userId: string, id: string): Promise<Notification> {
    const row = await repo.restoreOne(userId, id);
    if (!row) throw AppError.notFound();
    return row;
  },

  /** Restore every trashed own row. */
  async restoreAll(userId: string): Promise<NotificationBulkResult> {
    return { count: await repo.restoreAll(userId) };
  },

  // ── Per-task mute + delivery preferences (mobile parity) ──

  /** Mute a task's notifications (UPSERT; re-mute refreshes TTL). */
  async muteTask(userId: string, rawBody: unknown): Promise<NotificationMute> {
    const b = MuteNotificationSchema.parse(rawBody);
    return settings.muteTask(userId, b.taskId, b.expiresAt ?? null);
  },

  /** Unmute a task (idempotent — 404 if no active mute, so the device can converge state). */
  async unmuteTask(userId: string, taskId: string): Promise<Record<string, never>> {
    const removed = await settings.unmuteTask(userId, taskId);
    if (!removed) throw AppError.notFound();
    return {};
  },

  /** List active mutes as a bare v2-native array (ADR-0054, no `{ success, data }` envelope). */
  async listMutes(userId: string): Promise<NotificationMuteList> {
    return settings.listMutes(userId);
  },

  /** Get this user's delivery preferences (empty map when unset). */
  async getPreferences(userId: string): Promise<NotificationPreferences> {
    return settings.getPreferences(userId);
  },

  /** Replace this user's delivery preferences. */
  async setPreferences(userId: string, rawBody: unknown): Promise<NotificationPreferences> {
    const b = UpdateNotificationPreferencesSchema.parse(rawBody);
    return settings.setPreferences(userId, b.preferences);
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
