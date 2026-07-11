/**
 * Import file parsing + template building (IMPORT_EXPORT_STANDARD §5/§8, B-14). The mirror of the
 * export `format.ts`: a domain declares an `ImportColumn[]` manifest (file header → domain field +
 * how to coerce the cell) and the platform turns an uploaded file into typed row objects, or builds
 * the downloadable XLSX template. Pure (bytes → rows / rows → bytes); the engine (`index.ts`) runs
 * validation + processing. Accepts both XLSX and CSV uploads (the template is always XLSX): the
 * format is sniffed by content, not file extension — an XLSX is a zip and starts with the `PK` magic
 * bytes (`parseImportFile`), otherwise the buffer is read as CSV text (UTF-8 BOM stripped, RFC-4180).
 */

import type { Worksheet } from 'exceljs';

export interface ImportColumn {
  /** the domain field id — matches the Create-schema key (e.g. `code`, `name`, `effectiveFrom`). */
  id: string;
  /** the file column header label (what the template prints and the upload is matched against). */
  header: string;
  /** marks the column as expected in the template (informational; the zod schema is the validator). */
  required?: boolean;
  /** coerce a raw cell value to the schema input. Default: trimmed string, or undefined when blank. */
  parse?: (raw: unknown) => unknown;
}

/** A parsed file row: its 1-based file row number (header is row 1) + the column-id → value map. */
export interface ParsedRow {
  rowNumber: number;
  data: Record<string, unknown>;
}

/** Normalize a header for case/whitespace-insensitive matching of the upload to the manifest. */
const normHeader = (s: string): string => s.trim().toLowerCase();

/** Unwrap an exceljs cell value (Date / number / string / boolean / hyperlink / formula / richText). */
function cellRaw(v: unknown): unknown {
  if (v === null || v === undefined) return undefined;
  if (v instanceof Date) return v;
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (typeof o['text'] === 'string') return o['text']; // hyperlink
    if ('result' in o) return o['result']; // formula
    if (Array.isArray(o['richText']))
      return (o['richText'] as { text?: string }[]).map((t) => t.text ?? '').join('');
    return undefined;
  }
  return v;
}

/** Default cell coercion: blank → undefined; otherwise the trimmed string. */
const defaultParse = (raw: unknown): unknown => {
  if (raw === undefined || raw === null) return undefined;
  const s = String(raw).trim();
  return s === '' ? undefined : s;
};

/**
 * Map a parsed grid (a header row + data rows, each a 0-based array of raw cell values) to typed rows.
 * Headers are matched to the manifest by normalized text (unknown file columns are ignored, missing
 * ones simply unset → the schema flags required gaps); data starts at file row 2; fully-blank rows are
 * skipped (not counted as errors). Shared by the XLSX and CSV readers.
 */
function mapRows(header: unknown[], dataRows: unknown[][], columns: ImportColumn[]): ParsedRow[] {
  const byHeader = new Map(columns.map((c) => [normHeader(c.header), c]));
  // file column index (0-based) → manifest entry
  const colAt = new Map<number, ImportColumn>();
  header.forEach((h, idx) => {
    if (typeof h === 'string') {
      const col = byHeader.get(normHeader(h));
      if (col) colAt.set(idx, col);
    }
  });

  const rows: ParsedRow[] = [];
  dataRows.forEach((cells, i) => {
    const data: Record<string, unknown> = {};
    let anyValue = false;
    for (const [idx, col] of colAt) {
      const parsed = (col.parse ?? defaultParse)(cells[idx]);
      if (parsed !== undefined) {
        data[col.id] = parsed;
        anyValue = true;
      }
    }
    if (anyValue) rows.push({ rowNumber: i + 2, data }); // header is file row 1
  });
  return rows;
}

/** Read an uploaded XLSX buffer into a grid + map it to typed rows (row 1 = header). Default (no
 *  `opts.sheet`) reads `worksheets[0]`, pinning today's single-sheet behavior; a named sheet that
 *  isn't found yields no rows — the caller decides what a missing sheet means. */
export async function parseImportXlsx(
  buffer: Buffer,
  columns: ImportColumn[],
  opts?: { sheet?: string },
): Promise<ParsedRow[]> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  // exceljs (4.4) ships a `Buffer` param type from an older @types/node; our toolchain's `Buffer`
  // has a structurally-incompatible `slice` tag. The value IS a valid Node Buffer at runtime — bridge
  // the upstream type skew with a precise assertion (no `any`/suppression).
  await wb.xlsx.load(buffer as unknown as Parameters<typeof wb.xlsx.load>[0]);
  const ws = opts?.sheet ? wb.worksheets.find((w) => w.name === opts.sheet) : wb.worksheets[0];
  if (!ws) return [];
  const toArr = (rowNumber: number): unknown[] => {
    const arr: unknown[] = [];
    ws.getRow(rowNumber).eachCell({ includeEmpty: true }, (cell, col) => {
      arr[col - 1] = cellRaw(cell.value);
    });
    return arr;
  };
  const dataRows: unknown[][] = [];
  for (let r = 2; r <= ws.rowCount; r++) dataRows.push(toArr(r));
  return mapRows(toArr(1), dataRows, columns);
}

/**
 * Minimal RFC-4180 CSV parser → a grid of string cells. Handles quoted fields (embedded commas,
 * newlines, and `""` escapes) and CRLF/LF/CR line endings. A leading UTF-8 BOM is stripped upstream.
 */
function parseCsvGrid(text: string): string[][] {
  const grid: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') {
      quoted = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++; // CRLF → one break
      row.push(field);
      grid.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    grid.push(row);
  }
  return grid;
}

/** Read an uploaded CSV buffer into typed rows (first line = header; all cells are strings). */
export function parseImportCsv(buffer: Buffer, columns: ImportColumn[]): ParsedRow[] {
  let text = buffer.toString('utf8');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // strip UTF-8 BOM (Excel-exported CSVs)
  const grid = parseCsvGrid(text);
  if (grid.length === 0) return [];
  const [header, ...dataRows] = grid as [string[], ...string[][]];
  return mapRows(header, dataRows, columns);
}

/**
 * Read an uploaded import file into typed rows, auto-detecting the format: an XLSX is a zip and starts
 * with the `PK` magic bytes; anything else is treated as CSV text. The manifest's `parse` coercers
 * map a cell (a JS value from XLSX, or a string from CSV) to the shape the zod schema expects.
 * `opts.sheet` selects a named XLSX worksheet (default `worksheets[0]`); ignored for CSV, which is
 * single-sheet by nature.
 */
export function parseImportFile(
  buffer: Buffer,
  columns: ImportColumn[],
  opts?: { sheet?: string },
): Promise<ParsedRow[]> {
  if (buffer.length >= 2 && buffer[0] === 0x50 && buffer[1] === 0x4b)
    return parseImportXlsx(buffer, columns, opts);
  return Promise.resolve(parseImportCsv(buffer, columns));
}

/**
 * Count data rows (excludes the header) without the column manifest — for the sync-vs-job decision.
 * Counts the raw grid (not column-mapped rows, which would be empty with no manifest). `opts.sheet`
 * selects a named XLSX worksheet (default `worksheets[0]`); ignored for CSV.
 */
export async function countImportRows(buffer: Buffer, opts?: { sheet?: string }): Promise<number> {
  if (buffer.length >= 2 && buffer[0] === 0x50 && buffer[1] === 0x4b) {
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as Parameters<typeof wb.xlsx.load>[0]);
    const ws = opts?.sheet ? wb.worksheets.find((w) => w.name === opts.sheet) : wb.worksheets[0];
    return ws ? Math.max(0, ws.rowCount - 1) : 0;
  }
  let text = buffer.toString('utf8');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return Math.max(0, parseCsvGrid(text).length - 1);
}

/** List a file's sheet names: XLSX worksheet names in order, or `['Sheet1']` for CSV (single-sheet
 *  by nature) — feeds the optional sheet-picker UI (ADR-0092 S5). */
export async function listImportSheets(buffer: Buffer): Promise<string[]> {
  if (buffer.length >= 2 && buffer[0] === 0x50 && buffer[1] === 0x4b) {
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as Parameters<typeof wb.xlsx.load>[0]);
    return wb.worksheets.map((w) => w.name);
  }
  return ['Sheet1'];
}

/** A worksheet's body: bold header row from the manifest plus optional sample data row(s). Shared by
 *  `buildImportTemplate` (one sheet) and `buildWorkbookTemplate` (many sheets) — same cell logic. */
function writeTemplateSheet(
  ws: Worksheet,
  columns: ImportColumn[],
  sample?: Record<string, string | number>,
  sampleRows?: Record<string, string | number>[],
): void {
  ws.addRow(columns.map((c) => c.header));
  ws.getRow(1).font = { bold: true };
  const rows = sampleRows ?? (sample ? [sample] : []);
  for (const r of rows) ws.addRow(columns.map((c) => r[c.id] ?? ''));
}

/**
 * Build the downloadable XLSX template: a bold header row from the manifest plus sample data row(s)
 * (so the user sees the expected format). The headers match what the readers look for. Optional
 * `notes` become a second "Notes" worksheet — the importer only reads the first sheet, so a template
 * (with its notes) re-uploads cleanly.
 */
export async function buildImportTemplate(
  columns: ImportColumn[],
  sample?: Record<string, string | number>,
  opts?: { sampleRows?: Record<string, string | number>[]; notes?: string[] },
): Promise<Buffer> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  writeTemplateSheet(wb.addWorksheet('Template'), columns, sample, opts?.sampleRows);
  if (opts?.notes?.length) {
    const NOTES_COL_WIDTH = 110;
    const ns = wb.addWorksheet('Notes');
    ns.getColumn(1).width = NOTES_COL_WIDTH;
    for (const line of opts.notes) ns.addRow([line]);
    ns.getRow(1).font = { bold: true };
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/**
 * Build a multi-sheet XLSX template: one worksheet per entry (in order), same per-sheet body as
 * `buildImportTemplate` (ADR-0092 S4 — bundles several domains' templates into one onboarding
 * workbook download).
 */
export async function buildWorkbookTemplate(
  sheets: { name: string; columns: ImportColumn[]; sample?: Record<string, string | number> }[],
): Promise<Buffer> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  for (const s of sheets) writeTemplateSheet(wb.addWorksheet(s.name), s.columns, s.sample);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
