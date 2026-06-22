/**
 * Account menu (header, top-right). An avatar button — the signed-in user's profile photo, falling
 * back to their initials — opens a dropdown: Profile · Security · Sign Out. This is the single account
 * menu (the sidebar footer carries only name + role). The avatar reads the self photo via the same
 * `['user-photo','me']` query key the profile page writes, so uploading a new photo refreshes it here
 * with no extra wiring. Focus-trap / outside-click / Escape come from the shared <Popover>.
 */
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../lib/AuthContext.js';
import { api, ApiError } from '../lib/sdk.js';
import { Popover } from './ui/Popover.js';

const NOT_FOUND = 404;
const STORAGE_503 = 503;

/** First letters of the first two name parts (e.g. "Asha Rao" → "AR"); falls back to the username. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts
    .slice(0, 2)
    .map((p) => p[0])
    .join('');
  return (letters || name[0] || '?').toUpperCase();
}

const ITEM_CLASS =
  'block w-full px-3 py-2 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground';

export function UserMenu() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  // Shared cache with UserPhoto(self) — an upload on /profile invalidates this key and the avatar updates.
  const photo = useQuery({
    queryKey: ['user-photo', 'me'],
    queryFn: async (): Promise<{ url: string | null; configured: boolean }> => {
      try {
        return {
          url: (await api<{ url: string }>('GET', '/api/v2/users/me/photo-url')).url,
          configured: true,
        };
      } catch (e) {
        if (e instanceof ApiError && (e.status === NOT_FOUND || e.status === STORAGE_503))
          return { url: null, configured: false };
        throw e;
      }
    },
  });

  if (!user) return null;
  const url = photo.data?.url ?? null;

  return (
    <Popover
      label="Account menu"
      panelLabel="Account menu"
      panelClassName="w-56"
      triggerClassName="flex size-8 items-center justify-center overflow-hidden rounded-full border border-border bg-primary text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90"
      trigger={
        url ? (
          <img src={url} alt="" className="size-full object-cover" />
        ) : (
          <span aria-hidden="true">{initials(user.name)}</span>
        )
      }
    >
      {(close) => (
        <>
          <div className="border-b border-border px-3 py-2">
            <div className="truncate text-sm font-medium text-foreground">{user.name}</div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              {user.role.replace(/_/g, ' ')}
            </div>
          </div>
          <button
            type="button"
            className={ITEM_CLASS}
            onClick={() => {
              close();
              navigate('/profile');
            }}
          >
            Profile
          </button>
          <button
            type="button"
            className={ITEM_CLASS}
            onClick={() => {
              close();
              navigate('/security');
            }}
          >
            Security
          </button>
          <button
            type="button"
            className={`${ITEM_CLASS} border-t border-border`}
            onClick={() => {
              close();
              void logout();
            }}
          >
            Sign Out
          </button>
        </>
      )}
    </Popover>
  );
}
