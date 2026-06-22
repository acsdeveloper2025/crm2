import { z } from 'zod';
import { toUpper } from './text.js';

/**
 * @crm2/sdk — MIS Layout engine contract (ADR-0037). A `report_layout` is the per-(client,product)
 * config for one KIND of report; its ordered columns each BIND to a data source from the shared
 * SOURCE_CATALOG below. This catalog is the single contract between "what a column may bind to" (FE
 * designer dropdowns + API validation) and "what the read-model can resolve" (generation slices).
 */

export const LAYOUT_KINDS = ['DATA_ENTRY', 'MIS', 'BILLING_MIS', 'FIELD_REPORT', 'CASE_REPORT'] as const;
export type LayoutKind = (typeof LAYOUT_KINDS)[number];

/** FIELD_REPORT layouts carry a Handlebars narrative body + a verification-type key (the field unit
 *  code, e.g. RESIDENCE); their columns are the VARIABLE CATALOG the body renders against. The other
 *  kinds carry neither. (ADR-0038/0039.) */
export const FIELD_REPORT_KIND = 'FIELD_REPORT' as const;

/** CASE_REPORT layouts carry an HTML Handlebars body + page_size + page_orientation; they have NO
 *  verification_type (case-level) and no column catalog (rendered against a fixed CaseReportContext —
 *  see caseReports.ts). One ACTIVE per (client, product). (ADR-0041.) */
export const CASE_REPORT_KIND = 'CASE_REPORT' as const;

export const REPORT_PAGE_SIZES = ['A4', 'LETTER', 'LEGAL'] as const;
export type PageSize = (typeof REPORT_PAGE_SIZES)[number];

export const REPORT_PAGE_ORIENTATIONS = ['portrait', 'landscape'] as const;
export type PageOrientation = (typeof REPORT_PAGE_ORIENTATIONS)[number];

export const COLUMN_DATA_TYPES = ['TEXT', 'NUMBER', 'DATE', 'SELECT', 'BOOLEAN'] as const;
export type ColumnDataType = (typeof COLUMN_DATA_TYPES)[number];

export const SOURCE_TYPES = [
  'TASK_FIELD',
  'CASE_FIELD',
  'APPLICANT_FIELD',
  'RATE_AMOUNT',
  'COMMISSION_AMOUNT',
  'TAT',
  'DATA_ENTRY_FIELD',
  'FORM_DATA_PATH',
  'DOC_TYPE_COUNT',
  'COMPUTED',
] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

/** A bindable source field in the FIXED catalog (the allow-list for typed task/case/applicant fields). */
export interface SourceField {
  key: string;
  label: string;
  dataType: ColumnDataType;
}

/**
 * The code-defined source catalog.
 *  - `FIXED`  — the column binds to one of an enumerated set of real, typed columns (`source_ref` ∈ fields).
 *  - `REFLESS`— the type IS the source (a derived amount / TAT); `source_ref` must be empty.
 *  - `FREE`   — caller-supplied ref validated at the CONSUMING slice (data-entry field key / form
 *               json-path / verification-unit code / computed expression). Non-empty is all we check now.
 */
export const SOURCE_CATALOG: Record<
  SourceType,
  { mode: 'FIXED' | 'REFLESS' | 'FREE'; fields?: readonly SourceField[] }
> = {
  TASK_FIELD: {
    mode: 'FIXED',
    fields: [
      { key: 'task_number', label: 'Task Number', dataType: 'TEXT' },
      { key: 'status', label: 'Status', dataType: 'TEXT' },
      { key: 'visit_type', label: 'Visit Type', dataType: 'TEXT' },
      { key: 'field_rate_type', label: 'Distance Band', dataType: 'TEXT' },
      { key: 'bill_count', label: 'Bill Count', dataType: 'NUMBER' },
      { key: 'verification_outcome', label: 'Verification Outcome', dataType: 'TEXT' },
      { key: 'remark', label: 'Remark', dataType: 'TEXT' },
      { key: 'task_origin', label: 'Task Origin', dataType: 'TEXT' },
      { key: 'priority', label: 'Priority', dataType: 'TEXT' },
      { key: 'address', label: 'Address', dataType: 'TEXT' },
      { key: 'trigger', label: 'Trigger', dataType: 'TEXT' },
      { key: 'started_at', label: 'Started At', dataType: 'DATE' },
      { key: 'completed_at', label: 'Completed At', dataType: 'DATE' },
      { key: 'created_at', label: 'Created At', dataType: 'DATE' },
      { key: 'assignee_name', label: 'Assignee', dataType: 'TEXT' },
      { key: 'unit_name', label: 'Verification Unit', dataType: 'TEXT' },
    ],
  },
  CASE_FIELD: {
    mode: 'FIXED',
    fields: [
      { key: 'case_number', label: 'Case Number', dataType: 'TEXT' },
      { key: 'client_name', label: 'Client', dataType: 'TEXT' },
      { key: 'product_name', label: 'Product', dataType: 'TEXT' },
      { key: 'backend_contact_number', label: 'Backend Contact', dataType: 'TEXT' },
      { key: 'case_outcome', label: 'Case Outcome', dataType: 'TEXT' },
      { key: 'case_result_remark', label: 'Case Result Remark', dataType: 'TEXT' },
      { key: 'case_completed_at', label: 'Case Completed At', dataType: 'DATE' },
      { key: 'case_created_at', label: 'Case Created At', dataType: 'DATE' },
    ],
  },
  APPLICANT_FIELD: {
    mode: 'FIXED',
    fields: [
      { key: 'name', label: 'Applicant Name', dataType: 'TEXT' },
      { key: 'mobile', label: 'Applicant Mobile', dataType: 'TEXT' },
      { key: 'pan', label: 'Applicant PAN', dataType: 'TEXT' },
      { key: 'applicant_type', label: 'Applicant Type', dataType: 'TEXT' },
      { key: 'calling_code', label: 'Calling Code', dataType: 'TEXT' },
    ],
  },
  RATE_AMOUNT: { mode: 'REFLESS' },
  COMMISSION_AMOUNT: { mode: 'REFLESS' },
  TAT: { mode: 'REFLESS' },
  DATA_ENTRY_FIELD: { mode: 'FREE' },
  FORM_DATA_PATH: { mode: 'FREE' },
  DOC_TYPE_COUNT: { mode: 'FREE' },
  COMPUTED: { mode: 'FREE' },
};

/** Validate a column's source binding against the catalog. `null` = OK, else a human error message. */
export function validateColumnSource(
  sourceType: SourceType,
  sourceRef: string | null | undefined,
): string | null {
  const entry = SOURCE_CATALOG[sourceType];
  const ref = sourceRef?.trim();
  if (entry.mode === 'REFLESS') return ref ? `${sourceType} takes no source reference` : null;
  if (!ref) return `${sourceType} requires a source reference`;
  if (entry.mode === 'FIXED') {
    return entry.fields!.some((f) => f.key === ref) ? null : `'${ref}' is not a valid ${sourceType}`;
  }
  return null; // FREE — non-empty ref accepted; deeper validation at the consuming slice
}

// ---- read models ----

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

export interface ReportLayout {
  id: number;
  clientId: number;
  productId: number;
  kind: LayoutKind;
  name: string;
  /** FIELD_REPORT only — the verification-type key (field unit code, e.g. RESIDENCE); null otherwise. */
  verificationType: string | null;
  /** FIELD_REPORT and CASE_REPORT — the Handlebars source (plain-text narrative for FIELD_REPORT,
   *  HTML+inline-CSS for CASE_REPORT); null for DATA_ENTRY/MIS/BILLING_MIS. */
  templateBody: string | null;
  /** CASE_REPORT only — the rendered PDF page geometry; null for the other kinds. */
  pageSize: PageSize | null;
  pageOrientation: PageOrientation | null;
  isActive: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

/** List row — layout header joined to client/product names + a column count. */
export interface ReportLayoutView extends ReportLayout {
  clientName: string;
  productName: string;
  columnCount: number;
}

/** Detail — the layout header + its ordered columns (the designer/generation read). */
export interface ReportLayoutDetail extends ReportLayoutView {
  columns: ReportLayoutColumn[];
}

// ---- write contracts ----

const optionSchema = z.object({
  label: z.string().trim().min(1).max(120),
  value: z.string().trim().max(120),
});

export const ReportLayoutColumnInputSchema = z
  .object({
    columnKey: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .regex(/^[a-z0-9_]+$/, 'lowercase letters, digits and underscore only'),
    headerLabel: z.string().trim().min(1).max(150).transform(toUpper),
    sourceType: z.enum(SOURCE_TYPES),
    sourceRef: z.string().trim().max(200).nullish(),
    dataType: z.enum(COLUMN_DATA_TYPES),
    displayOrder: z.number().int().min(0).optional(),
    section: z.string().trim().max(80).transform(toUpper).nullish(),
    isRequired: z.boolean().optional(),
    options: z.array(optionSchema).max(100).optional(),
    validation: z.record(z.string(), z.unknown()).optional(),
  })
  .superRefine((c, ctx) => {
    const err = validateColumnSource(c.sourceType, c.sourceRef ?? null);
    if (err) ctx.addIssue({ code: z.ZodIssueCode.custom, message: err, path: ['sourceRef'] });
  });
export type ReportLayoutColumnInput = z.input<typeof ReportLayoutColumnInputSchema>;

/** A layout's columns: 0..200, with unique keys (one key can't appear twice). The per-kind MINIMUM
 *  (≥1 for the column/field kinds, exactly 0 for CASE_REPORT) is enforced in `refineLayoutShape`. */
const layoutColumnsSchema = z
  .array(ReportLayoutColumnInputSchema)
  .max(200)
  .superRefine((cols, ctx) => {
    const seen = new Set<string>();
    cols.forEach((c, i) => {
      if (seen.has(c.columnKey))
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `duplicate column key '${c.columnKey}'`,
          path: [i, 'columnKey'],
        });
      seen.add(c.columnKey);
    });
  });

/** ⭐ OUTPUT-ENCODING GATE (ADR-0041, Security BLOCK-level). A Handlebars template body must never use
 *  a RAW (un-escaped) output form: triple-stash `{{{ }}}`, the ampersand form `{{& }}`, OR either of
 *  those behind a whitespace-control `~` prefix (`{{~{ }}}` / `{{~& }}`) — Handlebars treats ALL of
 *  them as escape-opt-out, so any re-opens a stored-XSS sink in the CASE_REPORT HTML/PDF renderer
 *  (auto-escape ON does NOT save you — these opt OUT of it at the template level). The optional `~`
 *  is the subtle one (it slips a naive `\{\{[{&]`). A leading `~` on a NORMAL `{{~x}}` stays allowed
 *  (still escaped). Banned on EVERY template body, create + update, kind-agnostic — no shipped default
 *  uses them. Authoritative server gate (the FE mirrors it); the renderer's auto-escape is layer two. */
const RAW_OUTPUT_RE = /\{\{~?[{&]/;
const templateBodySchema = z
  .string()
  .trim()
  .min(1)
  .max(20_000)
  .refine((s) => !RAW_OUTPUT_RE.test(s), {
    message:
      'raw un-escaped output ({{{ }}} or {{& }}) is not allowed — use {{ }} so values are HTML-escaped',
  });

/** Per-kind coherence (mirrors the DB chk_report_layouts_shape constraint):
 *  - FIELD_REPORT → verificationType + templateBody + ≥1 column; NO page geometry.
 *  - CASE_REPORT  → templateBody + pageSize + pageOrientation; NO verificationType, NO columns.
 *  - DATA_ENTRY/MIS/BILLING_MIS → ≥1 column; NO templateBody/verificationType/page geometry. */
function refineLayoutShape(
  u: {
    kind?: LayoutKind | undefined;
    verificationType?: string | null | undefined;
    templateBody?: string | null | undefined;
    pageSize?: PageSize | null | undefined;
    pageOrientation?: PageOrientation | null | undefined;
    columns?: unknown[] | undefined;
  },
  ctx: z.RefinementCtx,
): void {
  const isFieldReport = u.kind === FIELD_REPORT_KIND;
  const isCaseReport = u.kind === CASE_REPORT_KIND;
  const hasType = !!u.verificationType?.trim();
  const hasBody = !!u.templateBody?.trim();
  const hasPage = !!u.pageSize || !!u.pageOrientation;
  const colCount = u.columns?.length ?? 0;
  const issue = (message: string, path: string) =>
    ctx.addIssue({ code: z.ZodIssueCode.custom, message, path: [path] });

  if (isCaseReport) {
    if (hasType) issue('verificationType is not for CASE_REPORT', 'verificationType');
    if (!hasBody) issue('CASE_REPORT requires templateBody', 'templateBody');
    if (!u.pageSize) issue('CASE_REPORT requires pageSize', 'pageSize');
    if (!u.pageOrientation) issue('CASE_REPORT requires pageOrientation', 'pageOrientation');
    if (colCount > 0) issue('CASE_REPORT renders the fixed case context — it has no columns', 'columns');
    return;
  }

  // Non-CASE_REPORT kinds carry no page geometry.
  if (hasPage) issue('page size/orientation is only for CASE_REPORT', 'pageSize');

  if (isFieldReport) {
    if (!hasType) issue('FIELD_REPORT requires verificationType', 'verificationType');
    if (!hasBody) issue('FIELD_REPORT requires templateBody', 'templateBody');
  } else {
    if (hasType) issue('verificationType is only for FIELD_REPORT', 'verificationType');
    if (hasBody) issue('templateBody is only for FIELD_REPORT / CASE_REPORT', 'templateBody');
  }
  // Column/field kinds need at least one column.
  if (colCount < 1) issue('at least one column is required', 'columns');
}

export const CreateReportLayoutSchema = z
  .object({
    clientId: z.number().int().positive(),
    productId: z.number().int().positive(),
    kind: z.enum(LAYOUT_KINDS),
    name: z.string().trim().min(1).max(150).transform(toUpper),
    /** FIELD_REPORT only — the verification-type key (free string; extends to KYC types later). */
    verificationType: z.string().trim().min(1).max(64).nullish(),
    /** FIELD_REPORT (plain-text narrative) and CASE_REPORT (HTML) — the Handlebars source. */
    templateBody: templateBodySchema.nullish(),
    /** CASE_REPORT only — the rendered PDF page geometry. */
    pageSize: z.enum(REPORT_PAGE_SIZES).nullish(),
    pageOrientation: z.enum(REPORT_PAGE_ORIENTATIONS).nullish(),
    columns: layoutColumnsSchema,
  })
  .superRefine(refineLayoutShape);
export type CreateReportLayoutInput = z.input<typeof CreateReportLayoutSchema>;

/** Update replaces name/templateBody/page-geometry and/or the full column set in place (OCC `version`
 *  sent alongside, like commission-rates revise). At least one mutable field must be present. The
 *  identity keys (client/product/kind/verificationType) are immutable — not accepted here. The
 *  triple-stash gate still applies to a new templateBody. */
export const UpdateReportLayoutSchema = z
  .object({
    name: z.string().trim().min(1).max(150).transform(toUpper).optional(),
    templateBody: templateBodySchema.optional(),
    pageSize: z.enum(REPORT_PAGE_SIZES).optional(),
    pageOrientation: z.enum(REPORT_PAGE_ORIENTATIONS).optional(),
    columns: layoutColumnsSchema.optional(),
  })
  .refine(
    (u) =>
      u.name !== undefined ||
      u.templateBody !== undefined ||
      u.pageSize !== undefined ||
      u.pageOrientation !== undefined ||
      u.columns !== undefined,
    { message: 'nothing to update (provide name, templateBody, page geometry and/or columns)' },
  );
export type UpdateReportLayoutInput = z.input<typeof UpdateReportLayoutSchema>;

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
 *  generated `narrative` (the active FIELD_REPORT template run against the submission; null when no
 *  template is configured for the verification type). `sections` is empty when nothing was submitted. */
export interface FieldReportView {
  taskId: string;
  /** the verification-type key resolved from the task's unit (e.g. RESIDENCE). */
  verificationType: string;
  /** the agent's submitted fields, grouped by form-type slug; empty when no form_data. */
  sections: FieldReportSection[];
  /** the active layout's id + name, or null when none is configured. */
  layoutId: number | null;
  layoutName: string | null;
  /** the rendered narrative text, or null when no template is configured. */
  narrative: string | null;
}
