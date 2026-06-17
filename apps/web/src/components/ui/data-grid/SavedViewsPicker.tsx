import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { SavedView, SavedViewState } from '@crm2/sdk';
import { api, ApiError } from '../../../lib/sdk.js';
import { useFocusTrap } from '../../../lib/useFocusTrap.js';

/**
 * Saved views picker (DATAGRID_STANDARD §10, B-5). A per-user named snapshot of THIS grid's URL-state
 * — search/sort/page-size/visible-columns/filters (everything except `page`). Own-user scoped (the
 * endpoint is identity-gated like the bell). `resourceKey` is the grid's `queryKey`. Switching a view
 * replaces the URL with its captured state; a default view auto-applies on a clean open of the grid.
 */
export function SavedViewsPicker({ resourceKey }: { resourceKey: string }) {
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const menuRef = useFocusTrap<HTMLDivElement>(open, () => setOpen(false));

  const viewsKey = ['saved-views', resourceKey];
  const viewsQuery = useQuery({
    queryKey: viewsKey,
    queryFn: () =>
      api<SavedView[]>('GET', `/api/v2/saved-views?resourceKey=${encodeURIComponent(resourceKey)}`),
  });
  const views = viewsQuery.data ?? [];
  const invalidate = () => void qc.invalidateQueries({ queryKey: viewsKey });

  // Capture the grid's current URL-state — every param except `page` (a view is a query, not a scroll
  // position). The server stores it opaquely; applying it sets these exact keys back on the URL.
  const captureState = (): SavedViewState => {
    const s: SavedViewState = {};
    params.forEach((v, k) => {
      if (k !== 'page') s[k] = v;
    });
    return s;
  };
  const applyState = (state: SavedViewState) => {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries(state)) if (v) next.set(k, v);
    setParams(next, { replace: true });
  };

  // Auto-apply the default view on a CLEAN open (no grid-state in the URL yet). Once per mount — the
  // grid remounts per route, so navigating back to a list re-applies its default; a bookmarked/filtered
  // URL is respected (state already present → skip).
  const appliedDefault = useRef(false);
  useEffect(() => {
    if (appliedDefault.current || viewsQuery.isLoading) return;
    appliedDefault.current = true;
    const hasState = [...params.keys()].some((k) => k !== 'page');
    if (hasState) return;
    const def = (viewsQuery.data ?? []).find((v) => v.isDefault);
    if (def) applyState(def.state);
  }, [viewsQuery.isLoading, viewsQuery.data, params, applyState]);

  const createMut = useMutation({
    mutationFn: (name: string) =>
      api<SavedView>('POST', '/api/v2/saved-views', { resourceKey, name, state: captureState() }),
    onSuccess: () => {
      setNewName('');
      setError(null);
      invalidate();
      toast('View saved');
    },
    onError: (e) =>
      setError(
        e instanceof ApiError && e.code === 'SAVED_VIEW_NAME_EXISTS'
          ? 'A view with that name already exists.'
          : 'Could not save the view.',
      ),
  });
  const updateMut = useMutation({
    mutationFn: (id: string) => api<SavedView>('PUT', `/api/v2/saved-views/${id}`, { state: captureState() }),
    onSuccess: () => {
      invalidate();
      toast('View updated to the current filters');
    },
    onError: () => toast.error('Could not update the view.'),
  });
  const setDefaultMut = useMutation({
    mutationFn: (v: SavedView) =>
      api<SavedView>('POST', `/api/v2/saved-views/${v.id}/set-default`, { isDefault: !v.isDefault }),
    onSuccess: invalidate,
    onError: () => toast.error('Could not change the default view.'),
  });
  const removeMut = useMutation({
    mutationFn: (id: string) => api<{ ok: true }>('DELETE', `/api/v2/saved-views/${id}`),
    onSuccess: invalidate,
    onError: () => toast.error('Could not delete the view.'),
  });

  const submitNew = () => {
    const name = newName.trim();
    if (!name || createMut.isPending) return;
    createMut.mutate(name);
  };

  return (
    <div className="relative">
      <button
        type="button"
        className="btn-ghost text-xs"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        Views{views.length > 0 ? ` (${views.length})` : ''}
      </button>
      {open && (
        <>
          <button
            type="button"
            aria-hidden="true"
            tabIndex={-1}
            className="fixed inset-0 z-20 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div
            ref={menuRef}
            role="menu"
            aria-label="Saved views"
            className="absolute right-0 z-30 mt-1 w-72 max-w-[calc(100vw-2rem)] rounded-md border border-border bg-card p-1 text-sm shadow-md"
          >
            <p className="px-2 pb-1 pt-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Saved views
            </p>
            {views.length === 0 && (
              <p className="px-2 py-1.5 text-xs text-muted-foreground">No saved views yet.</p>
            )}
            {views.map((v) => (
              <div key={v.id} className="flex items-center gap-1 rounded px-1 py-0.5 hover:bg-row-hover">
                <button
                  role="menuitem"
                  className="flex-1 truncate rounded px-1 py-1 text-left"
                  title={`Apply "${v.name}"`}
                  onClick={() => {
                    applyState(v.state);
                    setOpen(false);
                  }}
                >
                  {v.name}
                </button>
                <button
                  type="button"
                  className={`px-1 text-base leading-none ${
                    v.isDefault ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
                  }`}
                  aria-label={v.isDefault ? `Unset "${v.name}" as default` : `Set "${v.name}" as default`}
                  aria-pressed={v.isDefault}
                  title="Default — auto-applied when you open this list"
                  onClick={() => setDefaultMut.mutate(v)}
                >
                  {v.isDefault ? '★' : '☆'}
                </button>
                <button
                  type="button"
                  className="px-1 text-xs text-muted-foreground hover:text-foreground"
                  aria-label={`Update "${v.name}" to the current filters`}
                  title="Save the current filters into this view"
                  onClick={() => updateMut.mutate(v.id)}
                >
                  ⤓
                </button>
                <button
                  type="button"
                  className="px-1 text-sm text-muted-foreground hover:text-destructive"
                  aria-label={`Delete "${v.name}"`}
                  title="Delete this view"
                  onClick={() => removeMut.mutate(v.id)}
                >
                  ×
                </button>
              </div>
            ))}
            <div className="mt-1 border-t border-border px-1 pb-1 pt-2">
              <label className="mb-1 block px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Save current view
              </label>
              <div className="flex items-center gap-1">
                <input
                  className="input h-7 flex-1 text-xs"
                  placeholder="View name…"
                  aria-label="New view name"
                  maxLength={120}
                  value={newName}
                  onChange={(e) => {
                    setNewName(e.target.value);
                    setError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') submitNew();
                  }}
                />
                <button
                  type="button"
                  className="btn h-7 px-2 text-xs"
                  disabled={!newName.trim() || createMut.isPending}
                  onClick={submitNew}
                >
                  Save
                </button>
              </div>
              {error && (
                <p className="mt-1 px-1 text-xs text-destructive" role="alert">
                  {error}
                </p>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
