import { useMemo } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  exportQueryToParams,
  pageQueryToParams,
  type ExportRequest,
  type FieldAgentView,
  type FieldMonitoringStats,
  type PageQuery,
  type Paginated,
  type ReverseGeocodeResult,
  type RequestLocationResult,
} from '@crm2/sdk';
import { api, apiExport } from '../../lib/sdk.js';
import { formatDateTime } from '../../lib/format.js';
import { DataGrid, type DataGridColumn } from '../../components/ui/data-grid/index.js';
import { Button } from '../../components/ui/Button.js';

const BASE = '/api/v2/field-monitoring';
const GEO = '/api/v2/geocode';
const QK = 'field-monitoring';

/** Header counter cards (scope+search aware — they read the same population as the roster). */
const CARDS: { label: string; stat: keyof FieldMonitoringStats; tone?: 'overdue' }[] = [
  { label: 'Field Agents', stat: 'agents' },
  { label: 'With Open Work', stat: 'withOpenWork' },
  { label: 'Open Tasks', stat: 'openTasks' },
  { label: 'Completed Today', stat: 'completedToday' },
  { label: 'Overdue', stat: 'overdue', tone: 'overdue' },
];

/**
 * Field Monitoring (ADR-0026) — the supervisor's field-operations console. Field executives in
 * the actor's hierarchy scope (SA=all, MGR=subtree, TL=team) in ONE Universal DataGrid: workload,
 * today's throughput, aging, last-seen. Truthful data only — the GPS "Last Location" column stays
 * "—" until the field app rebases onto /api/v2 (no fabricated presence).
 */
export function FieldMonitoringPage() {
  // No poll (ADR-0027): the roster + counters repaint live via the `field-monitoring:location-updated`
  // socket event (invalidated in useRealtimeNotifications), replacing the old 30s refetch.
  const stats = useQuery({
    queryKey: [QK, 'stats'],
    queryFn: () => api<FieldMonitoringStats>('GET', `${BASE}/stats`),
  });

  const columns = useMemo<DataGridColumn<FieldAgentView>[]>(
    () => [
      {
        id: 'name',
        header: 'Agent',
        sortable: true,
        hideable: false,
        cell: (a) => (
          <span className="flex flex-col">
            <span className="font-medium">{a.name}</span>
            <span className="font-mono text-xs text-muted-foreground">{a.username}</span>
          </span>
        ),
      },
      { id: 'phone', header: 'Contact', cell: (a) => a.phone ?? '—' },
      {
        id: 'territory',
        header: 'Territory',
        cell: (a) => (
          <span className="whitespace-nowrap text-muted-foreground">
            {a.territoryPincodes} pin · {a.territoryAreas} area
          </span>
        ),
      },
      { id: 'openTasks', header: 'Open', align: 'right', sortable: true, cell: (a) => a.openTasks },
      { id: 'inProgress', header: 'In Progress', align: 'right', cell: (a) => a.inProgress },
      {
        id: 'completedToday',
        header: 'Completed Today',
        align: 'right',
        sortable: true,
        cell: (a) => a.completedToday,
      },
      {
        id: 'overdue',
        header: 'Overdue',
        align: 'right',
        sortable: true,
        cell: (a) =>
          a.overdue > 0 ? (
            <span className="rounded bg-st-rejected-bg px-2 py-0.5 text-xs font-medium text-st-rejected">
              {a.overdue}
            </span>
          ) : (
            <span className="text-muted-foreground">0</span>
          ),
      },
      {
        id: 'lastActivityAt',
        header: 'Last Activity',
        sortable: true,
        cell: (a) => (
          <span className="whitespace-nowrap text-muted-foreground">
            {a.lastActivityAt ? formatDateTime(a.lastActivityAt) : '—'}
          </span>
        ),
      },
      {
        id: 'coordinates',
        header: 'Coordinates',
        cell: (a) =>
          a.lastLat != null && a.lastLng != null ? (
            <a
              href={`https://www.google.com/maps?q=${a.lastLat},${a.lastLng}`}
              target="_blank"
              rel="noreferrer"
              className="whitespace-nowrap font-mono text-xs text-primary hover:underline"
            >
              {a.lastLat.toFixed(5)}, {a.lastLng.toFixed(5)}
            </a>
          ) : (
            <span className="text-muted-foreground/60" title="No location yet (field app rebase pending)">
              —
            </span>
          ),
      },
      {
        id: 'address',
        header: 'Address',
        cell: (a) => <AddressCell lat={a.lastLat} lng={a.lastLng} />,
      },
      {
        id: 'createdAt',
        header: 'Created',
        sortable: true,
        cell: (a) => (
          <span className="whitespace-nowrap text-muted-foreground">{formatDateTime(a.createdAt)}</span>
        ),
      },
      {
        id: 'updatedAt',
        header: 'Updated',
        sortable: true,
        cell: (a) => (
          <span className="whitespace-nowrap text-muted-foreground">{formatDateTime(a.updatedAt)}</span>
        ),
      },
      {
        id: 'actions',
        header: 'Actions',
        cell: (a) => <RequestLocationCell agentId={a.id} agentName={a.name} />,
      },
    ],
    [],
  );

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold tracking-tight">Field Monitoring</h1>
        <p className="text-sm text-muted-foreground">
          Field executives in your team — workload, today's throughput, aging and last-seen.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {CARDS.map((c) => {
          const v = stats.data?.[c.stat];
          return (
            <div key={c.stat} className="rounded-lg border border-border bg-card p-3">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">{c.label}</div>
              <div
                className={`mt-1 text-2xl font-bold tabular-nums ${
                  c.tone === 'overdue' && (v ?? 0) > 0 ? 'text-st-rejected' : 'text-foreground'
                }`}
              >
                {v ?? '…'}
              </div>
            </div>
          );
        })}
      </div>

      <DataGrid<FieldAgentView>
        columns={columns}
        queryKey={QK}
        rowId={(a) => a.id}
        defaultSort="name"
        defaultSortOrder="asc"
        searchPlaceholder="Search agent name, username or phone…"
        fetchPage={(query: PageQuery) =>
          api<Paginated<FieldAgentView>>('GET', `${BASE}/agents?${pageQueryToParams(query).toString()}`)
        }
        exportFn={(req: ExportRequest) => apiExport(`${BASE}/export?${exportQueryToParams(req).toString()}`)}
        loadingLabel="Field Monitoring"
      />
    </div>
  );
}

/**
 * Address column: reverse-geocodes the coords to a frozen human address (ADR-0026), lazily per
 * visible row, keyed by the 6-dp coordinate (identical fixes dedupe; resolved once). Fixed-width +
 * truncated so a long address never stretches the table (full text on hover). The raw lat/lng + the
 * Maps link live in the separate Coordinates column. "—" until the field app feeds GPS / no key.
 */
function AddressCell({ lat, lng }: { lat: number | null; lng: number | null }) {
  const has = lat != null && lng != null;
  const key6 = has ? `${lat.toFixed(6)},${lng.toFixed(6)}` : '';
  const geo = useQuery({
    queryKey: ['geocode', key6],
    queryFn: () => api<ReverseGeocodeResult>('GET', `${GEO}/reverse?lat=${lat}&lng=${lng}`),
    enabled: has,
    staleTime: Infinity,
    retry: false,
  });
  if (!has) return <span className="text-muted-foreground/60">—</span>;
  const address = geo.data?.address ?? null;
  // Fixed cap so a long address truncates with an ellipsis instead of stretching the table;
  // the full text is on hover (title). Responsive: shrinks below the cap on narrow screens.
  return (
    <div className="max-w-[16rem] truncate text-xs text-muted-foreground" title={address ?? undefined}>
      {geo.isLoading ? '…' : (address ?? <span className="text-muted-foreground/60">—</span>)}
    </div>
  );
}

/**
 * "Request location" ping (ADR-0027): wake an agent via FCM + socket for a fresh fix. The roster
 * repaints live when the device replies (the `field-monitoring:location-updated` socket → invalidate).
 */
function RequestLocationCell({ agentId, agentName }: { agentId: string; agentName: string }) {
  const ping = useMutation({
    mutationFn: () => api<RequestLocationResult>('POST', `${BASE}/agents/${agentId}/request-location`),
    onSuccess: (r) =>
      toast.success(`Location requested from ${agentName}`, {
        description:
          r.tokensTargeted > 0
            ? `Pinged ${r.tokensTargeted} device(s) + socket`
            : 'Sent over socket (no registered device token yet)',
      }),
    onError: () => toast.error(`Couldn't reach ${agentName}`),
  });
  return (
    <Button
      variant="ghost"
      size="sm"
      className="whitespace-nowrap"
      onClick={() => ping.mutate()}
      loading={ping.isPending}
    >
      Request location
    </Button>
  );
}
