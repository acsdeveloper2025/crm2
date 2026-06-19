import type { ExportFormat } from '@crm2/sdk';

/**
 * Export builders (IMPORT_EXPORT_STANDARD §1/§2). The DataGrid is the only export surface; a module
 * declares an `ExportColumn[]` manifest (header + value extractor) and the platform turns the rows
 * into CSV or XLSX. Builders are pure (rows → bytes); the engine (`index.ts`) re-runs the list query
 * and streams the result.
 */
export interface ExportColumn<T> {
  /** matches the DataGrid column id, so the `cols` (visible columns) selection can filter + order. */
  id: string;
  /** the file header label. */
  header: string;
  /** the cell value for a row; null/undefined → empty cell; a Date → ISO-8601. (timestamptz columns
   *  arrive as Date objects from pg, hence the Date case.) */
  value: (row: T) => string | number | boolean | Date | null | undefined;
}

/** Restrict + reorder the manifest to the visible DataGrid columns (`cols`); unknown ids ignored. */
export function selectColumns<T>(columns: ExportColumn<T>[], visible?: string[]): ExportColumn<T>[] {
  if (!visible || visible.length === 0) return columns;
  const byId = new Map(columns.map((c) => [c.id, c]));
  const picked = visible.map((id) => byId.get(id)).filter((c): c is ExportColumn<T> => c !== undefined);
  // Never produce a zero-column file (stale/tampered `cols`) — fall back to the full manifest.
  return picked.length ? picked : columns;
}

const cell = <T>(col: ExportColumn<T>, row: T): string => {
  const v = col.value(row);
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString();
  return String(v);
};

/** Leading characters a spreadsheet treats as a formula trigger (CWE-1236). */
const FORMULA_LEAD = /^[=+\-@\t\r]/;

/**
 * Formula-injection guard (CWE-1236): a string whose first character is a spreadsheet formula
 * trigger (`= + - @` or tab/CR) is prefixed with `'` so no spreadsheet executes it as a formula.
 * Non-string values (numbers, dates, booleans, null, undefined) are returned unchanged so XLSX can
 * store them as native cell types.
 */
export function neutralizeFormula(v: unknown): unknown {
  if (typeof v === 'string' && FORMULA_LEAD.test(v)) return `'${v}`;
  return v;
}

/**
 * CSV cell escaping: formula-injection neutralization (CWE-1236) FIRST — a leading `= + - @` or
 * tab/CR is prefixed with `'` so spreadsheets never execute the cell as a formula — THEN RFC 4180
 * quoting (fields containing `,`/`"`/newline are wrapped, embedded quotes doubled). BOTH apply: a
 * formula-leading cell that also contains a comma/quote gets the `'` guard AND the quote-wrapping.
 */
export function escapeCsvCell(raw: string): string {
  const guarded = FORMULA_LEAD.test(raw) ? `'${raw}` : raw;
  if (/[",\n\r]/.test(guarded)) return `"${guarded.replace(/"/g, '""')}"`;
  return guarded;
}

export function toCsv<T>(rows: T[], columns: ExportColumn<T>[]): string {
  const head = columns.map((c) => escapeCsvCell(c.header)).join(',');
  const body = rows.map((r) => columns.map((c) => escapeCsvCell(cell(c, r))).join(','));
  // CRLF line endings (RFC 4180) so Excel on every platform parses rows correctly.
  return [head, ...body].join('\r\n');
}

/** Build an XLSX workbook (one sheet) via exceljs — guaranteed-valid Office Open XML. */
export async function toXlsx<T>(
  rows: T[],
  columns: ExportColumn<T>[],
  sheetName = 'Export',
): Promise<Buffer> {
  // Lazy import: exceljs is heavy; only load it when an XLSX export actually runs.
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  // Excel caps sheet names at 31 chars and forbids \ / ? * [ ] :
  const ws = wb.addWorksheet(sheetName.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Export');
  ws.addRow(columns.map((c) => c.header));
  ws.getRow(1).font = { bold: true };
  for (const r of rows) {
    ws.addRow(
      columns.map((c) => {
        const v = c.value(r);
        if (v === null || v === undefined) return null;
        if (v instanceof Date) return v;
        // neutralizeFormula guards string cells; numbers/booleans pass through as native types.
        return neutralizeFormula(typeof v === 'number' || typeof v === 'boolean' ? v : String(v));
      }),
    );
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export const EXPORT_MIME: Record<ExportFormat, string> = {
  csv: 'text/csv; charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};
