/**
 * MIS source resolver (ADR-0049).
 *
 * Translates an ordered list of `ReportLayoutColumn` descriptors into SQL SELECT fragments
 * (aliased c0, c1, …) and column metadata for the FE. Security invariant: `source_ref` is NEVER
 * interpolated into SQL — FIXED sources are resolved through a static code-owned lookup map;
 * FREE sources push the ref as a bind parameter.
 */
import type { ReportLayoutColumn, ColumnDataType } from '@crm2/sdk';
import { COMPLETED_BAND } from '../billing/repository.js';

// ---------------------------------------------------------------------------
// Static code-owned lookup maps (the only SQL vocabulary for FIXED sources).
// ---------------------------------------------------------------------------

/** TASK_FIELD ref → SQL expression. FROM contract: `case_tasks ct`, `auth_users au`, `verification_units vu`. */
const TASK_FIELD_MAP: Readonly<Record<string, string>> = {
  task_number: 'ct.task_number',
  status: 'ct.status',
  visit_type: 'ct.visit_type',
  field_rate_type: '(SELECT code FROM rate_types WHERE id = ct.rate_type_id)',
  bill_count: 'ct.bill_count',
  verification_outcome: 'ct.verification_outcome',
  remark: 'ct.remark',
  task_origin: 'ct.task_origin',
  priority: 'ct.priority',
  address: 'ct.address',
  trigger: 'ct.trigger',
  started_at: 'ct.started_at',
  completed_at: 'ct.completed_at',
  created_at: 'ct.created_at',
  assignee_name: 'au.name',
  unit_name: 'vu.name',
};

/** CASE_FIELD ref → SQL expression. FROM contract: `cases cs`, `clients cl`, `products p`. */
const CASE_FIELD_MAP: Readonly<Record<string, string>> = {
  case_number: 'cs.case_number',
  client_name: 'cl.name',
  product_name: 'p.name',
  backend_contact_number: 'cs.backend_contact_number',
  case_outcome: 'cs.verification_outcome',
  case_result_remark: 'cs.result_remark',
  case_completed_at: 'cs.completed_at',
  case_created_at: 'cs.created_at',
};

/** APPLICANT_FIELD ref → SQL expression. FROM contract: `applicants ap`. */
const APPLICANT_FIELD_MAP: Readonly<Record<string, string>> = {
  name: 'ap.name',
  mobile: 'ap.mobile',
  pan: 'ap.pan',
  applicant_type: 'ap.applicant_type',
  calling_code: 'ap.calling_code',
};

// Validate FORM_DATA_PATH path segments: non-empty, no whitespace, max 64 chars.
const SEGMENT_RE = /^[^\s]{1,64}$/;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface MisColumnDesc {
  key: string;
  header: string;
  dataType: ColumnDataType;
}

export interface ResolvedColumns {
  /** SQL SELECT fragments, one per input column, aliased "c0".."cN". */
  selects: string[];
  /** FE column descriptors parallel to `selects`. */
  columns: MisColumnDesc[];
  /** Whether the MIS query needs the applicants join (`ap`). */
  needsApplicant: boolean;
  /** Whether the MIS query needs the data_entry join (`de`). */
  needsDataEntry: boolean;
  /** Whether the MIS query needs the RATE_LATERAL join (`rt`). */
  needsRate: boolean;
  /** Whether the MIS query needs the COMMISSION_LATERAL join (`com`). */
  needsCommission: boolean;
}

// ---------------------------------------------------------------------------
// Core resolver
// ---------------------------------------------------------------------------

/**
 * Compile an ordered list of layout columns into SQL SELECT fragments + join flags.
 *
 * @param cols   Ordered ReportLayoutColumn list (all active; caller filters inactive ones).
 * @param params Mutable bind-parameter array — FREE sources push their values here.
 *               Pass `[]` for a fresh query; pass a pre-populated array when the caller
 *               has already bound WHERE-clause values so placeholder numbering is correct.
 */
export function resolveColumns(cols: ReportLayoutColumn[], params: unknown[]): ResolvedColumns {
  const selects: string[] = [];
  const columns: MisColumnDesc[] = [];
  let needsApplicant = false;
  let needsDataEntry = false;
  let needsRate = false;
  let needsCommission = false;

  for (const [i, c] of cols.entries()) {
    const alias = `"c${i}"`;
    const ref = c.sourceRef?.trim() ?? '';

    let fragment: string;

    switch (c.sourceType) {
      // ------------------------------------------------------------------
      // FIXED — resolve ref through static map; unknown key → NULL
      // ------------------------------------------------------------------
      case 'TASK_FIELD': {
        const expr = ref ? TASK_FIELD_MAP[ref] : undefined;
        fragment = expr !== undefined ? `${expr} AS ${alias}` : `NULL AS ${alias}`;
        break;
      }
      case 'CASE_FIELD': {
        const expr = ref ? CASE_FIELD_MAP[ref] : undefined;
        fragment = expr !== undefined ? `${expr} AS ${alias}` : `NULL AS ${alias}`;
        break;
      }
      case 'APPLICANT_FIELD': {
        const expr = ref ? APPLICANT_FIELD_MAP[ref] : undefined;
        if (expr !== undefined) {
          needsApplicant = true;
          fragment = `${expr} AS ${alias}`;
        } else {
          fragment = `NULL AS ${alias}`;
        }
        break;
      }

      // ------------------------------------------------------------------
      // REFLESS — the source type IS the SQL; no ref involved
      // ------------------------------------------------------------------
      case 'RATE_AMOUNT':
        needsRate = true;
        fragment = `rt.bill_amount AS ${alias}`;
        break;

      case 'COMMISSION_AMOUNT':
        needsCommission = true;
        fragment = `COALESCE(ct.commission_amount, com.commission_amount) AS ${alias}`;
        break;

      case 'TAT':
        fragment = `${COMPLETED_BAND} AS ${alias}`;
        break;

      // ------------------------------------------------------------------
      // FREE BOUND — ref pushed as a bind parameter (never interpolated)
      // ------------------------------------------------------------------
      case 'DATA_ENTRY_FIELD': {
        if (!ref) {
          fragment = `NULL AS ${alias}`;
        } else {
          needsDataEntry = true;
          params.push(ref);
          fragment = `de.data ->> $${params.length} AS ${alias}`;
        }
        break;
      }

      case 'FORM_DATA_PATH': {
        const segments = ref ? ref.split('.') : [];
        const valid = segments.length > 0 && segments.every((seg) => SEGMENT_RE.test(seg));
        if (!valid) {
          fragment = `NULL AS ${alias}`;
        } else {
          params.push(segments);
          fragment = `ct.form_data #>> $${params.length}::text[] AS ${alias}`;
        }
        break;
      }

      // ------------------------------------------------------------------
      // v1 NULL — no documents table; no expression compilation
      // ------------------------------------------------------------------
      case 'DOC_TYPE_COUNT':
      case 'COMPUTED':
        fragment = `NULL AS ${alias}`;
        break;

      // Safety net — should never be reached (SourceType is exhaustive)
      default: {
        const _exhaustive: never = c.sourceType;
        void _exhaustive;
        fragment = `NULL AS ${alias}`;
      }
    }

    selects.push(fragment);
    columns.push({ key: `c${i}`, header: c.headerLabel, dataType: c.dataType });
  }

  return { selects, columns, needsApplicant, needsDataEntry, needsRate, needsCommission };
}
