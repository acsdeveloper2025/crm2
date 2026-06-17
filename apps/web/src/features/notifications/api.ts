/** Notification feed REST (ADR-0027) — the durable source of truth; the socket only nudges these to refetch. */
import type { Notification, Paginated, UnreadCount, MarkAllReadResult } from '@crm2/sdk';
import { api } from '../../lib/sdk.js';

export const NOTIFICATIONS_KEY = ['notifications'] as const;
export const UNREAD_COUNT_KEY = ['notifications', 'unread-count'] as const;

export function fetchUnreadCount(): Promise<UnreadCount> {
  return api<UnreadCount>('GET', '/api/v2/notifications/unread-count');
}

export function fetchNotifications(limit = 15): Promise<Paginated<Notification>> {
  return api<Paginated<Notification>>('GET', `/api/v2/notifications?limit=${limit}`);
}

export function markNotificationRead(id: string): Promise<Notification> {
  return api<Notification>('POST', `/api/v2/notifications/${id}/read`, {});
}

export function markAllNotificationsRead(): Promise<MarkAllReadResult> {
  return api<MarkAllReadResult>('POST', '/api/v2/notifications/mark-all-read', {});
}
