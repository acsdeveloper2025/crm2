/**
 * MIS (Management Information System) — ADR-0084. Predefined report types + a code-owned column
 * allow-list. The server owns every column's SQL; the SDK only ever carries column KEYS + metadata,
 * never SQL. Money columns (billing.view-gated) are omitted from the catalog for actors without it.
 */

export type MisDataType = 'TEXT' | 'NUMBER' | 'DATE' | 'SELECT' | 'BOOLEAN';

/** One selectable column in a report type's allow-list (metadata only — no SQL crosses the wire). */
export interface MisColumnMeta {
  key: string;
  label: string;
  group: string;
  dataType: MisDataType;
  /** billing.view-gated (rate/commission). Omitted from the catalog when the actor lacks billing.view. */
  money: boolean;
  sortable: boolean;
  filterable: boolean;
  defaultVisible: boolean;
}

/** A predefined report type (e.g. TASK_OPERATIONAL) + its column allow-list. */
export interface MisReportTypeMeta {
  type: string;
  label: string;
  /** default sort column key (a sortable, non-money column). */
  defaultSort: string;
  columns: MisColumnMeta[];
}

/** A report row: values keyed by the selected column keys. Money cells are null without billing.view. */
export type MisCell = string | number | boolean | null;
export type MisRow = Record<string, MisCell>;
