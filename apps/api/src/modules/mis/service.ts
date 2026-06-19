import type { ReportLayoutColumn, ColumnDataType } from '@crm2/sdk';
import { PERMISSIONS } from '@crm2/access';
import { resolveScope, type Actor } from '../../platform/scope/index.js';
import { reportLayoutRepository } from '../reportLayouts/repository.js';
import { misRepository, type MisColumn } from './repository.js';
import {
  assertExportable,
  exportThreshold,
  resolveExport,
  writeExport,
  type ExportColumn,
} from '../../platform/export/index.js';
import type { Response } from 'express';

const MIS_DEFAULT_PAGE_SIZE = 50;
const MIS_MAX_PAGE_SIZE = 200;

const toPosInt = (v: unknown): number | undefined => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : undefined;
};

const asStr = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);

const clampLimit = (v: unknown, max = MIS_MAX_PAGE_SIZE): number => {
  const n = toPosInt(v);
  return n !== undefined ? Math.min(n, max) : MIS_DEFAULT_PAGE_SIZE;
};

const toOffset = (page: unknown, pageSize: number): number => {
  const p = toPosInt(page);
  return p !== undefined ? (p - 1) * pageSize : 0;
};

export interface MisRowsResponse {
  columns: MisColumn[];
  rows: Record<string, unknown>[];
  totalCount: number;
}

// Mirrors the actor enrichment shape used in tasks/controller.ts.
interface EnrichedActor extends Actor {
  grantsAll?: boolean;
  permissions?: string[];
}

function canViewBilling(actor: EnrichedActor): boolean {
  if (actor.grantsAll === true) return true;
  return (actor.permissions ?? []).includes(PERMISSIONS.BILLING_VIEW);
}

function filterColumns(cols: ReportLayoutColumn[], actorCanBilling: boolean): ReportLayoutColumn[] {
  if (actorCanBilling) return cols;
  return cols.filter((c) => c.sourceType !== 'RATE_AMOUNT' && c.sourceType !== 'COMMISSION_AMOUNT');
}

export const misService = {
  async rows(rawQuery: Record<string, unknown>, actor: Actor): Promise<MisRowsResponse> {
    const clientId = toPosInt(rawQuery['clientId']);
    const productId = toPosInt(rawQuery['productId']);

    if (clientId === undefined || productId === undefined) {
      return { columns: [], rows: [], totalCount: 0 };
    }

    const layout = await reportLayoutRepository.findActiveByConfig(clientId, productId, 'MIS');
    if (!layout) return { columns: [], rows: [], totalCount: 0 };

    const enriched = actor as EnrichedActor;
    const cols = filterColumns(layout.columns, canViewBilling(enriched));
    const scope = await resolveScope(actor);
    const limit = clampLimit(rawQuery['pageSize']);
    const offset = toOffset(rawQuery['page'], limit);
    const completedFrom = asStr(rawQuery['completedFrom']);
    const completedTo = asStr(rawQuery['completedTo']);
    const search = asStr(rawQuery['search']);

    const result = await misRepository.misRows({
      columns: cols,
      scope,
      clientId,
      productId,
      ...(completedFrom !== undefined ? { completedFrom } : {}),
      ...(completedTo !== undefined ? { completedTo } : {}),
      ...(search !== undefined ? { search } : {}),
      limit,
      offset,
    });

    return { columns: result.columns, rows: result.rows, totalCount: result.totalCount };
  },

  async exportRows(rawQuery: Record<string, unknown>, res: Response, actor: Actor): Promise<void> {
    const ex = resolveExport(rawQuery);
    const clientId = toPosInt(rawQuery['clientId']);
    const productId = toPosInt(rawQuery['productId']);

    const emptyExport = async () => {
      const cols: ExportColumn<Record<string, unknown>>[] = [];
      await writeExport(res, {
        rows: [],
        columns: cols,
        ex,
        filenameBase: 'mis',
        resource: 'mis',
        actorId: actor.userId,
      });
    };

    if (clientId === undefined || productId === undefined) {
      await emptyExport();
      return;
    }

    const layout = await reportLayoutRepository.findActiveByConfig(clientId, productId, 'MIS');
    if (!layout) {
      await emptyExport();
      return;
    }

    const enriched = actor as EnrichedActor;
    const cols = filterColumns(layout.columns, canViewBilling(enriched));
    const scope = await resolveScope(actor);
    const completedFrom = asStr(rawQuery['completedFrom']);
    const completedTo = asStr(rawQuery['completedTo']);
    const search = asStr(rawQuery['search']);

    const baseOpts = {
      columns: cols,
      scope,
      clientId,
      productId,
      ...(completedFrom !== undefined ? { completedFrom } : {}),
      ...(completedTo !== undefined ? { completedTo } : {}),
      ...(search !== undefined ? { search } : {}),
    };

    // For mode=all: get count first, guard threshold, then fetch all rows.
    if (ex.mode === 'all') {
      const countResult = await misRepository.misRows({ ...baseOpts, limit: 1, offset: 0 });
      assertExportable(countResult.totalCount);
    }

    const result = await misRepository.misRows({
      ...baseOpts,
      limit: ex.mode === 'all' ? exportThreshold() : MIS_DEFAULT_PAGE_SIZE,
      offset: 0,
    });

    const exportColumns: ExportColumn<Record<string, unknown>>[] = result.columns.map((c) => ({
      id: c.key,
      header: c.header,
      value: (r: Record<string, unknown>): string | number | boolean | null | undefined => {
        const v = r[c.key];
        return v === undefined ? null : (v as string | number | boolean | null | undefined);
      },
    }));

    await writeExport(res, {
      rows: result.rows,
      columns: exportColumns,
      ex,
      filenameBase: 'mis',
      resource: 'mis',
      actorId: actor.userId,
    });
  },
};

// Re-export for SDK type (MisColumn is the wire shape)
export type { MisColumn, ColumnDataType };
