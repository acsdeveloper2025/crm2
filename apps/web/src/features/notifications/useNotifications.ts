/**
 * Notification hooks (ADR-0027). Queries read the durable REST feed; `useRealtimeNotifications` wires
 * the socket so a pushed event refetches the badge/list instantly + toasts the new item. The socket is
 * a nudge, never the source of truth — a missed event is reconciled on the next query/focus.
 */
import { useEffect } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { Notification } from '@crm2/sdk';
import { onRealtime } from '../../lib/socket.js';
import {
  NOTIFICATIONS_KEY,
  UNREAD_COUNT_KEY,
  fetchUnreadCount,
  fetchNotifications,
  markNotificationRead,
  markAllNotificationsRead,
} from './api.js';

export function useUnreadCount() {
  return useQuery({
    queryKey: UNREAD_COUNT_KEY,
    queryFn: fetchUnreadCount,
    select: (d) => d.count,
  });
}

export function useNotificationList(enabled: boolean) {
  return useQuery({
    queryKey: NOTIFICATIONS_KEY,
    queryFn: () => fetchNotifications(),
    enabled,
  });
}

export function useMarkRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => markNotificationRead(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: NOTIFICATIONS_KEY });
    },
  });
}

export function useMarkAllRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => markAllNotificationsRead(),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: NOTIFICATIONS_KEY });
    },
  });
}

/**
 * Wire the live channel once (mount in the app shell). On a pushed `notification` the badge + list
 * refetch and a toast surfaces the title; on a `field-monitoring:location-updated` the roster refetches
 * (this replaces the Field Monitoring 30s poll — the console now repaints on a real device fix).
 */
export function useRealtimeNotifications(): void {
  const qc = useQueryClient();
  useEffect(() => {
    const offNotif = onRealtime('notification', (payload) => {
      const n = payload as Notification;
      void qc.invalidateQueries({ queryKey: NOTIFICATIONS_KEY });
      if (n.title) toast(n.title, { description: n.body ?? undefined });
    });
    const offLoc = onRealtime('field-monitoring:location-updated', () => {
      // Prefix-matches the DataGrid roster key + ['field-monitoring','stats'] (see FieldMonitoringPage QK).
      void qc.invalidateQueries({ queryKey: ['field-monitoring'] });
    });
    return () => {
      offNotif();
      offLoc();
    };
  }, [qc]);
}
