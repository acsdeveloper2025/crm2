/**
 * @crm2/sdk — in-app notification feed (ADR-0027). The one contract for web AND the mobile app
 * (`GET /api/v2/notifications` + read/mark-all, the shapes reserved in the mobile matrix). The feed
 * is own-user scoped server-side (identity, not a permission); every authenticated user reads their own.
 */
import { z } from 'zod';
import type { PageQuery } from './pagination.js';

export const NOTIFICATION_TYPES = [
  'CASE_TASK_ASSIGNED',
  'CASE_TASK_REASSIGNED',
  'TASK_COMPLETED',
  'TASK_SUBMITTED_FOR_REVIEW',
  'TASK_REVOKED',
  'CASE_ASSIGNED',
  'SYSTEM',
  // background-job completion (ADR-0030, B-7) — JOB_COMPLETED carries action_type DOWNLOAD for exports.
  'JOB_COMPLETED',
  'JOB_FAILED',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const NOTIFICATION_ACTION_TYPES = ['OPEN_CASE', 'OPEN_TASK', 'NAVIGATE', 'DOWNLOAD'] as const;
export type NotificationActionType = (typeof NOTIFICATION_ACTION_TYPES)[number];

/** A feed row. `payload` carries the navigation target ids (e.g. { caseId, taskId }); never PII. */
export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  body: string | null;
  payload: Record<string, unknown>;
  actionType: NotificationActionType | null;
  readAt: string | null;
  createdAt: string;
}

/** Bell badge source. */
export interface UnreadCount {
  count: number;
}

export interface MarkAllReadResult {
  updated: number;
}

// ── Feed management: trash + restore (mobile parity) ──

/** Result of a bulk soft-delete (clear-all) or bulk restore. */
export interface NotificationBulkResult {
  /** rows affected (cleared, or restored). */
  count: number;
}

// ── Per-task mute (mobile parity) ──

/** Mute a task's notifications. Mobile sets only `taskId`; `expiresAt` null = until unmuted. */
export const MuteNotificationSchema = z.object({
  taskId: z.string().uuid(),
  expiresAt: z.string().datetime({ offset: true }).nullable().optional(),
});
export type MuteNotificationInput = z.infer<typeof MuteNotificationSchema>;

/** An active mute row (own-user). `caseId` is reserved for the web case-level mute. */
export interface NotificationMute {
  id: string;
  caseId: string | null;
  taskId: string | null;
  createdAt: string;
  expiresAt: string | null;
}

/** GET /notifications/mutes — v1-envelope shape the device reads (`res.data`). */
export interface NotificationMuteList {
  success: boolean;
  data: NotificationMute[];
}

// ── Per-user delivery preferences (mobile parity) ──

/** PUT /notifications/preferences — opaque per-user toggle map (channel/type → bool). */
export const UpdateNotificationPreferencesSchema = z.object({
  preferences: z.record(z.unknown()),
});
export type UpdateNotificationPreferencesInput = z.infer<typeof UpdateNotificationPreferencesSchema>;

export interface NotificationPreferences {
  preferences: Record<string, unknown>;
  updatedAt: string | null;
}

/** List query: the standard page contract + an `unreadOnly` toggle (bell dropdown shows unread). */
export interface NotificationListQuery extends PageQuery {
  unreadOnly?: boolean;
}

/**
 * Producer input (server-internal contract): what a module passes to the notification service to
 * notify a recipient. Kept in the SDK so producers and the table stay in lockstep.
 */
export interface NotifyInput {
  userId: string;
  type: NotificationType;
  title: string;
  body?: string | null;
  payload?: Record<string, unknown>;
  actionType?: NotificationActionType | null;
}

// ── FCM push (ADR-0027 phase 2) ──

/** Device platforms (UPPERCASE — matches the DB CHECK + the device's `X-Platform`). */
export const PUSH_PLATFORMS = ['IOS', 'ANDROID', 'WEB'] as const;
export type PushPlatform = (typeof PUSH_PLATFORMS)[number];

/**
 * Token registration body (POST /api/v2/auth/notifications/register) — the device's FCM token.
 * `platform` is normalized to UPPERCASE before the enum check so the device's `Platform.OS`
 * (lowercase `android`/`ios`) is accepted (mobile compat). Extra keys (e.g. v1 `enabled`) are stripped.
 */
export const RegisterPushTokenSchema = z.object({
  pushToken: z.string().min(1),
  platform: z.preprocess((v) => (typeof v === 'string' ? v.toUpperCase() : v), z.enum(PUSH_PLATFORMS)),
  deviceId: z.string().optional(),
});
export type RegisterPushTokenInput = z.infer<typeof RegisterPushTokenSchema>;

export interface PushTokenRegistration {
  id: string;
  platform: PushPlatform;
  isActive: boolean;
}

/** Result of an admin "request location" ping (FCM data-message + socket location:request). */
export interface RequestLocationResult {
  /** correlation id the device echoes as its capture Idempotency-Key (FCM+socket double-delivery → one fix). */
  requestId: string;
  /** how many active device tokens the silent FCM was sent to (0 ⇒ the socket leg is the only path). */
  tokensTargeted: number;
}

/** The LOCKED silent data-message shape (ADR-0012). Reproduced byte-compatibly by the server. */
export interface LocationRequestMessage {
  type: 'LOCATION_REQUEST';
  requestId: string;
  requestedBy: string;
  requestedAt: string;
}
