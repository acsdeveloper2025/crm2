import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { buildImportTemplate, buildWorkbookTemplate, type ImportColumn } from '../format.js';

const COLUMNS_A: ImportColumn[] = [
  { id: 'code', header: 'Code', required: true },
  { id: 'name', header: 'Name', required: true },
];
const COLUMNS_B: ImportColumn[] = [{ id: 'amount', header: 'Amount', required: true }];

describe('buildWorkbookTemplate (ADR-0092 S4)', () => {
  it('writes one worksheet per entry, in order, each with its own header + sample row', async () => {
    const buf = await buildWorkbookTemplate([
      { name: 'Sheet1', columns: COLUMNS_A, sample: { code: 'ACME', name: 'Acme Corp' } },
      { name: 'Sheet2', columns: COLUMNS_B },
    ]);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as Parameters<typeof wb.xlsx.load>[0]);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Sheet1', 'Sheet2']);

    const ws1 = wb.getWorksheet('Sheet1')!;
    expect(ws1.getRow(1).values).toEqual([undefined, 'Code', 'Name']);
    expect(ws1.getRow(1).font).toEqual({ bold: true });
    expect(ws1.getRow(2).values).toEqual([undefined, 'ACME', 'Acme Corp']);

    const ws2 = wb.getWorksheet('Sheet2')!;
    expect(ws2.getRow(1).values).toEqual([undefined, 'Amount']);
    expect(ws2.rowCount).toBe(1); // no sample → no second row
  });

  it('matches buildImportTemplate cell logic for a single sheet (same header/sample behavior)', async () => {
    const single = await buildImportTemplate(COLUMNS_A, { code: 'ACME', name: 'Acme Corp' });
    const multi = await buildWorkbookTemplate([
      { name: 'Template', columns: COLUMNS_A, sample: { code: 'ACME', name: 'Acme Corp' } },
    ]);

    const wbSingle = new ExcelJS.Workbook();
    await wbSingle.xlsx.load(single as unknown as Parameters<typeof wbSingle.xlsx.load>[0]);
    const wbMulti = new ExcelJS.Workbook();
    await wbMulti.xlsx.load(multi as unknown as Parameters<typeof wbMulti.xlsx.load>[0]);

    expect(wbMulti.worksheets[0]!.getRow(1).values).toEqual(wbSingle.worksheets[0]!.getRow(1).values);
    expect(wbMulti.worksheets[0]!.getRow(2).values).toEqual(wbSingle.worksheets[0]!.getRow(2).values);
  });
});
