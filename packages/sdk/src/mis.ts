/**
 * @crm2/sdk — MIS (Management Information System) read-model (ADR-0037).
 * Layout-driven tabular view of COMPLETED tasks, scoped to the actor and filtered by client/product.
 * Gated `page.mis`; money columns (RATE_AMOUNT / COMMISSION_AMOUNT) silently stripped for actors
 * without `billing.view` — the endpoint never returns 403 on billing.view absence.
 */
import type { ColumnDataType } from './reportLayouts.js';

/** Client-facing column descriptor returned in the `columns` array. */
export interface MisColumn {
  /** The layout's `columnKey` (stable, layout-defined identifier). */
  key: string;
  /** The layout's `headerLabel` (display label). */
  header: string;
  dataType: ColumnDataType;
}

/** One page of MIS rows. Column keys match `MisColumn.key`; money columns absent if actor lacks billing.view. */
export interface MisRowsResponse {
  columns: MisColumn[];
  rows: Record<string, unknown>[];
  totalCount: number;
}

/** Query parameters for `GET /api/v2/mis/rows`. */
export interface MisQuery {
  clientId: number;
  productId: number;
  /** ISO-8601 timestamp; only tasks completed at or after this time. */
  completedFrom?: string;
  /** ISO-8601 timestamp; only tasks completed at or before this time. */
  completedTo?: string;
  /** Full-text search across case number, client name, product name, task number. */
  search?: string;
  page?: number;
  pageSize?: number;
}

export { type ColumnDataType };
