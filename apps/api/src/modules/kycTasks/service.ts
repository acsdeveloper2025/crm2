import type { KycAttachment, KycQueueState, KycTaskRow, Paginated } from '@crm2/sdk';
import { KYC_QUEUE_STATES } from '@crm2/sdk';
import { AppError } from '../../platform/errors.js';
import { getStorage } from '../../platform/storage/index.js';
import {
  resolvePage,
  resolveFilters,
  buildPage,
  type FilterField,
  type PageSpec,
} from '../../platform/pagination.js';
import { resolveScope, type Actor } from '../../platform/scope/index.js';
import { assertExportable, type ExportColumn, type ResolvedExport } from '../../platform/export/index.js';
import { neutralizeFormula } from '../../platform/export/format.js';
import { KYC_QUEUE_COLUMNS, KYC_QUEUE_COLUMNS_BY_KEY, type KycQueueColumn } from './columns.js';
import { kycTasksRepository as repo } from './repository.js';

/**
 * KYC-queue service (ADR-0085, MIS validation pattern): strict, fail-closed request handling —
 * unknown state / column / sort key → 400, never silently defaulted or interpolated.
 */

const filterKindFor = (c: KycQueueColumn): FilterField['kind'] =>
  c.filterKind ?? (c.dataType === 'DATE' ? 'date' : 'text');

function parseState(raw: unknown): KycQueueState {
  const state = typeof raw === 'string' ? raw.trim() : '';
  if (!(KYC_QUEUE_STATES as readonly string[]).includes(state))
    throw AppError.badRequest('UNKNOWN_KYC_QUEUE_STATE', { state });
  return state as KycQueueState;
}

export function resolveColumns(rawCols: unknown): KycQueueColumn[] {
  const raw = typeof rawCols === 'string' ? rawCols : '';
  if (raw.trim()) {
    const seen = new Set<string>();
    const columns = raw
      .split(',')
      .map((k) => k.trim())
      .filter(Boolean)
      .map((k) => {
        if (seen.has(k)) throw AppError.badRequest('DUPLICATE_KYC_QUEUE_COLUMN', { column: k });
        seen.add(k);
        const c = KYC_QUEUE_COLUMNS_BY_KEY.get(k);
        if (!c) throw AppError.badRequest('UNKNOWN_KYC_QUEUE_COLUMN', { column: k });
        return c;
      });
    if (columns.length) return columns;
  }
  return KYC_QUEUE_COLUMNS.filter((c) => c.defaultVisible);
}

export const kycTasksService = {
  async list(rawQuery: Record<string, unknown>, actor: Actor): Promise<Paginated<KycTaskRow>> {
    const state = parseState(rawQuery['state']);
    const columns = resolveColumns(rawQuery['cols']);

    const sortMap: Record<string, string> = {};
    const filterMap: Record<string, FilterField> = {};
    for (const c of KYC_QUEUE_COLUMNS) {
      if (c.sortable) sortMap[c.key] = c.sql;
      if (c.filterable) filterMap[c.key] = { column: c.sql, kind: filterKindFor(c) };
    }
    const sortBy = rawQuery['sortBy'];
    if (typeof sortBy === 'string' && sortBy.trim() && !(sortBy in sortMap))
      throw AppError.badRequest('UNKNOWN_KYC_QUEUE_SORT', { sortBy });

    const spec: PageSpec = {
      sortMap,
      filterMap,
      // The work list reads newest-assigned first; the done list newest-exported first.
      defaultSort: state === 'TO_EXPORT' ? 'assignedAt' : 'exportedAt',
      defaultOrder: 'desc',
    };
    const r = resolvePage(rawQuery, spec);
    const filters = resolveFilters(rawQuery, spec);
    const scope = await resolveScope(actor);

    const { items, totalCount } = await repo.rows({
      state,
      columns,
      filters,
      scope,
      sortColumn: r.sortColumn,
      sortOrder: r.sortOrder,
      limit: r.limit,
      offset: r.offset,
    });
    return buildPage(items, totalCount, r);
  },

  /** Reference attachments on the verifier's OWN KYC task (ADR-0085) — scoped to a task assigned to
   *  him; an out-of-scope taskId returns [] (never leaks another verifier's docs). */
  async listAttachments(taskId: string, actor: Actor): Promise<KycAttachment[]> {
    return repo.taskAttachments(taskId, await resolveScope(actor));
  },

  /** A presigned download URL for ONE attachment on the actor's own task (same scope guard). An
   *  out-of-scope task / mismatched id → 404 (IDOR-safe). */
  async attachmentUrl(taskId: string, attachmentId: string, actor: Actor): Promise<{ url: string }> {
    const key = await repo.attachmentStorageKey(taskId, attachmentId, await resolveScope(actor));
    if (!key) throw AppError.notFound('ATTACHMENT_NOT_FOUND');
    return { url: await getStorage().signedUrl(key) };
  },

  /**
   * Export = the CLAIM action (ADR-0085). First export: insert first-export events for the matching
   * TO_EXPORT rows (atomic; concurrent duplicates lose at the DB) and stream exactly the claimed
   * rows — nothing claimed → 409 ALREADY_EXPORTED. Re-export (`reexportReason` present): explicit,
   * `mode=selected` only, appends reasoned events for already-exported rows (all-or-nothing).
   * The `documentDetails` map is spread into ONE FILE COLUMN PER LABEL (never one flattened cell);
   * labels are operator data → header strings only, through the formula guard.
   */
  async exportData(
    rawQuery: Record<string, unknown>,
    ex: ResolvedExport,
    actor: Actor,
  ): Promise<{ rows: KycTaskRow[]; columns: ExportColumn<KycTaskRow>[]; exportNo: number }> {
    const scope = await resolveScope(actor);
    const reasonRaw = rawQuery['reexportReason'];
    const reason = typeof reasonRaw === 'string' ? reasonRaw.trim() : '';

    const ids = ex.mode === 'selected' ? ex.ids : undefined;
    if (ex.mode === 'selected' && (!ids || ids.length === 0)) throw AppError.badRequest('NO_IDS_SELECTED');
    const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (ids && ids.some((id) => !UUID.test(id))) throw AppError.badRequest('BAD_EXPORT_IDS');

    const filterMap: Record<string, FilterField> = {};
    for (const c of KYC_QUEUE_COLUMNS)
      if (c.filterable) filterMap[c.key] = { column: c.sql, kind: filterKindFor(c) };
    const filters = resolveFilters(rawQuery, { sortMap: {}, filterMap, defaultSort: 'assignedAt' });

    let claimed: string[];
    let exportNo: number | null;
    if (reasonRaw !== undefined) {
      // Re-export: explicit + reasoned + selected-only (the Exported tab's row action).
      if (!reason) throw AppError.badRequest('REEXPORT_REASON_REQUIRED');
      if (ex.mode !== 'selected' || !ids?.length) throw AppError.badRequest('REEXPORT_REQUIRES_SELECTED_IDS');
      const re = await repo.appendReexports({ ids, scope, format: ex.format, actorId: actor.userId, reason });
      claimed = re.taskIds;
      exportNo = re.exportNo;
    } else {
      // First export: 413-guard the matching set BEFORE claiming (a claim must never exceed the file).
      const matching = await repo.count({
        state: 'TO_EXPORT',
        filters,
        scope,
        ...(ids ? { idFilter: ids } : {}),
      });
      assertExportable(matching);
      const claim = await repo.claimFirstExports({
        filters,
        scope,
        ...(ids ? { idFilter: ids } : {}),
        format: ex.format,
        actorId: actor.userId,
      });
      claimed = claim.taskIds;
      exportNo = claim.exportNo;
      if (claimed.length === 0) throw AppError.conflict('ALREADY_EXPORTED');
    }

    // The claimed rows are now EXPORTED by definition — fetch them with the full registry available.
    const { items } = await repo.rows({
      state: 'EXPORTED',
      columns: KYC_QUEUE_COLUMNS,
      filters: [],
      scope,
      sortColumn: 'ct.task_number',
      sortOrder: 'asc',
      limit: claimed.length,
      offset: 0,
      idFilter: claimed,
    });

    // Export column order (owner 2026-07-02). The `documentDetails` slot expands INLINE into one
    // column per detail label, so 2–3 details (BANK NAME · STATEMENT PERIOD · …) sit together right
    // after Document type and before Document number — matching the operator's layout. Name-on-
    // document / applicant PAN / mobile are deliberately NOT in the export (owner: if the verifier
    // needs them they go in the document number/details).
    const EXPORT_DEFAULT_KEYS = [
      'taskNumber',
      'caseNumber',
      'clientName',
      'productName',
      'applicantName',
      'unitName',
      'documentDetails', // ← expands to the per-label detail columns at THIS position
      'documentNumber',
      'trigger',
      'priority',
      'assignedAt',
      'assignedByName',
      'backendContactNumber',
    ];
    const wanted = ex.cols.filter((k) => KYC_QUEUE_COLUMNS_BY_KEY.has(k));
    const pickedKeys = wanted.length ? wanted : EXPORT_DEFAULT_KEYS;

    // The per-label detail columns (union over the exported rows, alphabetical) — built once, then
    // spliced in at the documentDetails position so they land inline, not appended at the end.
    const labels = new Set<string>();
    for (const row of items) {
      const d = row['documentDetails'];
      if (d && typeof d === 'object') for (const k of Object.keys(d)) labels.add(k);
    }
    const detailCols = [...labels].sort().map<ExportColumn<KycTaskRow>>((label) => ({
      id: `detail:${label}`,
      // operator-authored label — formula-guarded (the XLSX builder doesn't neutralize headers).
      header: String(neutralizeFormula(label)),
      value: (row) => {
        const d = row['documentDetails'];
        return d && typeof d === 'object' ? ((d as Record<string, string>)[label] ?? null) : null;
      },
    }));

    const columns: ExportColumn<KycTaskRow>[] = [];
    for (const k of pickedKeys) {
      if (k === 'documentDetails') {
        columns.push(...detailCols);
        continue;
      }
      const c = KYC_QUEUE_COLUMNS_BY_KEY.get(k);
      if (!c) continue;
      columns.push({
        id: c.key,
        header: c.label,
        value: (row) => {
          const v = row[c.key] as unknown;
          // pg returns timestamptz as Date — pass it through (the builders render ISO); only a real
          // object (a jsonb map on a non-detail column) needs stringifying.
          if (v instanceof Date) return v;
          return v !== null && typeof v === 'object'
            ? JSON.stringify(v)
            : (v as string | number | boolean | null);
        },
      });
    }
    return { rows: items, columns, exportNo: exportNo ?? 0 };
  },
};
