import { describe, it, expect } from 'vitest';
import { escapeCsvCell, selectColumns, toCsv, toXlsx, type ExportColumn } from '../export/format.js';
import { resolveExport, assertExportable } from '../export/index.js';

interface Row {
  code: string;
  name: string;
  isActive: boolean;
}
const cols: ExportColumn<Row>[] = [
  { id: 'code', header: 'Code', value: (r) => r.code },
  { id: 'name', header: 'Name', value: (r) => r.name },
  { id: 'status', header: 'Status', value: (r) => (r.isActive ? 'Active' : 'Inactive') },
];
const rows: Row[] = [
  { code: 'HDFC', name: 'HDFC Bank', isActive: true },
  { code: 'ICIC', name: 'ICICI, Ltd', isActive: false },
];

describe('escapeCsvCell', () => {
  it('quotes fields containing comma / quote / newline (RFC 4180)', () => {
    expect(escapeCsvCell('ICICI, Ltd')).toBe('"ICICI, Ltd"');
    expect(escapeCsvCell('say "hi"')).toBe('"say ""hi"""');
    expect(escapeCsvCell('a\nb')).toBe('"a\nb"');
    expect(escapeCsvCell('plain')).toBe('plain');
  });

  it('neutralizes formula-injection (CWE-1236) by prefixing a single quote', () => {
    expect(escapeCsvCell('=1+1')).toBe("'=1+1");
    expect(escapeCsvCell('+SUM(A1)')).toBe("'+SUM(A1)");
    expect(escapeCsvCell('-2')).toBe("'-2");
    expect(escapeCsvCell('@cmd')).toBe("'@cmd");
    // a dangerous cell that ALSO needs quoting gets both treatments
    expect(escapeCsvCell('=HYPERLINK("x"),y')).toBe('"\'=HYPERLINK(""x""),y"');
  });
});

describe('toCsv', () => {
  it('emits a header row + CRLF-joined data with escaped cells', () => {
    const csv = toCsv(rows, cols);
    expect(csv).toBe('Code,Name,Status\r\nHDFC,HDFC Bank,Active\r\nICIC,"ICICI, Ltd",Inactive');
  });

  it('null/undefined values render as empty cells', () => {
    const c: ExportColumn<Row>[] = [{ id: 'x', header: 'X', value: () => null }];
    expect(toCsv([{ code: '', name: '', isActive: true }], c)).toBe('X\r\n');
  });

  it('Date values render as ISO-8601 (pg timestamptz columns arrive as Date)', () => {
    const c: ExportColumn<Row>[] = [
      { id: 'd', header: 'When', value: () => new Date('2026-06-07T12:00:00Z') },
    ];
    expect(toCsv([{ code: '', name: '', isActive: true }], c)).toBe('When\r\n2026-06-07T12:00:00.000Z');
  });
});

describe('selectColumns (visible cols)', () => {
  it('restricts + reorders to the visible ids', () => {
    const picked = selectColumns(cols, ['status', 'code']);
    expect(picked.map((c) => c.id)).toEqual(['status', 'code']);
  });
  it('ignores unknown ids and falls back to the full manifest when none match', () => {
    expect(selectColumns(cols, ['nope']).map((c) => c.id)).toEqual(['code', 'name', 'status']);
    expect(selectColumns(cols, []).map((c) => c.id)).toEqual(['code', 'name', 'status']);
  });
});

describe('toXlsx', () => {
  it('produces a valid (PK-zip) XLSX buffer with a header + data rows', async () => {
    const buf = await toXlsx(rows, cols, 'Clients');
    expect(buf.length).toBeGreaterThan(0);
    // XLSX is a ZIP — the OOXML container magic bytes are 'PK'.
    expect(buf.subarray(0, 2).toString('latin1')).toBe('PK');
  });
});

describe('resolveExport', () => {
  it('defaults to xlsx / current', () => {
    expect(resolveExport({})).toEqual({ format: 'xlsx', mode: 'current', cols: [], ids: [] });
  });
  it('parses format/mode/cols', () => {
    expect(resolveExport({ format: 'csv', mode: 'all', cols: 'code,name' })).toEqual({
      format: 'csv',
      mode: 'all',
      cols: ['code', 'name'],
      ids: [],
    });
  });
  it('parses mode=selected with an ids list', () => {
    expect(resolveExport({ mode: 'selected', ids: '1,2,3' })).toEqual({
      format: 'xlsx',
      mode: 'selected',
      cols: [],
      ids: ['1', '2', '3'],
    });
  });
  it('rejects an unknown format / mode (400, never silent)', () => {
    expect(() => resolveExport({ format: 'pdf' })).toThrow();
    expect(() => resolveExport({ mode: 'bogus' })).toThrow();
  });
});

describe('assertExportable', () => {
  it('passes below the threshold and throws 413 EXPORT_TOO_LARGE at/above it', () => {
    expect(() => assertExportable(5)).not.toThrow();
    expect(() => assertExportable(10000)).toThrowError(/EXPORT_TOO_LARGE|background/i);
  });
});
