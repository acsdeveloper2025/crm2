/**
 * @crm2/sdk — shared FIELD_REPORT / CASE_REPORT render types.
 *
 * The MIS "report layout" ENGINE (the admin designer + `report_layouts` store, ADR-0037/0049) was
 * REMOVED in ADR-0083. These type contracts outlived it: field-report and case-report rendering still
 * share them — a report column's shape, the PDF page geometry, and the per-task field-report view.
 * NO runtime schema / source-catalog / write-contract remains here (that was all MIS admin authoring);
 * this file is now pure types consumed by the surviving renderers.
 */

// ---- PDF page geometry (CASE_REPORT renderer + platform/pdf) ----
export type PageSize = 'A4' | 'LETTER' | 'LEGAL';
export type PageOrientation = 'portrait' | 'landscape';

// ---- report column shape (a FIELD_REPORT layout's variable catalog) ----
export type ColumnDataType = 'TEXT' | 'NUMBER' | 'DATE' | 'SELECT' | 'BOOLEAN';

/** Where a report column reads its value from (the value's origin). */
export type SourceType =
  | 'TASK_FIELD'
  | 'CASE_FIELD'
  | 'APPLICANT_FIELD'
  | 'RATE_AMOUNT'
  | 'COMMISSION_AMOUNT'
  | 'TAT'
  | 'DATA_ENTRY_FIELD'
  | 'FORM_DATA_PATH'
  | 'DOC_TYPE_COUNT'
  | 'COMPUTED';

/** A report column (read model) — one entry in a FIELD_REPORT layout's variable catalog. */
export interface ReportLayoutColumn {
  id: number;
  columnKey: string;
  headerLabel: string;
  sourceType: SourceType;
  sourceRef: string | null;
  dataType: ColumnDataType;
  displayOrder: number;
  section: string | null;
  isRequired: boolean;
  options: { label: string; value: string }[];
  validation: Record<string, unknown>;
}

/** The catalog/write shape of a report column — the built-in FIELD_REPORT defaults are authored as these. */
export interface ReportLayoutColumnInput {
  columnKey: string;
  headerLabel: string;
  sourceType: SourceType;
  sourceRef?: string | null;
  dataType: ColumnDataType;
  displayOrder?: number;
  section?: string | null;
  isRequired?: boolean;
  options?: { label: string; value: string }[];
  validation?: Record<string, unknown>;
}

// ---- FIELD_REPORT render contract (the #6 card read) ----

/** One submitted field, ready to display (`Label: value`). */
export interface FieldReportField {
  label: string;
  value: string;
}

/** A group of submitted fields under a heading (one per form-type slug present in the submission). */
export interface FieldReportSection {
  title: string;
  fields: FieldReportField[];
}

/** The field report for one task — the combined view (v1 `OptimizedFormSubmissionViewer` parity): the
 *  agent's RAW submitted fields (`sections`, always present when the task has form_data) PLUS the
 *  generated `narrative` (the built-in FIELD_REPORT default rendered against the submission; null when
 *  the verification type has no default). `sections` is empty when nothing was submitted. */
export interface FieldReportView {
  taskId: string;
  /** the verification-type key resolved from the task's unit (e.g. RESIDENCE). */
  verificationType: string;
  /** the agent's submitted fields, grouped by form-type slug; empty when no form_data. */
  sections: FieldReportSection[];
  /** the built-in default's id (always null now — no stored layout) + name (e.g. "Standard RESIDENCE"). */
  layoutId: number | null;
  layoutName: string | null;
  /** the rendered narrative text, or null when the verification type has no built-in default. */
  narrative: string | null;
  /** when this report was FROZEN at field submission (ADR-0080) — a stored, immutable snapshot. Null
   *  means it was rendered live (the task isn't submitted yet, or predates snapshotting). */
  snapshotAt: string | null;
}
