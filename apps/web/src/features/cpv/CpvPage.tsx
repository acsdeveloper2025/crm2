import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  exportQueryToParams,
  pageQueryToParams,
  type BulkCpvUnitResult,
  type ExportRequest,
  type Option,
  type ClientProductView,
  type ClientProductVerificationUnitView,
  type PageQuery,
  type Paginated,
} from '@crm2/sdk';
import { api, apiExport, ApiError } from '../../lib/sdk.js';
import { formatDateTime, toDateInput, toIsoDate } from '../../lib/format.js';
import { useFocusTrap } from '../../lib/useFocusTrap.js';
import { StatusChip } from '../../components/StatusChip.js';
import { ConflictDialog } from '../../components/ConflictDialog.js';
import { ImportButton } from '../../components/import/ImportModal.js';
import { DataGrid, type DataGridColumn } from '../../components/ui/data-grid/index.js';
import { Button } from '../../components/ui/Button.js';
import { HexagonLoader } from '../../components/ui/HexagonLoader.js';
import { withClientFilter, type EmbeddedPageProps } from '../clientSetup/index.js';

const HTTP_CONFLICT = 409;
const isStale = (e: unknown): e is ApiError =>
  e instanceof ApiError && e.status === HTTP_CONFLICT && e.code === 'STALE_UPDATE';

/** UX-6: the sub-table's client-side page size — enabled-unit lists are small (max = catalog size),
 *  so no server paging is warranted; this just keeps a long list scrollable. */
export const UNIT_PAGE_SIZE = 20;

/** Slice `items` to page `page` (1-based) at `pageSize`; page is clamped into range so a stale page
 *  number (after a delete drops the last page) never renders an empty table. */
export function paginate<T>(
  items: T[],
  page: number,
  pageSize: number,
): { pageItems: T[]; totalPages: number } {
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const clamped = Math.min(Math.max(1, page), totalPages);
  const start = (clamped - 1) * pageSize;
  return { pageItems: items.slice(start, start + pageSize), totalPages };
}

/** Is there an active, IN-EFFECT Universal CPV row (`verificationUnitId === null`)? If so, EVERY unit is
 *  already available for this client+product — the resolver `availableUnits` unions the Universal parent
 *  (`verification_unit_id IS NULL`, `cpv/repository.ts`), so enabling a SPECIFIC unit here adds a
 *  redundant row that changes nothing. Mirrors the resolver's gate exactly (`is_active AND
 *  effective_from <= now()`); a future-dated Universal does not yet cover, so it must NOT flag. Pure so
 *  it's unit-testable (pass `nowMs = Date.now()`). */
export function hasActiveUniversalCpv(
  rows: Pick<ClientProductVerificationUnitView, 'verificationUnitId' | 'isActive' | 'effectiveFrom'>[],
  nowMs: number,
): boolean {
  return rows.some(
    (r) => r.verificationUnitId === null && r.isActive && new Date(r.effectiveFrom).getTime() <= nowMs,
  );
}

/**
 * Reschedule the effective-from of a CPV link / unit (the only mutable field — keys are
 * immutable, so to fix a wrong client/product/unit you deactivate and recreate). OCC-guarded.
 */
function RescheduleDialog({
  title,
  current,
  busy,
  onSave,
  onClose,
}: {
  title: string;
  current: string;
  busy: boolean;
  onSave: (iso: string) => void;
  onClose: () => void;
}) {
  const [date, setDate] = useState(toDateInput(current));
  const dialogRef = useFocusTrap<HTMLDivElement>(true, onClose);
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-foreground/40 p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="cpv-reschedule-title"
        className="w-full max-w-sm rounded-lg border border-border bg-card p-4 shadow-lg"
      >
        <h3 id="cpv-reschedule-title" className="text-sm font-semibold">
          {title}
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Reschedule when this becomes usable (ADR-0017). The client/product/unit keys can&apos;t change — to
          correct those, deactivate this row and recreate it.
        </p>
        <label className="mt-3 block">
          <span className="mb-1 block text-xs font-medium text-foreground">Effective From</span>
          <input
            type="date"
            className="input w-full"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            loading={busy}
            disabled={!date}
            onClick={() => {
              const iso = toIsoDate(date);
              if (iso) onSave(iso);
            }}
          >
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}

export function CpvPage({ clientId: controlledClientId }: EmbeddedPageProps = {}) {
  const qc = useQueryClient();
  const [ownClientId, setOwnClientId] = useState('');
  // Controlled (embedded in the Client Setup hub, ADR-0092): the create-form's client is forced to
  // the hub's client, so link creation always targets it — the picker below becomes read-only.
  const clientId = controlledClientId ?? ownClientId;
  const [productId, setProductId] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [linkConflict, setLinkConflict] = useState<ClientProductView | null>(null);
  const [reschedLink, setReschedLink] = useState<ClientProductView | null>(null);

  const clients = useQuery({
    queryKey: ['clients', 'active=true'],
    queryFn: () => api<Option[]>('GET', '/api/v2/clients/options'),
  });
  const products = useQuery({
    queryKey: ['products', 'active=true'],
    queryFn: () => api<Option[]>('GET', '/api/v2/products/options'),
  });

  const createLink = useMutation({
    mutationFn: () =>
      api('POST', '/api/v2/client-products', {
        clientId: Number(clientId),
        productId: Number(productId),
        effectiveFrom: toIsoDate(effectiveFrom),
      }),
    onSuccess: () => {
      setOwnClientId('');
      setProductId('');
      setEffectiveFrom('');
      qc.invalidateQueries({ queryKey: ['client-products'] });
    },
    onError: (e: Error) => setError(e.message),
  });

  const toggleLink = useMutation({
    mutationFn: (l: ClientProductView) =>
      api('POST', `/api/v2/client-products/${l.id}/${l.isActive ? 'deactivate' : 'activate'}`, {
        version: l.version, // OCC: (de)activation is version-guarded (ADR-0019)
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['client-products'] }),
    onError: (e: unknown, l: ClientProductView) => {
      if (isStale(e)) setLinkConflict(l);
    },
  });

  const updateLink = useMutation({
    mutationFn: (v: { l: ClientProductView; effectiveFrom: string }) =>
      api('PUT', `/api/v2/client-products/${v.l.id}`, {
        effectiveFrom: v.effectiveFrom,
        version: v.l.version,
      }),
    onSuccess: () => {
      setReschedLink(null);
      qc.invalidateQueries({ queryKey: ['client-products'] });
    },
    onError: (e: unknown, v: { l: ClientProductView; effectiveFrom: string }) => {
      setReschedLink(null);
      if (isStale(e)) setLinkConflict(v.l);
    },
  });

  const columns = useMemo<DataGridColumn<ClientProductView>[]>(
    () => [
      {
        id: 'client',
        header: 'Client',
        sortable: true,
        filterable: true,
        cell: (l) => (
          <div>
            <div className="font-medium">{l.clientCode}</div>
            <div className="text-xs text-muted-foreground">{l.clientName}</div>
          </div>
        ),
      },
      {
        id: 'product',
        header: 'Product',
        sortable: true,
        filterable: true,
        cell: (l) => (
          <div>
            <div className="font-medium">{l.productCode}</div>
            <div className="text-xs text-muted-foreground">{l.productName}</div>
          </div>
        ),
      },
      {
        id: 'units',
        header: 'Units',
        sortable: true,
        cell: (l) => (
          <span className="rounded bg-muted px-2 py-0.5 text-xs font-medium tabular-nums text-muted-foreground">
            {l.unitCount} unit{l.unitCount === 1 ? '' : 's'}
          </span>
        ),
      },
      {
        id: 'effectiveFrom',
        header: 'Effective From',
        sortable: true,
        cell: (l) => <span className="text-xs text-muted-foreground">{formatDateTime(l.effectiveFrom)}</span>,
      },
      {
        id: 'createdAt',
        header: 'Created',
        sortable: true,
        cell: (l) => <span className="text-xs text-muted-foreground">{formatDateTime(l.createdAt)}</span>,
      },
      {
        id: 'updatedAt',
        header: 'Updated',
        sortable: true,
        cell: (l) => <span className="text-xs text-muted-foreground">{formatDateTime(l.updatedAt)}</span>,
      },
      {
        id: 'status',
        header: 'Status',
        sortable: true,
        cell: (l) => <StatusChip isActive={l.isActive} effectiveFrom={l.effectiveFrom} />,
      },
      {
        id: 'actions',
        header: 'Actions',
        align: 'right',
        // Row click toggles expansion (renderExpanded) — stop these actions from bubbling to it.
        cell: (l) => (
          <div className="flex items-center justify-end gap-2" onClick={(e) => e.stopPropagation()}>
            <Button variant="secondary" size="sm" onClick={() => setReschedLink(l)}>
              Edit
            </Button>
            <Button
              variant={l.isActive ? 'destructive' : 'secondary'}
              size="sm"
              onClick={() => toggleLink.mutate(l)}
            >
              {l.isActive ? 'Deactivate' : 'Activate'}
            </Button>
          </div>
        ),
      },
    ],
    [toggleLink],
  );

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold tracking-tight">CPV Mapping</h1>
          <p className="text-sm text-muted-foreground">
            Enable a product for a client, then expand a row (▸) to choose the verification units that apply
            to that client + product.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Embedded (controlled client): hide the per-module imports and the standalone "Export
              Units" button below — an import file can create links/units for ANY client, and the
              Export Units button is a hard-coded mode=all export, both bypassing the hub's client
              lens (ADR-0092 S2). The DataGrid's own Export (in its toolbar) stays: it follows the
              grid's scoped query, which already carries the controlled client via withClientFilter. */}
          {!controlledClientId && (
            <>
              <ImportButton
                config={{
                  basePath: '/api/v2/client-products',
                  queryKey: 'client-products',
                  entityLabel: 'client-product link',
                }}
                label="Import Links"
              />
              {/* IE-DEFER-2: the unit-enablement leg gains its own bulk import/export (client/product/unit
                  codes round-trip). The enablements span all links, so this is a global import/export here,
                  not per-row in the sub-table (which has no page/cols context). */}
              <ImportButton
                config={{
                  basePath: '/api/v2/cpv-units',
                  queryKey: 'cpv-units',
                  entityLabel: 'enabled unit',
                }}
                label="Import Units"
              />
              <Button
                variant="secondary"
                onClick={() => void apiExport('/api/v2/cpv-units/export?mode=all&format=xlsx')}
              >
                Export Units
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-2 rounded-lg border border-border bg-card p-3 shadow-sm">
        <label className="block w-full sm:w-auto">
          <span className="mb-1 block text-xs font-medium text-foreground">Client</span>
          {controlledClientId ? (
            <input
              className="input w-full sm:w-auto sm:min-w-[12rem]"
              aria-label="Client"
              value={(() => {
                const c = clients.data?.find((o) => String(o.id) === controlledClientId);
                return c ? `${c.code} — ${c.name}` : controlledClientId;
              })()}
              disabled
              readOnly
            />
          ) : (
            <select
              className="input w-full sm:w-auto sm:min-w-[12rem]"
              aria-label="Client"
              value={clientId}
              onChange={(e) => setOwnClientId(e.target.value)}
            >
              <option value="">Select client…</option>
              {clients.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} — {c.name}
                </option>
              ))}
            </select>
          )}
        </label>
        <label className="block w-full sm:w-auto">
          <span className="mb-1 block text-xs font-medium text-foreground">Product</span>
          <select
            className="input w-full sm:w-auto sm:min-w-[12rem]"
            aria-label="Product"
            value={productId}
            onChange={(e) => setProductId(e.target.value)}
          >
            <option value="">Select product…</option>
            {products.data?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.code} — {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block w-full sm:w-auto">
          <span className="mb-1 block text-xs font-medium text-foreground">Effective From</span>
          <input
            type="date"
            className="input w-full sm:w-40"
            value={effectiveFrom}
            onChange={(e) => setEffectiveFrom(e.target.value)}
          />
        </label>
        <Button
          loading={createLink.isPending}
          disabled={!clientId || !productId}
          onClick={() => {
            setError(null);
            createLink.mutate();
          }}
        >
          Link product
        </Button>
        {error && <p className="w-full text-sm text-destructive">{error}</p>}
      </div>

      <DataGrid<ClientProductView>
        columns={columns}
        queryKey="client-products"
        rowId={(l) => l.id}
        defaultSort="client"
        searchPlaceholder="Search client or product…"
        filters={withClientFilter({}, controlledClientId)}
        fetchPage={(query: PageQuery) =>
          api<Paginated<ClientProductView>>(
            'GET',
            `/api/v2/client-products?${pageQueryToParams(query).toString()}`,
          )
        }
        dateFilters={[
          { id: 'createdAt', label: 'Created' },
          { id: 'effectiveFrom', label: 'Effective From' },
        ]}
        exportFn={(req: ExportRequest) =>
          apiExport(`/api/v2/client-products/export?${exportQueryToParams(req).toString()}`)
        }
        renderExpanded={(l) => <UnitManager link={l} />}
      />

      {reschedLink && (
        <RescheduleDialog
          title={`Reschedule ${reschedLink.clientCode} · ${reschedLink.productCode}`}
          current={reschedLink.effectiveFrom}
          busy={updateLink.isPending}
          onSave={(iso) => updateLink.mutate({ l: reschedLink, effectiveFrom: iso })}
          onClose={() => setReschedLink(null)}
        />
      )}

      {linkConflict && (
        <ConflictDialog
          entityLabel="client-product link"
          current={undefined}
          onReload={() => {
            qc.invalidateQueries({ queryKey: ['client-products'] });
            setLinkConflict(null);
          }}
          onDiscard={() => {
            qc.invalidateQueries({ queryKey: ['client-products'] });
            setLinkConflict(null);
          }}
        />
      )}
    </div>
  );
}

/** Inline verification-unit manager for one client-product (expanded row). */
function UnitManager({ link }: { link: ClientProductView }) {
  const qc = useQueryClient();
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [bulkMessage, setBulkMessage] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [unitConflict, setUnitConflict] = useState<ClientProductVerificationUnitView | null>(null);
  const [reschedUnit, setReschedUnit] = useState<ClientProductVerificationUnitView | null>(null);

  const units = useQuery({
    queryKey: ['verification-units', 'active=true'],
    queryFn: () => api<Option[]>('GET', '/api/v2/verification-units/options'),
  });
  const enabled = useQuery({
    queryKey: ['cpv-units', link.id],
    queryFn: () =>
      api<ClientProductVerificationUnitView[]>('GET', `/api/v2/cpv-units?clientProductId=${link.id}`),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['cpv-units', link.id] });
    qc.invalidateQueries({ queryKey: ['client-products'] });
  };

  /** Universal (all units) stays a single-create — it maps `verificationUnitId: null`, which the
   *  bulk endpoint deliberately rejects (ADR-0074; bulk takes concrete unit ids only). */
  const addUniversal = useMutation({
    mutationFn: () =>
      api('POST', '/api/v2/cpv-units', {
        clientProductId: link.id,
        verificationUnitId: null,
        effectiveFrom: toIsoDate(effectiveFrom),
      }),
    onSuccess: () => {
      setEffectiveFrom('');
      invalidate();
    },
    onError: (e: Error) => setError(e.message),
  });

  /** Checkbox multi-select → one bulk POST (UX-6). Per-row CREATED/REACTIVATED/ERROR; an ERROR row
   *  never rolls back the others, so the message always reflects exactly what landed. The bulk
   *  contract has no effectiveFrom (always "now" — the Effective From picker only feeds the
   *  Universal single-create below); a bulk-scheduled effective-from is a possible later add. */
  const bulkAdd = useMutation({
    mutationFn: () =>
      api<BulkCpvUnitResult>('POST', '/api/v2/cpv-units/bulk', {
        clientProductId: link.id,
        verificationUnitIds: [...checked],
      }),
    onSuccess: (res) => {
      const created = res.results.filter((r) => r.status === 'CREATED').length;
      const reactivated = res.results.filter((r) => r.status === 'REACTIVATED').length;
      const errored = res.results.filter((r) => r.status === 'ERROR').length;
      const parts = [];
      if (created) parts.push(`${created} enabled`);
      if (reactivated) parts.push(`${reactivated} re-enabled`);
      if (errored) parts.push(`${errored} failed`);
      setBulkMessage(parts.join(' · '));
      setChecked(new Set());
      setEffectiveFrom('');
      invalidate();
    },
    onError: (e: Error) => setError(e.message),
  });

  const toggleUnit = useMutation({
    mutationFn: (u: ClientProductVerificationUnitView) =>
      api('POST', `/api/v2/cpv-units/${u.id}/${u.isActive ? 'deactivate' : 'activate'}`, {
        version: u.version, // OCC: (de)activation is version-guarded (ADR-0019)
      }),
    onSuccess: invalidate,
    onError: (e: unknown, u: ClientProductVerificationUnitView) => {
      if (isStale(e)) setUnitConflict(u);
    },
  });

  const updateUnit = useMutation({
    mutationFn: (v: { u: ClientProductVerificationUnitView; effectiveFrom: string }) =>
      api('PUT', `/api/v2/cpv-units/${v.u.id}`, { effectiveFrom: v.effectiveFrom, version: v.u.version }),
    onSuccess: () => {
      setReschedUnit(null);
      invalidate();
    },
    onError: (e: unknown, v: { u: ClientProductVerificationUnitView; effectiveFrom: string }) => {
      setReschedUnit(null);
      if (isStale(e)) setUnitConflict(v.u);
    },
  });

  // Only units with a currently-ACTIVE row are excluded from the picker — a deactivated one is still
  // offered, since the bulk endpoint's ON CONFLICT DO UPDATE re-activates it (REACTIVATED status).
  const activelyMapped = new Set(
    enabled.data
      ?.filter((u) => u.isActive)
      .map((u) => u.verificationUnitId)
      .filter((id) => id !== null),
  );
  const pickableUnits = units.data?.filter((u) => !activelyMapped.has(u.id)) ?? [];
  // An active in-effect Universal mapping already makes every unit available (resolver unions it), so
  // every specific pick below is redundant — flag it (still pickable: a specific row is a deliberate
  // pin that survives deactivating the Universal, mirroring the rate-type-assignment "covered" hint).
  // Also require the PARENT link to be usable (`is_active AND effective_from <= now()`, the resolver's
  // `cp.*` gate): a Universal under a dormant link resolves to zero units, so the banner would over-claim.
  const linkUsable = link.isActive && new Date(link.effectiveFrom).getTime() <= Date.now();
  const universalCovers = linkUsable && hasActiveUniversalCpv(enabled.data ?? [], Date.now());

  const { pageItems, totalPages } = paginate(enabled.data ?? [], page, UNIT_PAGE_SIZE);

  return (
    <div className="rounded-md border border-border bg-card">
      <div className="flex flex-wrap items-start gap-4 border-b border-border p-3">
        <div className="block">
          <span className="mb-1 block text-xs font-medium text-foreground">
            Verification units ({checked.size} selected)
          </span>
          <div className="max-h-40 w-64 overflow-y-auto rounded border border-border p-2">
            {universalCovers && (
              <p className="mb-1 rounded bg-st-under-review-bg px-1.5 py-1 text-[11px] text-st-under-review">
                A Universal (all units) mapping is active — every unit is already available here. Enabling a
                specific unit is redundant.
              </p>
            )}
            {pickableUnits.length === 0 && !universalCovers && (
              <p className="text-xs text-muted-foreground">All units are already enabled.</p>
            )}
            {pickableUnits.map((u) => (
              <label
                key={u.id}
                className="flex items-center gap-2 py-0.5 text-xs"
                title={
                  universalCovers
                    ? 'Already covered by the Universal (all units) mapping — enabling it here is redundant'
                    : undefined
                }
              >
                <input
                  type="checkbox"
                  checked={checked.has(u.id)}
                  onChange={(e) => {
                    const next = new Set(checked);
                    if (e.target.checked) next.add(u.id);
                    else next.delete(u.id);
                    setChecked(next);
                  }}
                />
                <span className={universalCovers ? 'text-muted-foreground' : undefined}>
                  {u.code} — {u.name}
                  {universalCovers && (
                    <span className="ml-1 text-[10px] font-medium text-muted-foreground">· covered</span>
                  )}
                </span>
              </label>
            ))}
          </div>
        </div>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-foreground">
            Effective From <span className="font-normal text-muted-foreground">(Universal only)</span>
          </span>
          <input
            type="date"
            className="input w-40"
            value={effectiveFrom}
            onChange={(e) => setEffectiveFrom(e.target.value)}
          />
        </label>
        <div className="flex items-end gap-2">
          <Button
            loading={bulkAdd.isPending}
            disabled={checked.size === 0}
            onClick={() => {
              setError(null);
              setBulkMessage(null);
              bulkAdd.mutate();
            }}
          >
            Enable selected ({checked.size})
          </Button>
          {/* ADR-0074: Universal (all units) stays a single-create — the bulk endpoint only takes
              concrete unit ids. */}
          <Button
            variant="secondary"
            loading={addUniversal.isPending}
            onClick={() => {
              setError(null);
              addUniversal.mutate();
            }}
          >
            Enable Universal (all units)
          </Button>
        </div>
        {error && <p className="w-full text-sm text-destructive">{error}</p>}
        {bulkMessage && (
          <p className="w-full text-sm text-muted-foreground" role="status">
            {bulkMessage}
          </p>
        )}
      </div>
      <table className="rtable w-full text-sm">
        <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th scope="col" className="px-3 py-2 font-semibold">
              Unit
            </th>
            <th scope="col" className="px-3 py-2 font-semibold">
              Effective From
            </th>
            <th scope="col" className="px-3 py-2 font-semibold">
              Created
            </th>
            <th scope="col" className="px-3 py-2 font-semibold">
              Updated
            </th>
            <th scope="col" className="px-3 py-2 font-semibold">
              Status
            </th>
            <th scope="col" className="px-3 py-2 text-right font-semibold">
              Actions
            </th>
          </tr>
        </thead>
        <tbody>
          {enabled.isLoading && (
            <tr>
              <td colSpan={6} className="px-3 py-4">
                <HexagonLoader operation="Loading enabled units" />
              </td>
            </tr>
          )}
          {enabled.isError && (
            <tr>
              <td colSpan={6} className="px-3 py-4">
                <div className="flex items-center justify-center gap-3 text-sm text-muted-foreground">
                  <span>Couldn’t load enabled units.</span>
                  <Button variant="secondary" size="sm" onClick={() => void enabled.refetch()}>
                    Retry
                  </Button>
                </div>
              </td>
            </tr>
          )}
          {pageItems.map((u) => (
            <tr key={u.id} className="border-t border-border transition-colors hover:bg-row-hover">
              <td data-label="Unit" className="px-3 py-2">
                {u.unitCode === null ? (
                  // ADR-0074: a Universal CPV (null unit) — applies to all units of the client+product.
                  <div className="text-xs font-medium text-foreground">Universal (all units)</div>
                ) : (
                  <>
                    <div className="font-mono text-xs">{u.unitCode}</div>
                    <div className="text-xs text-muted-foreground">{u.unitName}</div>
                  </>
                )}
              </td>
              <td
                data-label="Effective From"
                className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground"
              >
                {formatDateTime(u.effectiveFrom)}
              </td>
              <td data-label="Created" className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
                {formatDateTime(u.createdAt)}
              </td>
              <td data-label="Updated" className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
                {formatDateTime(u.updatedAt)}
              </td>
              <td data-label="Status" className="px-3 py-2">
                <StatusChip isActive={u.isActive} effectiveFrom={u.effectiveFrom} />
              </td>
              <td data-label="Actions" className="px-3 py-2 text-right whitespace-nowrap">
                <div className="flex items-center justify-end gap-2">
                  <Button variant="secondary" size="sm" onClick={() => setReschedUnit(u)}>
                    Edit
                  </Button>
                  <Button
                    variant={u.isActive ? 'destructive' : 'secondary'}
                    size="sm"
                    onClick={() => toggleUnit.mutate(u)}
                  >
                    {u.isActive ? 'Deactivate' : 'Activate'}
                  </Button>
                </div>
              </td>
            </tr>
          ))}
          {enabled.data && enabled.data.length === 0 && (
            <tr>
              <td colSpan={6} className="px-3 py-4 text-center text-muted-foreground">
                No units enabled yet — select one above to enable it.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {totalPages > 1 && (
        <div className="flex items-center justify-end gap-2 border-t border-border px-3 py-2 text-xs text-muted-foreground">
          <Button variant="ghost" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Previous
          </Button>
          <span>
            Page {Math.min(page, totalPages)} of {totalPages}
          </span>
          <Button
            variant="ghost"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      )}

      {reschedUnit && (
        <RescheduleDialog
          title={`Reschedule ${reschedUnit.unitCode}`}
          current={reschedUnit.effectiveFrom}
          busy={updateUnit.isPending}
          onSave={(iso) => updateUnit.mutate({ u: reschedUnit, effectiveFrom: iso })}
          onClose={() => setReschedUnit(null)}
        />
      )}

      {unitConflict && (
        <ConflictDialog
          entityLabel="enabled unit"
          current={undefined}
          onReload={() => {
            invalidate();
            setUnitConflict(null);
          }}
          onDiscard={() => {
            qc.invalidateQueries({ queryKey: ['cpv-units', link.id] });
            setUnitConflict(null);
          }}
        />
      )}
    </div>
  );
}
