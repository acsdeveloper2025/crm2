/**
 * Notification bell (ADR-0027). Unread badge + a dropdown of the latest items; clicking an item marks
 * it read, "Mark all read" clears the badge. Inline SVG + theme tokens to match the app shell (no icon
 * dep). The list/badge refetch live via `useRealtimeNotifications` (mounted in Layout). Focus-trap /
 * outside-click / Escape come from the shared <Popover>; the panel content lives in a child that mounts
 * only while open, so the list still fetches lazily on open.
 */
import { toast } from 'sonner';
import type { Notification } from '@crm2/sdk';
import { formatDateTime } from '../lib/format.js';
import {
  useUnreadCount,
  useNotificationList,
  useMarkRead,
  useMarkAllRead,
} from '../features/notifications/useNotifications.js';
import { fetchJobResultUrl } from '../features/jobs/api.js';
import { Button } from './ui/Button.js';
import { HexagonLoader } from './ui/HexagonLoader.js';
import { Popover } from './ui/Popover.js';

/** A JOB_COMPLETED notification carries the job id in its payload; clicking it downloads the artifact. */
async function downloadFromNotification(n: Notification): Promise<void> {
  const jobId = n.payload?.['jobId'];
  if (typeof jobId !== 'string') return;
  try {
    const { url } = await fetchJobResultUrl(jobId);
    window.open(url, '_blank', 'noopener');
  } catch {
    toast.error('Could not start the download. Please try again.');
  }
}

const MAX_BADGE = 99;

function BellIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

/** Header + scrollable list. Mounts only while the popover is open → the list fetches on open. */
function NotificationPanel({ unread }: { unread: number }) {
  const list = useNotificationList(true);
  const markRead = useMarkRead();
  const markAll = useMarkAllRead();
  const items: Notification[] = list.data?.items ?? [];

  return (
    <>
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="text-sm font-semibold">Notifications</span>
        <Button
          variant="ghost"
          size="sm"
          disabled={unread === 0 || markAll.isPending}
          onClick={() => markAll.mutate()}
        >
          Mark all read
        </Button>
      </div>

      <div className="max-h-96 overflow-y-auto">
        {list.isLoading ? (
          <HexagonLoader operation="Loading notifications" />
        ) : list.isError ? (
          <div className="flex flex-col items-center gap-2 px-3 py-6 text-center text-sm text-muted-foreground">
            <span>Couldn’t load notifications.</span>
            <Button variant="secondary" size="sm" onClick={() => void list.refetch()}>
              Retry
            </Button>
          </div>
        ) : items.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">No notifications</p>
        ) : (
          items.map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() => {
                if (!n.readAt) markRead.mutate(n.id);
                if (n.actionType === 'DOWNLOAD') void downloadFromNotification(n);
              }}
              className={`flex w-full flex-col items-start gap-0.5 border-b border-border px-3 py-2 text-left transition-colors hover:bg-accent ${
                n.readAt ? 'opacity-60' : ''
              }`}
            >
              <span className="flex w-full items-center gap-2">
                {!n.readAt && <span className="h-2 w-2 shrink-0 rounded-full bg-primary" />}
                <span className="text-sm font-medium">{n.title}</span>
              </span>
              {n.body && <span className="text-xs text-muted-foreground">{n.body}</span>}
              <span className="text-[11px] text-muted-foreground">{formatDateTime(n.createdAt)}</span>
            </button>
          ))
        )}
      </div>
    </>
  );
}

export function NotificationBell() {
  const unread = useUnreadCount();
  const count = unread.data ?? 0;

  return (
    <Popover
      label={count > 0 ? `Notifications, ${count} unread` : 'Notifications'}
      panelLabel="Notifications"
      panelClassName="w-80 max-w-[calc(100vw-2rem)]"
      trigger={
        <>
          <BellIcon />
          {count > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold leading-none text-destructive-foreground">
              {count > MAX_BADGE ? `${MAX_BADGE}+` : count}
            </span>
          )}
        </>
      }
    >
      <NotificationPanel unread={count} />
    </Popover>
  );
}
