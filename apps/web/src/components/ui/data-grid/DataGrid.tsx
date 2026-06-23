import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
  type SortingState,
} from '@tanstack/react-table';
import {
  DEFAULT_PAGE_SIZE,
  PAGE_SIZES,
  type ExportFormat,
  type ExportMode,
  type ExportOutcome,
  type ExportRequest,
  type PageQuery,
  type Paginated,
  type SortOrder,
} from '@crm2/sdk';
import { useFocusTrap } from '../../../lib/useFocusTrap.js';
import { useLoadingBand } from '../../../lib/useLoadingBand.js';
import { HexagonLoader } from '../HexagonLoader.js';
import { Input } from '../Input.js';
import { Button } from '../Button.js';
import { DownloadIcon } from '../icons.js';
import { SavedViewsPicker } from './SavedViewsPicker.js';
import { validateDraft, firstError, type CellEditorKind, type EditableField } from './inline-edit.js';

/**
 * The Universal DataGrid (docs/DATAGRID_STANDARD.md) — the ONE table for the platform.
 * Foundation: TanStack Table (headless) + TanStack Query + URL state + the SDK pagination
 * envelope. This core covers server pagination/sorting/global-search, skeleton loading,
 * empty/error states, URL-state persistence, sticky header, the responsive table→card
 * view (it owns `.rtable` now that it's the table of record), and URL-persisted column
 * visibility (§9). Remaining advanced features (column/header filters · saved views ·
 * export · bulk actions) layer on top.
 */
export interface DataGridColumn<T> {
  /** stable id; also the `sortBy` key sent to the server when `sortable`. */
  id: string;
  header: string;
  cell: (row: T) => ReactNode;
  sortable?: boolean;
  /** mobile card label (defaults to `header`). */
  label?: string;
  align?: 'left' | 'right';
  /** show/hide in the Columns menu (DATAGRID_STANDARD §9). Default true; set false to pin always-visible. */
  hideable?: boolean;
  /** per-column server-side text filter (DATAGRID_STANDARD §6). The grid sends `f_<id>`; the
   *  endpoint's PageSpec.filterMap must whitelist `<id>` or the filter is ignored server-side. */
  filterable?: boolean;
  /** when set (with `filterable`), the header filter is an Excel-style multi-select (§7) of these
   *  options instead of a text input; selected values are sent comma-joined as `f_<id>` (→ IN). */
  filterOptions?: { value: string; label: string }[];
  // ── Inline editing (ADR-0051 — editable grid, no modal forms). Requires the grid's `inlineEdit`. ──
  /** Render this cell as an editor while its row is being edited. */
  editable?: boolean;
  /** Editor kind for an `editable` cell (default `text`). */
  editor?: CellEditorKind;
  /** Row property the editor reads/writes (also the draft key). Defaults to `id`. */
  field?: string;
  editorPlaceholder?: string;
  /** Block save while this field is blank. */
  required?: boolean;
  /** Inline validator → an error message, or null when valid. */
  validate?: (value: string) => string | null;
  /** Seed the editor from a row (e.g. to format a date). Defaults to `String(row[field] ?? '')`. */
  draftValue?: (row: T) => string;
  /** While the row is edited, render Save/Cancel here instead of `cell` (mark the actions column). */
  editAction?: boolean;
}

/**
 * The current selection handed to a page's `bulkActions` renderer (DATAGRID_STANDARD §15).
 * Either an explicit set (`allMatching: false`) or "every row matching the active query"
 * (`allMatching: true`, where `query` describes that set and `count` is the server total).
 */
export interface BulkSelection<T> {
  allMatching: boolean;
  /** Explicitly ticked row ids (ignored when `allMatching`). */
  ids: string[];
  /**
   * The ticked row objects (captured at selection time) — carries each row's `version`, so a bulk
   * mutation can do per-row OCC (CONCURRENCY_AND_EDITING_STANDARD §1). Empty when `allMatching`
   * (the off-page rows aren't loaded → a versioned bulk mutation can't target them; export still can).
   */
  rows: T[];
  /** `allMatching ? totalCount : ids.length`. */
  count: number;
  /** The active list query — lets an action target the whole matching set when `allMatching`. */
  query: PageQuery;
  /** Drop the selection (e.g. after the action completes). */
  clear: () => void;
}

export interface DataGridProps<T> {
  columns: DataGridColumn<T>[];
  /** Fetches one page from the resolved query (search/sort/page/limit + merged filters). */
  fetchPage: (q: PageQuery) => Promise<Paginated<T>>;
  /** react-query key root; the grid appends its URL state. */
  queryKey: string;
  rowId: (row: T) => string | number;
  /** extra domain filters merged into the query (page-controlled, e.g. status). */
  filters?: Record<string, string | boolean | undefined>;
  /** filter UI rendered in the toolbar. */
  toolbar?: ReactNode;
  searchPlaceholder?: string;
  /** Show the toolbar's global free-text search box (default true). Set false when an external
   *  search form is the sole query surface (e.g. the Dedupe Check identifier form). */
  searchable?: boolean;
  defaultSort?: string;
  defaultSortOrder?: SortOrder;
  /** optional row-click handler (e.g. navigate to a detail page); makes rows look clickable. */
  onRowClick?: (row: T) => void;
  /**
   * Date-range filters (a From/To pair per entry). Each sends `f_<id>_from` / `f_<id>_to`; the
   * endpoint's PageSpec.filterMap must whitelist `<id>` as a `kind:'date'` column. URL-synced and
   * honored by export (re-runs the same filtered query). e.g. `[{ id:'createdAt', label:'Created' }]`.
   */
  dateFilters?: { id: string; label: string }[];
  /**
   * DataGrid export (IMPORT_EXPORT_STANDARD §11). When provided, the toolbar shows an Export menu
   * (current view / all matching × XLSX/CSV). The grid sends the active list query + chosen
   * format/mode + visible column ids; the page wires this to the resource's `/export` endpoint.
   */
  exportFn?: (req: ExportRequest) => Promise<ExportOutcome>;
  /**
   * Operation label for the Hexagon loader's 3–8 s band (PAGINATION_AND_LOADING_STANDARDS §6).
   * Defaults to a title-cased `queryKey` (e.g. `verification-units` → "Verification Units").
   */
  loadingLabel?: string;
  /**
   * Enable row selection (DATAGRID_STANDARD §15): a leading checkbox column + select-all-on-page +
   * a "select all N matching" banner + the bulk-action bar. Selection is ephemeral — it clears when
   * the matched set changes (search/sort/filters) and accumulates across pages.
   */
  selectable?: boolean;
  /** Renders the bulk-action buttons in the selection bar, given the current selection. */
  bulkActions?: (selection: BulkSelection<T>) => ReactNode;
  /**
   * Master-detail row expansion (DATAGRID_STANDARD §20) — additive/opt-in. When provided, a leading
   * expander column (chevron) is shown and clicking a row (or its chevron) toggles an inline detail
   * row beneath it, rendered by this function. One row expands at a time; expansion is ephemeral and
   * resets when the matched set or page changes. Mutually exclusive with `onRowClick` for the
   * row-body click (the chevron always toggles); pass only one. Used by CPV (the unit manager).
   */
  renderExpanded?: (row: T) => ReactNode;
  /**
   * Inline editing (ADR-0051): click an `editable` cell to edit its row in place — Enter saves,
   * Escape cancels, the `editAction` column shows Save/Cancel. With `onCreate`, a "+ Add row" inserts
   * a blank editable row at the top. The PAGE implements persistence via its existing PUT/POST with
   * `version`, so the server still enforces scope/ownership + OCC — the grid is defense-in-depth UI
   * only. `onSave`/`onCreate` reject to keep edit mode and surface the message inline.
   */
  inlineEdit?: {
    version: (row: T) => number;
    onSave: (row: T, values: Record<string, string>, version: number) => Promise<void>;
    onCreate?: (values: Record<string, string>) => Promise<void>;
  };
}

const SEARCH_DEBOUNCE_MS = 300;
const SKELETON_ROWS = 8;

/** A single inline cell editor (ADR-0051). Enter commits the row, Escape cancels. */
function CellEditor({
  kind,
  value,
  placeholder,
  autoFocus,
  onChange,
  onSubmit,
  onCancel,
}: {
  kind: CellEditorKind;
  value: string;
  placeholder: string;
  autoFocus: boolean;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  return (
    <input
      className="input"
      type={kind === 'date' ? 'date' : 'text'}
      value={value}
      placeholder={placeholder}
      autoFocus={autoFocus}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          onSubmit();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          onCancel();
        }
      }}
    />
  );
}

/** Save/Cancel pair shown in the actions cell while a row is being edited inline. */
function EditActions({
  saving,
  onSave,
  onCancel,
}: {
  saving: boolean;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="flex items-center justify-end gap-2" onClick={(e) => e.stopPropagation()}>
      <Button variant="ghost" size="sm" onClick={onCancel} disabled={saving}>
        Cancel
      </Button>
      <Button size="sm" onClick={onSave} loading={saving}>
        Save
      </Button>
    </div>
  );
}

export function DataGrid<T>({
  columns,
  fetchPage,
  queryKey,
  rowId,
  filters,
  toolbar,
  searchPlaceholder = 'Search…',
  searchable = true,
  defaultSort,
  defaultSortOrder = 'asc',
  onRowClick,
  dateFilters,
  exportFn,
  loadingLabel,
  selectable,
  bulkActions,
  renderExpanded,
  inlineEdit,
}: DataGridProps<T>) {
  const [params, setParams] = useSearchParams();

  // ── URL state (search · sort · page · limit) — bookmarkable, survives refresh ──
  const search = params.get('q') ?? '';
  const sortBy = params.get('sort') ?? defaultSort ?? '';
  const dirParam = params.get('dir');
  const sortOrder: SortOrder = dirParam === 'desc' ? 'desc' : dirParam === 'asc' ? 'asc' : defaultSortOrder;
  const page = Math.max(1, Number(params.get('page') ?? '1') || 1);
  const limit = PAGE_SIZES.includes(Number(params.get('size')) as (typeof PAGE_SIZES)[number])
    ? Number(params.get('size'))
    : DEFAULT_PAGE_SIZE;

  const patch = (next: Record<string, string | null>, resetPage = true) => {
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(next)) {
          if (v === null || v === '') p.delete(k);
          else p.set(k, v);
        }
        if (resetPage && !('page' in next)) p.delete('page');
        return p;
      },
      { replace: true },
    );
  };

  // ── debounced global search ──
  const [searchInput, setSearchInput] = useState(search);
  useEffect(() => setSearchInput(search), [search]);
  useEffect(() => {
    if (searchInput === search) return;
    const t = setTimeout(() => patch({ q: searchInput || null }), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [searchInput]);

  // ── column visibility (DATAGRID_STANDARD §9) — hidden ids live in the `cols` URL key ──
  const hiddenIds = useMemo(() => {
    const ids = new Set((params.get('cols') ?? '').split(',').filter(Boolean));
    // Defensive: a tampered/stale URL that would hide EVERY column falls back to all-visible
    // (never render a blank table — the menu's last-visible guard covers the interactive path).
    if (columns.length > 0 && columns.every((c) => ids.has(c.id))) return new Set<string>();
    return ids;
  }, [params, columns]);
  const columnVisibility = useMemo(
    () => Object.fromEntries(columns.map((c) => [c.id, !hiddenIds.has(c.id)])),
    [columns, hiddenIds],
  );
  const visibleColumns = useMemo(() => columns.filter((c) => !hiddenIds.has(c.id)), [columns, hiddenIds]);
  const hideableColumns = useMemo(() => columns.filter((c) => c.hideable !== false), [columns]);
  const [menuOpen, setMenuOpen] = useState(false);
  const columnsMenuRef = useFocusTrap<HTMLDivElement>(menuOpen, () => setMenuOpen(false));
  const toggleColumn = (id: string) => {
    const next = new Set(hiddenIds);
    if (next.has(id)) next.delete(id);
    else if (visibleColumns.length > 1)
      next.add(id); // never hide the last visible column
    else return;
    patch({ cols: next.size ? [...next].join(',') : null }, false);
  };

  // ── per-column filters (DATAGRID_STANDARD §6) — each `f_<id>` URL key → request filter ──
  const hasFilterable = useMemo(() => columns.some((c) => c.filterable), [columns]);
  const columnFilters = useMemo(() => {
    const out: Record<string, string> = {};
    for (const c of columns) {
      if (!c.filterable) continue;
      const v = params.get(`f_${c.id}`);
      if (v) out[`f_${c.id}`] = v;
    }
    return out;
  }, [columns, params]);

  // ── date-range filters (§11) — each entry → `f_<id>_from` / `f_<id>_to` URL keys ──
  const dateFilterParams = useMemo(() => {
    const out: Record<string, string> = {};
    for (const d of dateFilters ?? []) {
      const from = params.get(`f_${d.id}_from`);
      const to = params.get(`f_${d.id}_to`);
      if (from) out[`f_${d.id}_from`] = from;
      if (to) out[`f_${d.id}_to`] = to;
    }
    return out;
  }, [dateFilters, params]);

  const mergedFilters = { ...(filters ?? {}), ...columnFilters, ...dateFilterParams };
  const filtersKey = JSON.stringify(mergedFilters);
  const queryInput: PageQuery = {
    page,
    limit,
    ...(search ? { search } : {}),
    ...(sortBy ? { sortBy, sortOrder } : {}),
    ...(Object.keys(mergedFilters).length ? { filters: mergedFilters } : {}),
  };

  // ── export (DATAGRID_STANDARD §11) — current view / all matching × XLSX/CSV ──
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [exporting, setExporting] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const qc = useQueryClient();
  const exportMenuRef = useFocusTrap<HTMLDivElement>(exportMenuOpen, () => setExportMenuOpen(false));
  const runExport = async (format: ExportFormat, mode: ExportMode, ids?: string[]) => {
    if (!exportFn) return;
    setExportError(null);
    setExporting(`${mode}:${format}`);
    setExportMenuOpen(false);
    try {
      const req: ExportRequest = {
        format,
        mode,
        cols: visibleColumns.map((c) => c.id),
        ...(search ? { search } : {}),
        ...(sortBy ? { sortBy, sortOrder } : {}),
        ...(Object.keys(mergedFilters).length ? { filters: mergedFilters } : {}),
        // `current` exports the exact page; `all`/`selected` drop the page window.
        ...(mode === 'current' ? { page, limit } : {}),
        ...(mode === 'selected' && ids && ids.length ? { ids } : {}),
      };
      const out = await exportFn(req);
      if (out.kind === 'job') {
        // ≥ threshold → background job (ADR-0030). Surface it in the Jobs tray immediately; the user
        // keeps working and is notified (bell + tray Download) when it's ready.
        void qc.invalidateQueries({ queryKey: ['jobs'] });
        toast('Export started in the background', {
          description: "You can keep working — we'll notify you when it's ready to download.",
        });
        return;
      }
      const url = URL.createObjectURL(out.blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = out.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      const code = (e as { code?: string }).code;
      setExportError(
        code === 'EXPORT_TOO_LARGE'
          ? 'Too many rows for a direct export — refine your filters (background export coming soon).'
          : 'Export failed. Please try again.',
      );
    } finally {
      setExporting(null);
    }
  };

  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: [queryKey, { search, sortBy, sortOrder, page, limit, filtersKey }],
    queryFn: () => fetchPage(queryInput),
    placeholderData: keepPreviousData,
  });

  const items = useMemo(() => data?.items ?? [], [data]);
  const byId = useMemo(() => new Map(columns.map((c) => [c.id, c])), [columns]);

  // ── Inline editing (ADR-0051) — opt-in via `inlineEdit`. Click an editable cell to edit its row;
  // the page persists via its existing PUT/POST + `version` (server enforces scope/ownership + OCC). ──
  const editFields = useMemo<EditableField[]>(
    () =>
      columns
        .filter((c) => c.editable)
        .map((c) => ({
          field: c.field ?? c.id,
          editor: c.editor ?? 'text',
          ...(c.required ? { required: true } : {}),
          ...(c.validate ? { validate: c.validate } : {}),
        })),
    [columns],
  );
  const firstEditableId = useMemo(() => columns.find((c) => c.editable)?.id, [columns]);
  const [editId, setEditId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [editError, setEditError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const isEditingRow = (id: string) => editId === id && !creating;
  const cellKey = (c: DataGridColumn<T>) => c.field ?? c.id;

  const seedDraft = (row: T): Record<string, string> => {
    const d: Record<string, string> = {};
    for (const c of columns) {
      if (!c.editable) continue;
      const f = cellKey(c);
      d[f] = c.draftValue ? c.draftValue(row) : String((row as Record<string, unknown>)[f] ?? '');
    }
    return d;
  };
  const resetEdit = () => {
    setEditId(null);
    setCreating(false);
    setDraft({});
    setEditError(null);
    setSaving(false);
  };
  const startEdit = (row: T) => {
    if (saving) return;
    setCreating(false);
    setEditId(String(rowId(row)));
    setDraft(seedDraft(row));
    setEditError(null);
  };
  const startCreate = () => {
    setEditId(null);
    setCreating(true);
    setDraft(Object.fromEntries(columns.filter((c) => c.editable).map((c) => [cellKey(c), ''])));
    setEditError(null);
  };
  const setField = (field: string, value: string) => setDraft((d) => ({ ...d, [field]: value }));
  const submitEdit = async () => {
    if (saving || !inlineEdit) return;
    const msg = firstError(validateDraft(draft, editFields));
    if (msg) {
      setEditError(msg);
      return;
    }
    const row = creating ? null : items.find((r) => String(rowId(r)) === editId);
    setSaving(true);
    setEditError(null);
    try {
      if (creating && inlineEdit.onCreate) await inlineEdit.onCreate(draft);
      else if (row) await inlineEdit.onSave(row, draft, inlineEdit.version(row));
      resetEdit();
    } catch (e) {
      setSaving(false);
      setEditError(e instanceof Error ? e.message : 'Save failed');
    }
  };

  const columnHelper = createColumnHelper<T>();
  // Display-only columns: the table model just tracks id/header/visibility/sort — the cell body is
  // rendered directly from `col.cell(row.original)` in the tbody (DataGridColumn.cell is `(row)=>ReactNode`
  // and never reads TanStack cell-context). Going through `flexRender` would wrap each arrow as an
  // anonymous synthetic component, which churns/remounts on every Fast-Refresh and throws transiently
  // for hook-bearing cells — avoided entirely by rendering the node inline.
  const tableColumns = useMemo(
    () => columns.map((c) => columnHelper.display({ id: c.id, header: c.header })),
    [columns],
  );
  const sorting: SortingState = sortBy ? [{ id: sortBy, desc: sortOrder === 'desc' }] : [];
  const table = useReactTable({
    data: items,
    columns: tableColumns,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    manualSorting: true,
    manualFiltering: true,
    pageCount: data?.totalPages ?? 0,
    getRowId: (row) => String(rowId(row)),
    state: { sorting, columnVisibility },
  });

  const toggleSort = (col: DataGridColumn<T>) => {
    if (!col.sortable) return;
    if (sortBy === col.id) patch({ dir: sortOrder === 'asc' ? 'desc' : 'asc' }, false);
    else patch({ sort: col.id, dir: 'asc' }, false);
  };

  const totalCount = data?.totalCount ?? 0;
  const totalPages = data?.totalPages ?? 0;

  // ── row selection + bulk actions (DATAGRID_STANDARD §15) ──
  // Ephemeral: clears when the matched set changes (search/sort/filters); accumulates across pages.
  // `allMatching` is the "select all N matching" mode (the only safe way to act on >1 page at scale —
  // we never hold every id client-side; an action reads `query` instead).
  // Selected ROW OBJECTS keyed by id (not just ids) — captures each row's `version` at tick time so
  // a bulk mutation can do per-row OCC; export only needs the ids/keys.
  const [selectedRows, setSelectedRows] = useState<Map<string, T>>(new Map());
  const [allMatching, setAllMatching] = useState(false);
  useEffect(() => {
    setSelectedRows(new Map());
    setAllMatching(false);
  }, [search, sortBy, sortOrder, filtersKey]);
  const pageIds = useMemo(() => items.map((r) => String(rowId(r))), [items, rowId]);
  const allPageSelected = pageIds.length > 0 && pageIds.every((id) => selectedRows.has(id));
  const somePageSelected = pageIds.some((id) => selectedRows.has(id));
  const selectedCount = allMatching ? totalCount : selectedRows.size;
  const clearSelection = () => {
    setSelectedRows(new Map());
    setAllMatching(false);
  };
  const toggleRow = (row: T) => {
    const id = String(rowId(row));
    setAllMatching(false);
    setSelectedRows((prev) => {
      const next = new Map(prev);
      if (next.has(id)) next.delete(id);
      else next.set(id, row);
      return next;
    });
  };
  const togglePage = () => {
    setAllMatching(false);
    setSelectedRows((prev) => {
      const next = new Map(prev);
      if (allPageSelected) pageIds.forEach((id) => next.delete(id));
      else items.forEach((r) => next.set(String(rowId(r)), r));
      return next;
    });
  };
  const showBulkBar = !!selectable && selectedCount > 0;
  const bulkSelection: BulkSelection<T> = {
    allMatching,
    ids: [...selectedRows.keys()],
    rows: [...selectedRows.values()],
    count: selectedCount,
    query: queryInput,
    clear: clearSelection,
  };
  // ── master-detail row expansion (DATAGRID_STANDARD §20) — one row open at a time, ephemeral.
  // Resets when the matched set OR page changes (the expanded row may leave the viewport).
  const [expandedId, setExpandedId] = useState<string | null>(null);
  useEffect(() => setExpandedId(null), [search, sortBy, sortOrder, filtersKey, page, limit]);
  const toggleExpand = (id: string) => setExpandedId((prev) => (prev === id ? null : id));

  const colCount = visibleColumns.length + (selectable ? 1 : 0) + (renderExpanded ? 1 : 0);
  // Built-in bulk export: "select all N matching" → the `all` query; an explicit tick set → `selected`.
  const exportSelection = (format: ExportFormat) =>
    void (allMatching ? runExport(format, 'all') : runExport(format, 'selected', [...selectedRows.keys()]));
  // Loading-experience time bands (PAGINATION_AND_LOADING_STANDARDS §6): 0–300 ms nothing,
  // 300 ms–1 s skeleton, 1 s+ Hexagon loader (+ operation text from 3 s). Only the FIRST load
  // (isLoading, no placeholder rows) — refetches keep prior rows + the "Updating…" hint.
  const band = useLoadingBand(isLoading);
  // Also gate on isLoading: when a load resolves, isLoading flips false one render before the
  // band effect resets to 'none', so a stale 'skeleton'/'loader' band must not co-render with rows.
  const showSkeleton = isLoading && band === 'skeleton';
  const showLoader = isLoading && (band === 'loader' || band === 'loader-op');
  const loadingOperation = `Loading ${
    loadingLabel ?? queryKey.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  }`;

  return (
    <div className="space-y-3">
      {/* Toolbar: global search + page-controlled filters + page size */}
      <div className="flex flex-wrap items-center gap-2">
        {searchable && (
          <Input
            uppercase={false}
            className="input max-w-xs"
            placeholder={searchPlaceholder}
            aria-label="Search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
        )}
        {toolbar}
        {/* flex-wrap so the export+columns+rows group wraps instead of overflowing a phone (gate 49)
            when a grid carries the full toolbar (e.g. with an Export menu). */}
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          {isFetching && !isLoading && (
            <span className="text-xs text-muted-foreground" aria-live="polite">
              Updating…
            </span>
          )}
          {inlineEdit?.onCreate && (
            <Button size="sm" onClick={startCreate} disabled={creating}>
              + Add row
            </Button>
          )}
          {/* Saved views (§10, B-5) — per-user named snapshots of this grid's URL-state. */}
          <SavedViewsPicker resourceKey={queryKey} />
          {exportFn && (
            <div className="relative">
              <Button
                variant="secondary"
                size="sm"
                aria-haspopup="menu"
                aria-expanded={exportMenuOpen}
                loading={!!exporting}
                onClick={() => setExportMenuOpen((o) => !o)}
              >
                <DownloadIcon />
                Export
              </Button>
              {exportMenuOpen && (
                <>
                  <button
                    type="button"
                    aria-hidden="true"
                    tabIndex={-1}
                    className="fixed inset-0 z-20 cursor-default"
                    onClick={() => setExportMenuOpen(false)}
                  />
                  <div
                    ref={exportMenuRef}
                    role="menu"
                    aria-label="Export"
                    className="absolute right-0 z-30 mt-1 w-56 rounded-md border border-border bg-card p-1 text-sm shadow-md"
                  >
                    <p className="px-2 pb-1 pt-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Current view
                    </p>
                    <button
                      role="menuitem"
                      className="block w-full rounded px-2 py-1.5 text-left hover:bg-row-hover"
                      onClick={() => void runExport('xlsx', 'current')}
                    >
                      Export as Excel (XLSX)
                    </button>
                    <button
                      role="menuitem"
                      className="block w-full rounded px-2 py-1.5 text-left hover:bg-row-hover"
                      onClick={() => void runExport('csv', 'current')}
                    >
                      Export as CSV
                    </button>
                    <p className="px-2 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      All matching rows
                    </p>
                    <button
                      role="menuitem"
                      className="block w-full rounded px-2 py-1.5 text-left hover:bg-row-hover"
                      onClick={() => void runExport('xlsx', 'all')}
                    >
                      Export as Excel (XLSX)
                    </button>
                    <button
                      role="menuitem"
                      className="block w-full rounded px-2 py-1.5 text-left hover:bg-row-hover"
                      onClick={() => void runExport('csv', 'all')}
                    >
                      Export as CSV
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
          {hideableColumns.length > 0 && (
            <div className="relative">
              <Button
                variant="ghost"
                size="sm"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen((o) => !o)}
              >
                Columns
              </Button>
              {menuOpen && (
                <>
                  {/* click-outside backdrop */}
                  <button
                    type="button"
                    aria-hidden="true"
                    tabIndex={-1}
                    className="fixed inset-0 z-20 cursor-default"
                    onClick={() => setMenuOpen(false)}
                  />
                  <div
                    ref={columnsMenuRef}
                    role="menu"
                    aria-label="Toggle columns"
                    className="absolute right-0 z-30 mt-1 max-h-72 w-52 overflow-auto rounded-md border border-border bg-card p-1 shadow-md"
                  >
                    {hideableColumns.map((c) => (
                      <label
                        key={c.id}
                        className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-row-hover"
                      >
                        <input
                          type="checkbox"
                          checked={!hiddenIds.has(c.id)}
                          onChange={() => toggleColumn(c.id)}
                          aria-label={c.label ?? c.header}
                        />
                        <span>{c.label ?? c.header}</span>
                      </label>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
          <label className="flex items-center gap-1 text-xs text-muted-foreground">
            <span>Rows</span>
            <select
              className="input w-[5rem]"
              aria-label="Rows per page"
              value={String(limit)}
              onChange={(e) => patch({ size: e.target.value })}
            >
              {PAGE_SIZES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {/* Date-range filters (§11) — narrow the list (and any export) to a From/To window.
          Inputs cap at 42vw so two side-by-side never overflow a narrow phone (responsive gate 49-50). */}
      {dateFilters && dateFilters.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
          {dateFilters.map((d) => (
            <div key={d.id} className="flex flex-wrap items-center gap-1.5">
              <span className="font-medium uppercase tracking-wide">{d.label}</span>
              <input
                type="date"
                className="input h-7 w-[8.5rem] max-w-[42vw]"
                aria-label={`${d.label} from`}
                value={params.get(`f_${d.id}_from`) ?? ''}
                max={params.get(`f_${d.id}_to`) ?? undefined}
                onChange={(e) => patch({ [`f_${d.id}_from`]: e.target.value || null })}
              />
              <span aria-hidden="true">–</span>
              <input
                type="date"
                className="input h-7 w-[8.5rem] max-w-[42vw]"
                aria-label={`${d.label} to`}
                value={params.get(`f_${d.id}_to`) ?? ''}
                min={params.get(`f_${d.id}_from`) ?? undefined}
                onChange={(e) => patch({ [`f_${d.id}_to`]: e.target.value || null })}
              />
            </div>
          ))}
        </div>
      )}

      {exportError && (
        <p className="text-sm text-destructive" role="alert">
          {exportError}
        </p>
      )}

      {/* Bulk-action bar (DATAGRID_STANDARD §15) — shown only while rows are selected. */}
      {showBulkBar && (
        <div
          role="region"
          aria-label="Bulk actions"
          className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-border bg-surface-muted px-3 py-2 text-sm"
        >
          <span className="font-medium text-foreground" aria-live="polite">
            {selectedCount} selected
          </span>
          {allPageSelected && !allMatching && totalCount > pageIds.length && (
            <Button variant="link" size="sm" className="font-medium" onClick={() => setAllMatching(true)}>
              Select all {totalCount} matching
            </Button>
          )}
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {bulkActions?.(bulkSelection)}
            {exportFn && (
              <>
                <Button
                  variant="secondary"
                  size="sm"
                  loading={!!exporting}
                  onClick={() => exportSelection('xlsx')}
                >
                  <DownloadIcon />
                  Export XLSX
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={!!exporting}
                  onClick={() => exportSelection('csv')}
                >
                  <DownloadIcon />
                  CSV
                </Button>
              </>
            )}
            <Button variant="ghost" size="sm" onClick={clearSelection}>
              Clear
            </Button>
          </div>
        </div>
      )}

      {/* Table — tabIndex=0 gives the horizontal-scroll region keyboard access (axe
          scrollable-region-focusable) for grids wide enough to overflow (e.g. Commission Rates). */}
      <div
        className="overflow-x-auto rounded-lg border border-border bg-card shadow-sm"
        tabIndex={0}
        role="group"
        aria-label="Table (scroll horizontally)"
      >
        <table className="rtable w-full text-sm">
          <thead className="sticky top-0 z-10 bg-surface-muted text-left text-xs uppercase tracking-wide text-muted-foreground">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {renderExpanded && <th className="w-8 px-2 py-2" aria-label="Expand" />}
                {selectable && (
                  <th className="w-10 px-3 py-2">
                    <input
                      type="checkbox"
                      aria-label="Select all rows on this page"
                      checked={allMatching || allPageSelected}
                      ref={(el) => {
                        if (el) el.indeterminate = !allMatching && !allPageSelected && somePageSelected;
                      }}
                      onChange={togglePage}
                    />
                  </th>
                )}
                {hg.headers.map((h) => {
                  const col = byId.get(h.column.id);
                  const sorted = sortBy === h.column.id;
                  return (
                    <th
                      key={h.id}
                      className={`px-3 py-2 font-semibold ${col?.align === 'right' ? 'text-right' : ''} ${
                        col?.sortable ? 'cursor-pointer select-none hover:text-foreground' : ''
                      }`}
                      onClick={() => col && toggleSort(col)}
                      aria-sort={sorted ? (sortOrder === 'asc' ? 'ascending' : 'descending') : undefined}
                    >
                      {flexRender(h.column.columnDef.header, h.getContext())}
                      {col?.sortable && (
                        <span className="ml-1">{sorted ? (sortOrder === 'asc' ? '▲' : '▼') : '↕'}</span>
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
            {/* Per-column filter row (§6) — aligns with the visible headers above. */}
            {hasFilterable && (
              <tr className="border-t border-border">
                {renderExpanded && <th className="w-8 px-2 pb-2" />}
                {selectable && <th className="w-10 px-3 pb-2" />}
                {visibleColumns.map((c) => (
                  <th key={c.id} className="px-3 pb-2 font-normal normal-case">
                    {c.filterable &&
                      (c.filterOptions ? (
                        <ColumnFilterSelect
                          value={params.get(`f_${c.id}`) ?? ''}
                          label={c.label ?? c.header}
                          options={c.filterOptions}
                          onCommit={(v) => patch({ [`f_${c.id}`]: v || null })}
                        />
                      ) : (
                        <ColumnFilterInput
                          value={params.get(`f_${c.id}`) ?? ''}
                          label={c.label ?? c.header}
                          onCommit={(v) => patch({ [`f_${c.id}`]: v || null })}
                        />
                      ))}
                  </th>
                ))}
              </tr>
            )}
          </thead>
          <tbody>
            {showSkeleton &&
              Array.from({ length: SKELETON_ROWS }).map((_, i) => (
                <tr key={`sk-${i}`} className="border-t border-border">
                  {renderExpanded && <td data-label="" className="px-2 py-2.5" />}
                  {selectable && <td data-label="" className="px-3 py-2.5" />}
                  {visibleColumns.map((c) => (
                    <td key={c.id} data-label={c.label ?? c.header} className="px-3 py-2.5">
                      <span className="block h-3 w-2/3 animate-pulse rounded bg-muted" />
                    </td>
                  ))}
                </tr>
              ))}

            {showLoader && (
              <tr>
                <td colSpan={colCount} className="px-3">
                  <HexagonLoader {...(band === 'loader-op' ? { operation: loadingOperation } : {})} />
                </td>
              </tr>
            )}

            {!isLoading && isError && (
              <tr>
                <td colSpan={colCount} className="px-3 py-8 text-center text-destructive">
                  Failed to load.{' '}
                  <Button
                    variant="link"
                    size="sm"
                    className="font-medium underline"
                    onClick={() => void refetch()}
                  >
                    Retry
                  </Button>
                </td>
              </tr>
            )}

            {!isLoading && !isError && items.length === 0 && !creating && (
              <tr>
                <td colSpan={colCount} className="px-3 py-8 text-center text-muted-foreground">
                  No records. Adjust your search or filters.
                </td>
              </tr>
            )}

            {inlineEdit && creating && (
              <Fragment>
                <tr className="border-t border-border bg-accent/40">
                  {renderExpanded && <td data-label="" className="px-2 py-2" />}
                  {selectable && <td data-label="" className="px-3 py-2" />}
                  {visibleColumns.map((c) => (
                    <td
                      key={c.id}
                      data-label={c.label ?? c.header}
                      className={`px-3 py-2 ${c.align === 'right' ? 'text-right' : ''}`}
                    >
                      {c.editable ? (
                        <CellEditor
                          kind={c.editor ?? 'text'}
                          value={draft[cellKey(c)] ?? ''}
                          placeholder={c.editorPlaceholder ?? ''}
                          autoFocus={c.id === firstEditableId}
                          onChange={(v) => setField(cellKey(c), v)}
                          onSubmit={() => void submitEdit()}
                          onCancel={resetEdit}
                        />
                      ) : c.editAction ? (
                        <EditActions saving={saving} onSave={() => void submitEdit()} onCancel={resetEdit} />
                      ) : null}
                    </td>
                  ))}
                </tr>
                {editError && (
                  <tr>
                    <td colSpan={colCount} className="px-3 pb-2 text-sm text-destructive">
                      {editError}
                    </td>
                  </tr>
                )}
              </Fragment>
            )}

            {!isLoading &&
              !isError &&
              table.getRowModel().rows.map((row) => {
                const expanded = renderExpanded ? expandedId === row.id : false;
                const rowClickable = !!onRowClick || !!renderExpanded;
                return (
                  <Fragment key={row.id}>
                    <tr
                      className={`border-t border-border transition-colors ${
                        expanded ? 'bg-accent hover:bg-accent' : 'hover:bg-row-hover'
                      } ${rowClickable ? 'cursor-pointer' : ''}`}
                      onClick={
                        onRowClick
                          ? () => onRowClick(row.original)
                          : renderExpanded
                            ? () => toggleExpand(row.id)
                            : undefined
                      }
                    >
                      {renderExpanded && (
                        <td data-label="" className="px-2 py-2" onClick={(e) => e.stopPropagation()}>
                          <button
                            type="button"
                            className="text-muted-foreground hover:text-foreground"
                            aria-label={expanded ? 'Collapse row' : 'Expand row'}
                            aria-expanded={expanded}
                            onClick={() => toggleExpand(row.id)}
                          >
                            {expanded ? '▾' : '▸'}
                          </button>
                        </td>
                      )}
                      {selectable && (
                        <td data-label="" className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            aria-label="Select row"
                            checked={allMatching || selectedRows.has(row.id)}
                            onChange={() => toggleRow(row.original)}
                          />
                        </td>
                      )}
                      {row.getVisibleCells().map((cell) => {
                        const col = byId.get(cell.column.id);
                        const editingThis = !!inlineEdit && isEditingRow(row.id);
                        const clickToEdit = !!inlineEdit && !editId && !creating && !!col?.editable;
                        return (
                          <td
                            key={cell.id}
                            data-label={col?.label ?? col?.header ?? cell.column.id}
                            className={`px-3 py-2 ${col?.align === 'right' ? 'text-right' : ''} ${
                              clickToEdit ? 'cursor-text' : ''
                            }`}
                            onClick={
                              clickToEdit
                                ? (e) => {
                                    e.stopPropagation();
                                    startEdit(row.original);
                                  }
                                : undefined
                            }
                          >
                            {editingThis && col?.editable ? (
                              <CellEditor
                                kind={col.editor ?? 'text'}
                                value={draft[cellKey(col)] ?? ''}
                                placeholder={col.editorPlaceholder ?? ''}
                                autoFocus={col.id === firstEditableId}
                                onChange={(v) => setField(cellKey(col), v)}
                                onSubmit={() => void submitEdit()}
                                onCancel={resetEdit}
                              />
                            ) : editingThis && col?.editAction ? (
                              <EditActions
                                saving={saving}
                                onSave={() => void submitEdit()}
                                onCancel={resetEdit}
                              />
                            ) : (
                              col?.cell(row.original)
                            )}
                          </td>
                        );
                      })}
                    </tr>
                    {isEditingRow(row.id) && editError && (
                      <tr>
                        <td colSpan={colCount} className="px-3 pb-2 text-sm text-destructive">
                          {editError}
                        </td>
                      </tr>
                    )}
                    {expanded && renderExpanded && (
                      <tr className="border-t border-border bg-surface-muted/40">
                        <td colSpan={colCount} className="px-3 py-3">
                          {renderExpanded(row.original)}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
          </tbody>
        </table>
      </div>

      {/* Pager */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="text-muted-foreground">
          {totalCount === 0
            ? 'No rows'
            : `${totalCount} row${totalCount === 1 ? '' : 's'} · Page ${page} of ${Math.max(1, totalPages)}`}
        </span>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            disabled={page <= 1 || isLoading}
            onClick={() => patch({ page: String(page - 1) }, false)}
          >
            Previous
          </Button>
          <Button
            variant="ghost"
            disabled={page >= totalPages || isLoading}
            onClick={() => patch({ page: String(page + 1) }, false)}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * Debounced per-column filter input (§6). Holds a local draft, commits to the URL after the
 * debounce, and re-syncs when the URL value changes externally (back button / saved view).
 */
function ColumnFilterInput({
  value,
  label,
  onCommit,
}: {
  value: string;
  label: string;
  onCommit: (next: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  useEffect(() => {
    if (draft === value) return;
    const t = setTimeout(() => onCommit(draft), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [draft]);
  return (
    <Input
      uppercase={false}
      className="input h-7 w-full min-w-[6rem] text-xs"
      placeholder="Filter…"
      aria-label={`Filter ${label}`}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
    />
  );
}

/**
 * Excel-style multi-select header filter (§7). Selected values are committed comma-joined to the
 * `f_<id>` URL key (the server applies them as `IN`). Options come from the column's static enum.
 */
function ColumnFilterSelect({
  value,
  label,
  options,
  onCommit,
}: {
  value: string;
  label: string;
  options: { value: string; label: string }[];
  onCommit: (next: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useFocusTrap<HTMLDivElement>(open, () => setOpen(false));
  const selected = new Set(value ? value.split(',') : []);
  const toggle = (v: string) => {
    const next = new Set(selected);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    onCommit([...next].join(','));
  };
  return (
    <div className="relative">
      <button
        type="button"
        className="input flex h-7 w-full min-w-[6rem] items-center justify-between text-xs normal-case"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Filter ${label}`}
        onClick={() => setOpen((o) => !o)}
      >
        <span>{selected.size ? `${selected.size} selected` : 'All'}</span>
        <span aria-hidden="true">▾</span>
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
            aria-label={`${label} options`}
            className="absolute left-0 z-30 mt-1 max-h-60 w-44 overflow-auto rounded-md border border-border bg-card p-1 shadow-md"
          >
            {options.map((o) => (
              <label
                key={o.value}
                className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs normal-case hover:bg-row-hover"
              >
                <input
                  type="checkbox"
                  checked={selected.has(o.value)}
                  onChange={() => toggle(o.value)}
                  aria-label={o.label}
                />
                <span>{o.label}</span>
              </label>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
