/**
 * @crm2/sdk — the ONE import contract (IMPORT_EXPORT_STANDARD §5/§6/§8, B-14).
 * The flow is: Download Template → Fill → Upload → Preview (validate, no writes) → Confirm → Result.
 * The web client uploads the file bytes (xlsx) to `POST /<resource>/import?mode=preview|confirm`;
 * the server re-runs validation on confirm (stateless — the client re-sends the same file). Purely
 * additive to the wire (mobile never imports), so the never-break-mobile contract (ADR-0012) holds.
 */

/** preview = validate + report, no writes. confirm = process the valid rows + write the import_log. */
export type ImportMode = 'preview' | 'confirm';

/** One per-row validation/processing failure, keyed to the file row so the user can fix it. */
export interface ImportRowError {
  /** the 1-based row number in the uploaded file (header is row 1, first data row is 2). */
  rowNumber: number;
  /** the offending column header (or `*` for a whole-row error, e.g. a duplicate key). */
  column: string;
  message: string;
}

/** Result of `mode:'preview'` — what WOULD import. No rows are written. */
export interface ImportPreviewResult {
  totalRows: number;
  validRows: number;
  errorRows: number;
  errors: ImportRowError[];
  /** the first N valid rows as parsed (header → value), for the confirm preview table. */
  sample: Record<string, string>[];
}

/** Result of `mode:'confirm'` — the import summary (IMPORT_EXPORT_STANDARD §6). */
export interface ImportConfirmResult {
  totalRows: number;
  successRows: number;
  failedRows: number;
  durationMs: number;
  /** rows that failed validation or the write (duplicate key, etc.); valid rows still imported. */
  errors: ImportRowError[];
}

/**
 * One sheet's outcome within the Client Setup onboarding workbook preview (ADR-0092 S5): the module's
 * normal valid/error split, PLUS `pendingRows` — rows salvaged by cross-sheet projection (a code that
 * doesn't exist in the DB yet but is declared by an earlier sheet in THIS SAME workbook, e.g. a brand
 * new product referenced by the CPV/Rates sheets). A sheet absent from the uploaded workbook reports
 * all-zero counts, not an error.
 */
export interface OnboardingSheetPreview {
  name: string;
  totalRows: number;
  validRows: number;
  pendingRows: number;
  errorRows: number;
  errors: ImportRowError[];
}

/** Result of the onboarding workbook's `mode:'preview'` — one entry per sheet (`ONBOARDING_SHEET_NAMES`
 *  order: Products → CPV → RateTypeAssignments → Rates → CommissionRates). */
export interface OnboardingPreviewResult {
  sheets: OnboardingSheetPreview[];
}

/** One sheet's outcome within the onboarding workbook confirm. */
export interface OnboardingSheetConfirm extends ImportConfirmResult {
  name: string;
}

/** Result of the onboarding workbook's `mode:'confirm'`. */
export interface OnboardingConfirmResult {
  sheets: OnboardingSheetConfirm[];
}

/** The downloadable error report (§6: Row Number · Column Name · Error Message) as a CSV blob. */
export function importErrorsToCsv(errors: ImportRowError[]): string {
  const esc = (s: string): string => {
    let v = s;
    if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`;
    if (/[",\n\r]/.test(v)) v = `"${v.replace(/"/g, '""')}"`;
    return v;
  };
  const head = ['Row Number', 'Column Name', 'Error Message'].join(',');
  const body = errors.map((e) => [String(e.rowNumber), esc(e.column), esc(e.message)].join(','));
  return [head, ...body].join('\r\n');
}
