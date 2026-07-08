import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import ExcelJS from 'exceljs';
import { parseImportCsv, parseImportXlsx, parseImportFile, countImportRows } from '../format.js';
import { runImportPreview, type ImportSpec } from '../index.js';
import type { ImportColumn } from '../format.js';

const COLUMNS: ImportColumn[] = [
  { id: 'code', header: 'Code', required: true },
  { id: 'name', header: 'Name', required: true },
];

const schema = z.object({ code: z.string().min(1), name: z.string().min(1) });
const spec: ImportSpec<{ code: string; name: string }> = { resource: 'widgets', columns: COLUMNS, schema };

const mkXlsx = async (rows: (string | number)[][]): Promise<Buffer> => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  ws.addRow(['Code', 'Name']);
  for (const r of rows) ws.addRow(r);
  return Buffer.from(await wb.xlsx.writeBuffer());
};

describe('CSV import — parity with XLSX (UX-14)', () => {
  it('an identical 2-row dataset imports EQUAL via xlsx and csv (same preview result)', async () => {
    const xlsxBuf = await mkXlsx([
      ['ACME', 'Acme Corp'],
      ['GLOBEX', 'Globex Inc'],
    ]);
    const csvBuf = Buffer.from('Code,Name\r\nACME,Acme Corp\r\nGLOBEX,Globex Inc\r\n', 'utf8');

    // maxRows passed explicitly — the default reads process env (DATABASE_URL) via loadEnv(),
    // which this pure-parser unit test has no need of.
    const xlsxResult = await runImportPreview(xlsxBuf, spec, { maxRows: 100 });
    const csvResult = await runImportPreview(csvBuf, spec, { maxRows: 100 });

    expect(csvResult).toEqual(xlsxResult);
    expect(xlsxResult.validRows).toBe(2);
    expect(xlsxResult.errorRows).toBe(0);
  });

  it('detects format by content, not by extension (magic-byte sniff)', async () => {
    const csvBuf = Buffer.from('Code,Name\r\nACME,Acme Corp\r\n', 'utf8');
    const rows = await parseImportFile(csvBuf, COLUMNS);
    expect(rows).toEqual([{ rowNumber: 2, data: { code: 'ACME', name: 'Acme Corp' } }]);
  });

  it('handles CRLF line endings', () => {
    const rows = parseImportCsv(Buffer.from('Code,Name\r\nACME,Acme Corp\r\nGLOBEX,Globex Inc\r\n'), COLUMNS);
    expect(rows).toHaveLength(2);
    expect(rows[1]?.data).toEqual({ code: 'GLOBEX', name: 'Globex Inc' });
  });

  it('handles bare LF line endings', () => {
    const rows = parseImportCsv(Buffer.from('Code,Name\nACME,Acme Corp\n'), COLUMNS);
    expect(rows).toEqual([{ rowNumber: 2, data: { code: 'ACME', name: 'Acme Corp' } }]);
  });

  it('handles a quoted cell containing a comma', () => {
    const rows = parseImportCsv(Buffer.from('Code,Name\r\nACME,"Acme, Corp"\r\n'), COLUMNS);
    expect(rows[0]?.data['name']).toBe('Acme, Corp');
  });

  it('handles a quoted cell with an escaped embedded quote', () => {
    const rows = parseImportCsv(Buffer.from('Code,Name\r\nACME,"Say ""hi"""\r\n'), COLUMNS);
    expect(rows[0]?.data['name']).toBe('Say "hi"');
  });

  it('strips a leading UTF-8 BOM (Excel-saved CSVs)', () => {
    const bom = Buffer.from([0xef, 0xbb, 0xbf]);
    const body = Buffer.from('Code,Name\r\nACME,Acme Corp\r\n', 'utf8');
    const rows = parseImportCsv(Buffer.concat([bom, body]), COLUMNS);
    expect(rows).toEqual([{ rowNumber: 2, data: { code: 'ACME', name: 'Acme Corp' } }]);
  });

  it('an empty file parses to zero rows, not a crash', () => {
    expect(parseImportCsv(Buffer.alloc(0), COLUMNS)).toEqual([]);
  });

  it('countImportRows agrees between xlsx and csv for the same dataset', async () => {
    const xlsxBuf = await mkXlsx([
      ['ACME', 'Acme Corp'],
      ['GLOBEX', 'Globex Inc'],
    ]);
    const csvBuf = Buffer.from('Code,Name\r\nACME,Acme Corp\r\nGLOBEX,Globex Inc\r\n', 'utf8');
    expect(await countImportRows(csvBuf)).toBe(await countImportRows(xlsxBuf));
    expect(await countImportRows(csvBuf)).toBe(2);
  });

  it('countImportRows on an empty csv buffer is 0, not negative/NaN', async () => {
    expect(await countImportRows(Buffer.alloc(0))).toBe(0);
  });

  it('xlsx path is unaffected (sanity — parseImportXlsx still parses row 1 as header)', async () => {
    const xlsxBuf = await mkXlsx([['ACME', 'Acme Corp']]);
    const rows = await parseImportXlsx(xlsxBuf, COLUMNS);
    expect(rows).toEqual([{ rowNumber: 2, data: { code: 'ACME', name: 'Acme Corp' } }]);
  });
});
