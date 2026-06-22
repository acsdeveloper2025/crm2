import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiUpload, ApiError } from '../lib/sdk.js';
import { Button } from './ui/Button.js';
import { UploadIcon } from './ui/icons.js';

const NOT_FOUND = 404;
const STORAGE_503 = 503;

/**
 * Profile-photo control (slice 7). Three modes:
 *  - SELF (`self` set): the signed-in user manages their OWN avatar via the self-scoped `/users/me`
 *    routes (no admin perm). Used on the profile page + header menu.
 *  - EDIT (`userId` set): an admin reads + replaces another user's photo via `/users/:id` (USER_MANAGE).
 *  - CREATE (`onPick` set, no id yet): the user doesn't exist, so we can't upload — we hold the picked
 *    file, preview it locally, and hand it to the parent, which uploads it right after the user is
 *    created. Either way object storage is config-gated (ADR-0021): an unconfigured deployment answers
 *    503 STORAGE_NOT_CONFIGURED, surfaced as a clear inert message rather than an error.
 * Upload posts raw image bytes (apiUpload), same transport as import.
 */
export function UserPhoto({
  userId,
  self,
  onPick,
}: {
  userId?: string;
  /** self-service: target /users/me/photo[-url] using the session identity (no userId/admin perm). */
  self?: boolean;
  onPick?: (file: File) => void;
}) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [localPreview, setLocalPreview] = useState<string | null>(null); // CREATE-mode object URL
  // SELF reads/writes /users/me; EDIT reads/writes /users/:id. CREATE has no remote endpoint.
  const base = self ? '/api/v2/users/me' : `/api/v2/users/${userId}`;
  const remote = self || !!userId; // a fetch+upload target exists (i.e. not CREATE mode)
  const queryKey = ['user-photo', self ? 'me' : userId];

  // SELF/EDIT — fetch the stored photo. Disabled in CREATE mode (no id to read).
  const photo = useQuery({
    queryKey,
    enabled: remote,
    queryFn: async (): Promise<{ url: string | null; configured: boolean }> => {
      try {
        return {
          url: (await api<{ url: string }>('GET', `${base}/photo-url`)).url,
          configured: true,
        };
      } catch (e) {
        if (e instanceof ApiError && e.status === NOT_FOUND) return { url: null, configured: true };
        if (e instanceof ApiError && e.status === STORAGE_503) return { url: null, configured: false };
        throw e;
      }
    },
  });

  // Revoke the object URL when it's replaced or the dialog unmounts.
  useEffect(
    () => () => {
      if (localPreview) URL.revokeObjectURL(localPreview);
    },
    [localPreview],
  );

  function validImage(file: File): boolean {
    if (['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) return true;
    setNote('Please choose a PNG, JPEG, or WebP image under 5 MB.');
    return false;
  }

  /** SELF/EDIT mode: upload now. */
  async function uploadNow(file: File): Promise<void> {
    setBusy(true);
    setNote(null);
    try {
      await apiUpload(`${base}/photo`, file, file.name);
      await qc.invalidateQueries({ queryKey });
    } catch (e) {
      setNote(
        e instanceof ApiError && e.status === STORAGE_503
          ? 'Object storage is not configured on this deployment yet.'
          : e instanceof ApiError && e.code === 'INVALID_IMAGE'
            ? 'Please choose a PNG, JPEG, or WebP image under 5 MB.'
            : 'Upload failed.',
      );
    } finally {
      setBusy(false);
    }
  }

  /** CREATE mode: stage the file for the parent + preview it locally. */
  function stage(file: File): void {
    setNote(null);
    setLocalPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(file);
    });
    onPick?.(file);
  }

  function handleFile(file: File): void {
    if (!validImage(file)) return;
    if (remote) void uploadNow(file);
    else stage(file);
  }

  const configured = photo.data?.configured ?? true;
  const url = localPreview ?? photo.data?.url ?? null;
  const staged = !remote && !!localPreview;

  return (
    <div className="flex items-center gap-3">
      <div className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-muted">
        {url ? (
          <img src={url} alt="Profile photo" className="size-full object-cover" />
        ) : (
          <span className="text-xs text-muted-foreground">No photo</span>
        )}
      </div>
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">Profile photo</p>
        {configured ? (
          <>
            <Button variant="secondary" size="sm" loading={busy} onClick={() => fileRef.current?.click()}>
              <UploadIcon />
              {url ? 'Replace photo' : 'Upload photo'}
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFile(file);
                e.target.value = '';
              }}
            />
            {staged && (
              <p className="mt-1 text-xs text-muted-foreground">Attached — saved when you create the user.</p>
            )}
          </>
        ) : (
          <p className="text-xs text-muted-foreground">Object storage not configured (deploy step).</p>
        )}
        {note && <p className="mt-1 text-xs text-destructive">{note}</p>}
      </div>
    </div>
  );
}
