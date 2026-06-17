import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SessionInfo } from '@crm2/sdk';
import { api } from '../lib/sdk.js';
import { formatDateTime } from '../lib/format.js';

/**
 * Active-session list with revoke-one (slice 6). Shared by the self view (/security) and the admin
 * view (user dialog). `userId` switches between the self endpoints (GET /auth/sessions, scoped to the
 * caller) and the admin endpoints (GET /users/:id/sessions, USER_MANAGE). `currentJti` flags the
 * caller's own device in the self view (admin never sees a "this device" badge).
 */
export function SessionList({ userId, currentJti }: { userId?: string; currentJti?: string | null }) {
  const qc = useQueryClient();
  const base = userId ? `/api/v2/users/${userId}/sessions` : '/api/v2/auth/sessions';
  const listPath = userId
    ? base
    : `${base}${currentJti ? `?currentJti=${encodeURIComponent(currentJti)}` : ''}`;
  const queryKey = ['sessions', userId ?? 'self'];

  const sessions = useQuery({
    queryKey,
    queryFn: () => api<SessionInfo[]>('GET', listPath),
  });
  const revoke = useMutation({
    mutationFn: (jti: string) => api<{ ok: true }>('POST', `${base}/${jti}/revoke`),
    onSuccess: () => void qc.invalidateQueries({ queryKey }),
  });

  const rows = sessions.data ?? [];

  return (
    <div>
      {sessions.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No active sessions.</p>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">{s.deviceInfo || 'Unknown device'}</span>
                  {s.current && (
                    <span className="rounded bg-primary/10 px-1.5 py-0.5 text-xs font-medium uppercase text-primary">
                      This device
                    </span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground">
                  {s.ip ?? 'unknown IP'} · last used {formatDateTime(s.lastUsedAt)}
                </div>
              </div>
              {!s.current && (
                <button
                  className="btn-ghost shrink-0 text-sm"
                  onClick={() => revoke.mutate(s.id)}
                  disabled={revoke.isPending}
                >
                  Revoke
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
