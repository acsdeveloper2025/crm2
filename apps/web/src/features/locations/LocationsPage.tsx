import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  exportQueryToParams,
  pageQueryToParams,
  type ExportRequest,
  type Location,
  type PageQuery,
  type Paginated,
} from '@crm2/sdk';
import { api, apiExport, ApiError } from '../../lib/sdk.js';
import { formatDateTime, toDateInput, toIsoDate } from '../../lib/format.js';
import { useFocusTrap } from '../../lib/useFocusTrap.js';
import { BulkStatusActions } from '../../components/BulkStatusActions.js';
import { ImportButton } from '../../components/import/ImportModal.js';
import { StatusChip } from '../../components/StatusChip.js';
import { ConflictDialog } from '../../components/ConflictDialog.js';
import { DataGrid, type DataGridColumn } from '../../components/ui/data-grid/index.js';
import { Button } from '../../components/ui/Button.js';
import { Input } from '../../components/ui/Input.js';

const HTTP_CONFLICT = 409;
const isStale = (e: unknown): e is ApiError =>
  e instanceof ApiError && e.status === HTTP_CONFLICT && e.code === 'STALE_UPDATE';

export function LocationsPage() {
  const qc = useQueryClient();
  const [pincode, setPincode] = useState('');
  // One pincode/city/state + N areas in one action (parity with v1's multi-area pincode entry).
  const [areas, setAreas] = useState<string[]>([]);
  const [areaInput, setAreaInput] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [country, setCountry] = useState('India');
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<Location | null>(null);
  const [toggleConflict, setToggleConflict] = useState<Location | null>(null);

  // Commit the typed text (and comma-separated paste) into the area chip list, de-duping locally.
  const addAreas = (raw: string) => {
    const next = raw
      .split(',')
      .map((a) => a.trim())
      .filter(Boolean);
    if (next.length === 0) return;
    setAreas((prev) => {
      const seen = new Set(prev.map((a) => a.toLowerCase()));
      const merged = [...prev];
      for (const a of next) {
        const k = a.toLowerCase();
        if (!seen.has(k)) {
          seen.add(k);
          merged.push(a);
        }
      }
      return merged;
    });
    setAreaInput('');
  };

  const create = useMutation({
    mutationFn: () => {
      // include any text still in the box that wasn't committed to a chip
      const pending = areaInput
        .split(',')
        .map((a) => a.trim())
        .filter(Boolean);
      const seen = new Set<string>();
      const allAreas = [...areas, ...pending].filter((a) => {
        const k = a.toLowerCase();
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      return api<{ created: Location[]; skipped: { area: string; reason: string }[] }>(
        'POST',
        '/api/v2/locations/batch',
        { pincode, city, state, country, effectiveFrom: toIsoDate(effectiveFrom), areas: allAreas },
      );
    },
    onSuccess: (res) => {
      setPincode('');
      setAreas([]);
      setAreaInput('');
      setCity('');
      setState('');
      setEffectiveFrom('');
      setNotice(
        `Added ${res.created.length} area${res.created.length === 1 ? '' : 's'}` +
          (res.skipped.length ? `; skipped ${res.skipped.length} already-existing` : ''),
      );
      qc.invalidateQueries({ queryKey: ['locations'] });
    },
    onError: (e: Error) => setError(e.message),
  });

  const toggle = useMutation({
    mutationFn: (l: Location) =>
      api('POST', `/api/v2/locations/${l.id}/${l.isActive ? 'deactivate' : 'activate'}`, {
        version: l.version, // OCC: (de)activation is version-guarded (ADR-0019)
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['locations'] }),
    onError: (e: unknown, l: Location) => {
      if (isStale(e)) setToggleConflict(l);
    },
  });

  const columns = useMemo<DataGridColumn<Location>[]>(
    () => [
      {
        id: 'pincode',
        header: 'Pincode',
        sortable: true,
        filterable: true,
        cell: (l) => <span className="font-mono text-xs">{l.pincode}</span>,
      },
      { id: 'area', header: 'Area', sortable: true, filterable: true, cell: (l) => l.area },
      {
        id: 'city',
        header: 'City',
        sortable: true,
        filterable: true,
        cell: (l) => <span className="text-muted-foreground">{l.city}</span>,
      },
      {
        id: 'state',
        header: 'State',
        sortable: true,
        filterable: true,
        cell: (l) => <span className="text-muted-foreground">{l.state}</span>,
      },
      {
        id: 'country',
        header: 'Country',
        sortable: true,
        cell: (l) => <span className="text-muted-foreground">{l.country}</span>,
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
        cell: (l) => (
          <div className="flex items-center justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setEditing(l)}>
              Edit
            </Button>
            <Button
              variant={l.isActive ? 'destructive' : 'secondary'}
              size="sm"
              onClick={() => toggle.mutate(l)}
            >
              {l.isActive ? 'Deactivate' : 'Activate'}
            </Button>
          </div>
        ),
      },
    ],
    [toggle],
  );

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Location Management</h1>
          <p className="text-sm text-muted-foreground">
            The pincode catalog — pincode, area, city and state; the geography that rates price against.
          </p>
        </div>
        <ImportButton
          config={{ basePath: '/api/v2/locations', queryKey: 'locations', entityLabel: 'location' }}
        />
      </div>

      <div className="flex flex-wrap items-end gap-2 rounded-lg border border-border bg-card p-3 shadow-sm">
        <label className="block w-full sm:w-auto">
          <span className="mb-1 block text-xs font-medium text-foreground">Pincode</span>
          <Input
            uppercase={false}
            className="input w-full sm:w-28"
            value={pincode}
            onChange={(e) => setPincode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="400001"
          />
        </label>
        <label className="block w-full sm:w-auto">
          <span className="mb-1 block text-xs font-medium text-foreground">
            Areas <span className="font-normal text-muted-foreground">(Enter or comma to add)</span>
          </span>
          <Input
            className="input w-full sm:w-auto sm:min-w-[12rem]"
            value={areaInput}
            placeholder="Fort, Colaba…"
            onChange={(e) => setAreaInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ',') {
                e.preventDefault();
                addAreas(areaInput);
              }
            }}
            onBlur={() => areaInput.trim() && addAreas(areaInput)}
          />
        </label>
        <label className="block w-full sm:w-auto">
          <span className="mb-1 block text-xs font-medium text-foreground">City</span>
          <Input
            className="input w-full sm:w-auto sm:min-w-[9rem]"
            value={city}
            onChange={(e) => setCity(e.target.value)}
          />
        </label>
        <label className="block w-full sm:w-auto">
          <span className="mb-1 block text-xs font-medium text-foreground">State</span>
          <Input
            className="input w-full sm:w-auto sm:min-w-[9rem]"
            value={state}
            onChange={(e) => setState(e.target.value)}
          />
        </label>
        <label className="block w-full sm:w-auto">
          <span className="mb-1 block text-xs font-medium text-foreground">Country</span>
          <Input
            className="input w-full sm:w-28"
            value={country}
            onChange={(e) => setCountry(e.target.value)}
          />
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
          disabled={!pincode || !(areas.length || areaInput.trim()) || !city || !state || !country}
          loading={create.isPending}
          onClick={() => {
            setError(null);
            setNotice(null);
            create.mutate();
          }}
        >
          Add location
        </Button>
        {areas.length > 0 && (
          <div className="flex w-full flex-wrap gap-1.5">
            {areas.map((a) => (
              <span
                key={a}
                className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs uppercase text-foreground"
              >
                {a}
                <button
                  type="button"
                  aria-label={`Remove ${a}`}
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => setAreas((prev) => prev.filter((x) => x !== a))}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        {error && <p className="w-full text-sm text-destructive">{error}</p>}
        {notice && <p className="w-full text-sm text-muted-foreground">{notice}</p>}
      </div>

      <DataGrid<Location>
        columns={columns}
        queryKey="locations"
        rowId={(l) => l.id}
        defaultSort="pincode"
        searchPlaceholder="Search pincode, area, city, state…"
        fetchPage={(query: PageQuery) =>
          api<Paginated<Location>>('GET', `/api/v2/locations?${pageQueryToParams(query).toString()}`)
        }
        dateFilters={[
          { id: 'createdAt', label: 'Created' },
          { id: 'effectiveFrom', label: 'Effective From' },
        ]}
        selectable
        bulkActions={(sel) => (
          <BulkStatusActions selection={sel} basePath={'/api/v2/locations'} queryKey={'locations'} />
        )}
        exportFn={(req: ExportRequest) =>
          apiExport(`/api/v2/locations/export?${exportQueryToParams(req).toString()}`)
        }
      />

      {editing && <EditLocationDialog location={editing} onClose={() => setEditing(null)} />}

      {toggleConflict && (
        <ConflictDialog
          entityLabel="location"
          current={undefined}
          onReload={() => {
            qc.invalidateQueries({ queryKey: ['locations'] });
            setToggleConflict(null);
          }}
          onDiscard={() => {
            qc.invalidateQueries({ queryKey: ['locations'] });
            setToggleConflict(null);
          }}
        />
      )}
    </div>
  );
}

function EditLocationDialog({ location, onClose }: { location: Location; onClose: () => void }) {
  const qc = useQueryClient();
  const [pincode, setPincode] = useState(location.pincode);
  const [area, setArea] = useState(location.area);
  const [city, setCity] = useState(location.city);
  const [state, setState] = useState(location.state);
  const [country, setCountry] = useState(location.country);
  const [effectiveFrom, setEffectiveFrom] = useState(toDateInput(location.effectiveFrom));
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(location.version); // OCC token the edit started from
  const [conflict, setConflict] = useState<{ updatedAt?: string; version?: number } | null>(null);
  const dialogRef = useFocusTrap<HTMLDivElement>(true, onClose);

  const mut = useMutation({
    mutationFn: () =>
      api('PUT', `/api/v2/locations/${location.id}`, {
        pincode,
        area,
        city,
        state,
        country,
        effectiveFrom: toIsoDate(effectiveFrom),
        version,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['locations'] });
      onClose();
    },
    onError: (e: unknown) => {
      if (isStale(e)) {
        const current = (e.body as { current?: { updatedAt?: string; version?: number } } | null)?.current;
        setConflict(current ?? {});
      } else if (e instanceof ApiError && e.code === 'PINCODE_LOCKED') {
        setError('This pincode is in use by rates and can’t be changed. Deactivate and recreate to fix it.');
      } else setError(e instanceof Error ? e.message : 'Save failed');
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="location-dialog-title"
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-lg border border-border bg-card p-6 text-card-foreground shadow-lg"
      >
        <h2 id="location-dialog-title" className="mb-4 text-lg font-semibold">
          Edit Location
        </h2>
        <div className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-foreground">Pincode (6 digits)</span>
            <Input
              uppercase={false}
              className="input font-mono"
              value={pincode}
              onChange={(e) => setPincode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            />
            <span className="mt-1 block text-xs text-muted-foreground">
              Correctable only while unused — locked once referenced by rates (ADR-0020).
            </span>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-foreground">Area</span>
            <Input className="input" value={area} onChange={(e) => setArea(e.target.value)} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-foreground">City</span>
            <Input className="input" value={city} onChange={(e) => setCity(e.target.value)} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-foreground">State</span>
            <Input className="input" value={state} onChange={(e) => setState(e.target.value)} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-foreground">Country</span>
            <Input className="input" value={country} onChange={(e) => setCountry(e.target.value)} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-foreground">
              Effective From (blank = now)
            </span>
            <input
              type="date"
              className="input"
              value={effectiveFrom}
              onChange={(e) => setEffectiveFrom(e.target.value)}
            />
          </label>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={mut.isPending}>
            Cancel
          </Button>
          <Button
            disabled={pincode.length !== 6 || !area || !city || !state || !country}
            loading={mut.isPending}
            onClick={() => {
              setError(null);
              mut.mutate();
            }}
          >
            Save
          </Button>
        </div>
      </div>

      {conflict && (
        <ConflictDialog
          entityLabel="location"
          current={conflict}
          onReload={() => {
            if (conflict.version !== undefined) setVersion(conflict.version);
            qc.invalidateQueries({ queryKey: ['locations'] });
            setConflict(null);
          }}
          onDiscard={() => {
            qc.invalidateQueries({ queryKey: ['locations'] });
            onClose();
          }}
        />
      )}
    </div>
  );
}
