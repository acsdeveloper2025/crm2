import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { BulkResult } from '@crm2/sdk';
import { api } from '../lib/sdk.js';
import type { BulkSelection } from './ui/data-grid/index.js';

/** Any selectable master-data row carries the OCC token the bulk mutation guards on. */
interface Versioned {
  id: string | number;
  version: number;
}

/**
 * Bulk Activate / Deactivate for a DataGrid selection (DATAGRID_STANDARD §15;
 * CONCURRENCY_AND_EDITING_STANDARD §1 — per-row OCC). Sends each ticked row's `{id, version}`
 * (captured at selection time) to the resource's `/bulk-activate` | `/bulk-deactivate`; the server
 * applies a version-guarded write per row and returns a per-row result. A row changed since it was
 * ticked comes back CONFLICT — reported, never silently overwritten.
 *
 * `allMatching` ("select all N matching") has no per-row versions loaded, so a versioned bulk
 * mutation can't target it — the user is asked to tick individual rows (export still works at scale).
 */
export function BulkStatusActions<T extends Versioned>({
  selection,
  basePath,
  queryKey,
}: {
  selection: BulkSelection<T>;
  basePath: string;
  queryKey: string;
}) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<'activate' | 'deactivate' | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const run = async (action: 'activate' | 'deactivate') => {
    setBusy(action);
    setMessage(null);
    try {
      const items = selection.rows.map((r) => ({ id: r.id, version: r.version }));
      const res = await api<BulkResult>('POST', `${basePath}/bulk-${action}`, { items });
      qc.invalidateQueries({ queryKey: [queryKey] });
      const parts = [`${res.okCount} updated`];
      if (res.conflictCount) parts.push(`${res.conflictCount} changed by someone else`);
      if (res.notFoundCount) parts.push(`${res.notFoundCount} not found`);
      setMessage(parts.join(' · '));
      // Clean run → drop the selection (closes the bar). Partial → keep it so the message stays
      // visible and the user can re-tick the conflicting rows and retry.
      if (!res.conflictCount && !res.notFoundCount) selection.clear();
    } catch {
      setMessage('Bulk update failed. Please try again.');
    } finally {
      setBusy(null);
    }
  };

  if (selection.allMatching)
    return (
      <span className="text-xs text-muted-foreground">Tick individual rows to activate / deactivate.</span>
    );

  const disabled = selection.rows.length === 0 || busy !== null;
  return (
    <>
      <button
        type="button"
        className="btn-ghost text-xs"
        disabled={disabled}
        onClick={() => void run('activate')}
      >
        {busy === 'activate' ? 'Activating…' : 'Activate'}
      </button>
      <button
        type="button"
        className="btn-ghost text-xs"
        disabled={disabled}
        onClick={() => void run('deactivate')}
      >
        {busy === 'deactivate' ? 'Deactivating…' : 'Deactivate'}
      </button>
      {message && (
        <span className="text-xs text-muted-foreground" role="status">
          {message}
        </span>
      )}
    </>
  );
}
