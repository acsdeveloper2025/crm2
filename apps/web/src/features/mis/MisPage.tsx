import { useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  exportQueryToParams,
  pageQueryToParams,
  type ExportRequest,
  type MisCell,
  type MisColumnMeta,
  type MisDataType,
  type MisReportTypeMeta,
  type MisRow,
  type MisSummary,
  type PageQuery,
  type Paginated,
} from '@crm2/sdk';
import { api, apiExport } from '../../lib/sdk.js';
import { formatDateTime } from '../../lib/format.js';
import { useAuth } from '../../lib/AuthContext.js';
import { DataGrid, type DataGridColumn } from '../../components/ui/data-grid/index.js';
import { Popover } from '../../components/ui/Popover.js';
import { Tabs } from '../../components/ui/Tabs.js';

/** A money column is billing.view-gated (rate/commission); it only appears in the catalog for holders. */
function isGroupable(c: MisColumnMeta): boolean {
  return !c.money && (c.dataType === 'TEXT' || c.dataType === 'SELECT');
}

function renderCell(v: MisCell, dt: MisDataType, money?: boolean): ReactNode {
  if (v === null || v === undefined || v === '') return <span className="text-muted-foreground">—</span>;
  if (dt === 'DATE') return formatDateTime(String(v));
  if (dt === 'BOOLEAN') return v ? 'Yes' : 'No';
  if (dt === 'NUMBER') {
    const n = typeof v === 'number' ? v : Number(v);
    const s = Number.isFinite(n) ? n.toLocaleString('en-IN') : String(v);
    return money ? `₹${s}` : s;
  }
  const s = String(v);
  return (
    <span className="block max-w-[260px] truncate" title={s}>
      {s}
    </span>
  );
}

const money = (v: number | null | undefined): string =>
  v === null || v === undefined ? '—' : `₹${v.toLocaleString('en-IN')}`;

export function MisPage() {
  const { user } = useAuth();
  const has = (perm: string): boolean =>
    !!user && (user.grantsAll === true || (user.permissions ?? []).includes(perm));

  const catalog = useQuery({
    queryKey: ['mis-report-types'],
    queryFn: () => api<MisReportTypeMeta[]>('GET', '/api/v2/mis/report-types'),
    enabled: has('mis.view'),
  });

  const [reportType, setReportType] = useState('');
  const [view, setView] = useState<'tabular' | 'summary'>('tabular');
  const [selectedByType, setSelectedByType] = useState<Record<string, string[]>>({});
  const [groupBy, setGroupBy] = useState('');

  if (!has('mis.view')) return <div className="text-destructive">You don&apos;t have access to MIS.</div>;

  const types = catalog.data ?? [];
  const activeType = types.find((t) => t.type === reportType) ?? types[0];

  if (catalog.isLoading) return <div className="text-muted-foreground">Loading MIS…</div>;
  if (catalog.isError) return <div className="text-destructive">Failed to load MIS report types.</div>;
  if (!activeType) return <div className="text-muted-foreground">No MIS report types are available.</div>;

  const defaultCols = activeType.columns.filter((c) => c.defaultVisible).map((c) => c.key);
  const selectedCols = selectedByType[activeType.type] ?? defaultCols;
  const setSelected = (next: string[]): void =>
    setSelectedByType((prev) => ({ ...prev, [activeType.type]: next }));
  const toggleCol = (key: string): void =>
    setSelected(selectedCols.includes(key) ? selectedCols.filter((k) => k !== key) : [...selectedCols, key]);

  const groupable = activeType.columns.filter(isGroupable);
  const activeGroup =
    groupBy && groupable.some((c) => c.key === groupBy)
      ? groupBy
      : (groupable.find((c) => c.key === 'clientName')?.key ?? groupable[0]?.key ?? '');
  const hasMoney = activeType.columns.some((c) => c.money);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-semibold">MIS</h1>
        <select
          className="input h-9 max-w-xs"
          aria-label="Report type"
          value={activeType.type}
          onChange={(e) => setReportType(e.target.value)}
        >
          {types.map((t) => (
            <option key={t.type} value={t.type}>
              {t.label}
            </option>
          ))}
        </select>
        <Tabs
          tabs={[
            { key: 'tabular', label: 'Tabular' },
            { key: 'summary', label: 'Summary' },
          ]}
          active={view}
          onChange={(k) => setView(k as 'tabular' | 'summary')}
        />
      </div>

      {view === 'tabular' ? (
        <TabularView
          type={activeType.type}
          columns={activeType.columns}
          selectedCols={selectedCols}
          defaultCols={defaultCols}
          onToggle={toggleCol}
          onSelectAll={() => setSelected(activeType.columns.map((c) => c.key))}
          onReset={() => setSelected(defaultCols)}
        />
      ) : (
        <SummaryView
          type={activeType.type}
          groupable={groupable}
          activeGroup={activeGroup}
          onGroupChange={setGroupBy}
          hasMoney={hasMoney}
        />
      )}
    </div>
  );
}

function TabularView({
  type,
  columns,
  selectedCols,
  defaultCols,
  onToggle,
  onSelectAll,
  onReset,
}: {
  type: string;
  columns: MisColumnMeta[];
  selectedCols: string[];
  defaultCols: string[];
  onToggle: (key: string) => void;
  onSelectAll: () => void;
  onReset: () => void;
}) {
  const gridColumns = useMemo<DataGridColumn<MisRow>[]>(
    () =>
      columns
        .filter((c) => selectedCols.includes(c.key))
        .map((c) => ({
          id: c.key,
          header: c.label,
          sortable: c.sortable,
          filterable: c.filterable,
          hideable: false,
          align: c.dataType === 'NUMBER' ? ('right' as const) : ('left' as const),
          cell: (row: MisRow) => renderCell(row[c.key] ?? null, c.dataType, c.money),
        })),
    [columns, selectedCols],
  );

  const grouped = useMemo(() => {
    const m = new Map<string, MisColumnMeta[]>();
    for (const c of columns) m.set(c.group, [...(m.get(c.group) ?? []), c]);
    return [...m.entries()];
  }, [columns]);

  const dateFilters = columns
    .filter((c) => c.dataType === 'DATE' && c.filterable && defaultCols.includes(c.key))
    .slice(0, 3)
    .map((c) => ({ id: c.key, label: c.label }));

  const fetchPage = (q: PageQuery): Promise<Paginated<MisRow>> => {
    const p = pageQueryToParams(q);
    p.set('cols', selectedCols.join(','));
    return api<Paginated<MisRow>>('GET', `/api/v2/mis/${encodeURIComponent(type)}/rows?${p.toString()}`);
  };

  return (
    <DataGrid<MisRow>
      columns={gridColumns}
      queryKey={`mis-rows-${type}-${selectedCols.join(',')}`}
      rowId={(r) => JSON.stringify(r)}
      fetchPage={fetchPage}
      searchPlaceholder="Search this report…"
      dateFilters={dateFilters}
      loadingLabel="MIS"
      exportFn={(req: ExportRequest) =>
        apiExport(`/api/v2/mis/${encodeURIComponent(type)}/export?${exportQueryToParams(req).toString()}`)
      }
      toolbar={
        <Popover
          label="Columns"
          panelLabel="Columns"
          trigger={<span>Columns</span>}
          align="start"
          panelClassName="w-[min(720px,85vw)]"
        >
          {/* Scroll lives on this inner container — the panel itself is `overflow-hidden` (rounded
              corners), so an `overflow-auto` there would be dropped by Tailwind and never scroll. */}
          <div className="max-h-[70vh] overflow-y-auto">
            <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-popover px-3 py-2 text-xs">
              <button type="button" className="text-primary" onClick={onSelectAll}>
                Select all
              </button>
              <button type="button" className="text-muted-foreground" onClick={onReset}>
                Reset
              </button>
              <span className="ml-auto text-muted-foreground">
                {selectedCols.length} of {columns.length} shown
              </span>
            </div>
            {/* Every field in the report, grouped, flowed into columns — the user keeps/removes any. */}
            <div className="gap-4 p-2 sm:columns-2 lg:columns-3">
              {grouped.map(([group, cols]) => (
                <div key={group} className="mb-3 break-inside-avoid">
                  <div className="mb-1 px-1 text-xs font-medium text-muted-foreground">{group}</div>
                  {cols.map((c) => (
                    <label
                      key={c.key}
                      className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm hover:bg-row-hover"
                    >
                      <input
                        type="checkbox"
                        checked={selectedCols.includes(c.key)}
                        onChange={() => onToggle(c.key)}
                      />
                      <span>{c.label}</span>
                    </label>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </Popover>
      }
    />
  );
}

function SummaryView({
  type,
  groupable,
  activeGroup,
  onGroupChange,
  hasMoney,
}: {
  type: string;
  groupable: MisColumnMeta[];
  activeGroup: string;
  onGroupChange: (key: string) => void;
  hasMoney: boolean;
}) {
  const groupLabel = groupable.find((c) => c.key === activeGroup)?.label ?? 'Group';
  const summary = useQuery({
    queryKey: ['mis-summary', type, activeGroup],
    queryFn: () =>
      api<MisSummary>(
        'GET',
        `/api/v2/mis/${encodeURIComponent(type)}/summary?group=${encodeURIComponent(activeGroup)}`,
      ),
    enabled: !!activeGroup,
  });

  const rows = summary.data?.rows ?? [];
  const grand = summary.data?.grandTotal;

  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">Group by</span>
        <select
          className="input h-9 max-w-xs"
          value={activeGroup}
          onChange={(e) => onGroupChange(e.target.value)}
        >
          {groupable.map((c) => (
            <option key={c.key} value={c.key}>
              {c.label}
            </option>
          ))}
        </select>
      </label>

      {summary.isLoading ? (
        <div className="text-muted-foreground">Loading summary…</div>
      ) : summary.isError ? (
        <div className="text-destructive">Failed to load the summary.</div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-muted-foreground">
                <th className="px-3 py-2 font-semibold">{groupLabel}</th>
                <th className="px-3 py-2 text-right font-semibold">Tasks</th>
                <th className="px-3 py-2 text-right font-semibold">Completed</th>
                <th className="px-3 py-2 text-right font-semibold">Positive</th>
                <th className="px-3 py-2 text-right font-semibold">Negative</th>
                <th className="px-3 py-2 text-right font-semibold">Refer</th>
                <th className="px-3 py-2 text-right font-semibold">Fraud</th>
                {hasMoney && <th className="px-3 py-2 text-right font-semibold">Bill ₹</th>}
                {hasMoney && <th className="px-3 py-2 text-right font-semibold">Commission ₹</th>}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td className="px-3 py-4 text-center text-muted-foreground" colSpan={hasMoney ? 9 : 7}>
                    No rows for this report.
                  </td>
                </tr>
              ) : (
                rows.map((r, i) => (
                  <tr key={i} className="border-t border-border hover:bg-row-hover">
                    <td className="px-3 py-2">{r.group === null ? '—' : String(r.group)}</td>
                    <td className="px-3 py-2 text-right">{r.count}</td>
                    <td className="px-3 py-2 text-right">{r.completed}</td>
                    <td className="px-3 py-2 text-right text-success">{r.positive}</td>
                    <td className="px-3 py-2 text-right text-destructive">{r.negative}</td>
                    <td className="px-3 py-2 text-right">{r.refer}</td>
                    <td className="px-3 py-2 text-right">{r.fraud}</td>
                    {hasMoney && <td className="px-3 py-2 text-right">{money(r.billTotal)}</td>}
                    {hasMoney && <td className="px-3 py-2 text-right">{money(r.commissionTotal)}</td>}
                  </tr>
                ))
              )}
            </tbody>
            {grand && rows.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-border font-semibold">
                  <td className="px-3 py-2">Total</td>
                  <td className="px-3 py-2 text-right">{grand.count}</td>
                  <td className="px-3 py-2 text-right">{grand.completed}</td>
                  <td className="px-3 py-2 text-right">{grand.positive}</td>
                  <td className="px-3 py-2 text-right">{grand.negative}</td>
                  <td className="px-3 py-2 text-right">{grand.refer}</td>
                  <td className="px-3 py-2 text-right">{grand.fraud}</td>
                  {hasMoney && <td className="px-3 py-2 text-right">{money(grand.billTotal)}</td>}
                  {hasMoney && <td className="px-3 py-2 text-right">{money(grand.commissionTotal)}</td>}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </div>
  );
}
