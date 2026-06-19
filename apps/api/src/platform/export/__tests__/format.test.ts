import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { toCsv, toXlsx, escapeCsvCell } from '../format.js';
import type { ExportColumn } from '../format.js';

type Row = { label: string; value: string | number };

const columns: ExportColumn<Row>[] = [
  { id: 'label', header: 'Label', value: (r) => r.label },
  { id: 'value', header: 'Value', value: (r) => r.value },
];

const dangerousRows: Row[] = [
  { label: '=HYPERLINK("http://evil.example")', value: 42 },
  { label: '+1', value: 0 },
  { label: '-2', value: -1 },
  { label: '@cmd', value: 100 },
  { label: 'ok', value: 1 },
];

describe('escapeCsvCell — formula injection (CWE-1236)', () => {
  it('neutralizes leading = + - @ in CSV', () => {
    expect(escapeCsvCell('=HYPERLINK("x")')).toMatch(/^'/);
    expect(escapeCsvCell('+1')).toMatch(/^'/);
    expect(escapeCsvCell('-2')).toMatch(/^'/);
    expect(escapeCsvCell('@cmd')).toMatch(/^'/);
    expect(escapeCsvCell('ok')).toBe('ok');
  });
});

describe('toCsv — formula injection', () => {
  it('prefixes dangerous leading chars in CSV cells', () => {
    const csv = toCsv(dangerousRows, columns);
    const lines = csv.split('\r\n');
    // header line
    expect(lines[0]).toBe('Label,Value');
    // dangerous rows are neutralized (column 0)
    expect(lines[1]).toMatch(/^'=/);
    expect(lines[2]).toMatch(/^'\+/);
    expect(lines[3]).toMatch(/^'-/);
    expect(lines[4]).toMatch(/^'@/);
    // safe row is untouched
    expect(lines[5]).toBe('ok,1');
  });
});

describe('toXlsx — formula injection (CWE-1236)', () => {
  it('does not store formula-leading string cells as live Excel formulas', async () => {
    const buf = await toXlsx(dangerousRows, columns);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as Parameters<typeof wb.xlsx.load>[0]);
    const ws = wb.getWorksheet(1)!;

    // Row 2 is the first data row (row 1 = header)
    const formulaLeadingCases = ['=HYPERLINK("http://evil.example")', '+1', '-2', '@cmd'];

    for (let i = 0; i < formulaLeadingCases.length; i++) {
      const dataRow = ws.getRow(i + 2); // row 2, 3, 4, 5
      const cell = dataRow.getCell(1); // column 1 = label

      // Must NOT be stored as a formula object
      const cellValue = cell.value;
      expect(
        typeof cellValue === 'object' && cellValue !== null && 'formula' in cellValue,
        `row ${i + 2} label "${formulaLeadingCases[i]}" must not be a formula object, got: ${JSON.stringify(cellValue)}`,
      ).toBe(false);

      // Must be a string (the neutralized value)
      expect(typeof cellValue, `row ${i + 2} label must be a string`).toBe('string');
    }

    // Numbers must stay as native numbers
    const row2 = ws.getRow(2);
    expect(typeof row2.getCell(2).value).toBe('number');

    // Safe string cell is untouched
    const safeRow = ws.getRow(6);
    expect(safeRow.getCell(1).value).toBe('ok');
  });
});
