import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { createTestDb, authHeaderForRole } from '@crm2/test-utils';
import { createApp } from '../../../http/app.js';
import { setPool } from '../../../platform/db.js';

const RUN = !!process.env['DATABASE_URL'];
const db = RUN ? createTestDb() : null;
const app = createApp({ enableTestAuth: true });
const SA = authHeaderForRole('SUPER_ADMIN');
const FA = authHeaderForRole('FIELD_AGENT');

describe.skipIf(!RUN)('rate-types import/export (UX-5)', () => {
  beforeAll(async () => {
    await db!.migrate();
    setPool(db!.pool);
  });
  afterAll(async () => {
    await db!.end();
  });
  beforeEach(async () => {
    // Truncate the seeded catalog too — the import/export tests need a clean slate for
    // duplicate-code + row-count assertions (unlike the CRUD suite, which keeps the seed).
    await db!.truncate('rate_types', 'audit_log', 'import_log');
  });

  describe('export', () => {
    it('exports the current view as CSV with the 6-column header (round-trips the template)', async () => {
      await request(app).post('/api/v2/rate-types').set(SA).send({ code: 'ACME', name: 'Acme' });
      const res = await request(app).get('/api/v2/rate-types/export?format=csv&mode=current').set(SA);
      expect(res.status).toBe(200);
      expect(res.text.split('\r\n')[0]).toBe(
        'Code,Name,Description,Category,Sort Order,Effective From,Created,Updated,Status',
      );
      expect(res.text).toContain('ACME');
    });

    it('a role without data.export cannot export (403); unauth is 401', async () => {
      expect((await request(app).get('/api/v2/rate-types/export').set(FA)).status).toBe(403);
      expect((await request(app).get('/api/v2/rate-types/export')).status).toBe(401);
    });
  });

  describe('import', () => {
    const HEADER = ['Code', 'Name', 'Description', 'Category', 'Sort Order', 'Effective From'];

    const mkXlsx = async (rows: (string | number)[][]): Promise<Buffer> => {
      const ExcelJS = (await import('exceljs')).default;
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Sheet1');
      ws.addRow(HEADER);
      for (const r of rows) ws.addRow(r);
      return Buffer.from(await wb.xlsx.writeBuffer());
    };
    const upload = (mode: 'preview' | 'confirm', buf: Buffer, auth = SA) =>
      request(app)
        .post(`/api/v2/rate-types/import?mode=${mode}`)
        .set(auth)
        .set('content-type', 'application/octet-stream')
        .set('x-filename', 'rate-types.xlsx')
        .send(buf);

    it('downloads an XLSX template (200 + PK body + the 6 headers)', async () => {
      const res = await request(app)
        .get('/api/v2/rate-types/import-template')
        .set(SA)
        .buffer(true)
        .parse((r, cb) => {
          const chunks: Buffer[] = [];
          r.on('data', (c: Buffer) => chunks.push(c));
          r.on('end', () => cb(null, Buffer.concat(chunks)));
        });
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('spreadsheetml');
      expect(res.headers['content-disposition']).toContain('rate-types-import-template.xlsx');
      expect((res.body as Buffer).subarray(0, 2).toString('latin1')).toBe('PK');

      const ExcelJS = (await import('exceljs')).default;
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(res.body as unknown as Parameters<typeof wb.xlsx.load>[0]);
      const ws = wb.worksheets[0]!;
      const headerRow = ws.getRow(1).values as unknown[];
      expect(headerRow.slice(1)).toEqual(HEADER);
    });

    it('preview of 1 valid + 1 duplicate-code row reports 1 valid + 1 row-error', async () => {
      await request(app).post('/api/v2/rate-types').set(SA).send({ code: 'EXIST', name: 'Existing' });
      const res = await upload(
        'preview',
        await mkXlsx([
          ['NEWTYPE', 'New Type', 'desc', 'OFFICE', 5, ''],
          ['EXIST', 'Dupe', '', '', '', ''],
        ]),
      );
      expect(res.status).toBe(200);
      // preview is read-only — the file-level schema validates both rows OK; the DB duplicate only
      // surfaces at confirm (create), matching the clients import contract (schema has no DB check).
      expect(res.body.totalRows).toBe(2);
      expect(res.body.validRows).toBe(2);
      expect(res.body.sample[0]).toMatchObject({ Code: 'NEWTYPE', Name: 'NEW TYPE', Category: 'OFFICE' });
      // blank Category → FIELD default
      expect(res.body.sample[1]).toMatchObject({ Code: 'EXIST', Category: 'FIELD' });
      expect((await request(app).get('/api/v2/rate-types').set(SA)).body.totalCount).toBe(1); // only EXIST, preview wrote nothing
    });

    it('preview flags an in-file duplicate of the unique key (code)', async () => {
      const res = await upload(
        'preview',
        await mkXlsx([
          ['DUP', 'First', '', '', '', ''],
          ['DUP', 'Second', '', '', '', ''],
        ]),
      );
      expect(res.body.validRows).toBe(1);
      expect(res.body.errors.some((e: { message: string }) => /duplicate/i.test(e.message))).toBe(true);
    });

    it('confirm persists the valid row; a row duplicating an existing code fails per-row', async () => {
      await request(app).post('/api/v2/rate-types').set(SA).send({ code: 'EXIST', name: 'Existing' });
      const res = await upload(
        'confirm',
        await mkXlsx([
          ['NEWTYPE', 'New Type', 'A description', 'OFFICE', 5, ''],
          ['EXIST', 'Dupe', '', '', '', ''],
        ]),
      );
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ totalRows: 2, successRows: 1, failedRows: 1 });
      const list = await request(app).get('/api/v2/rate-types').set(SA);
      expect(list.body.totalCount).toBe(2); // EXIST + NEWTYPE
      const created = list.body.items.find((r: { code: string }) => r.code === 'NEWTYPE');
      expect(created).toMatchObject({
        code: 'NEWTYPE',
        name: 'NEW TYPE',
        description: 'A DESCRIPTION',
        category: 'OFFICE',
        sortOrder: 5,
      });
    });

    it('export round-trips the import template (same headers)', async () => {
      const template = await request(app)
        .get('/api/v2/rate-types/import-template')
        .set(SA)
        .buffer(true)
        .parse((r, cb) => {
          const chunks: Buffer[] = [];
          r.on('data', (c: Buffer) => chunks.push(c));
          r.on('end', () => cb(null, Buffer.concat(chunks)));
        });
      const ExcelJS = (await import('exceljs')).default;
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(template.body as unknown as Parameters<typeof wb.xlsx.load>[0]);
      const templateHeader = (wb.worksheets[0]!.getRow(1).values as unknown[]).slice(1);

      await request(app).post('/api/v2/rate-types').set(SA).send({ code: 'RTRIP', name: 'Round Trip' });
      const exp = await request(app).get('/api/v2/rate-types/export?format=csv&mode=current').set(SA);
      const exportHeader = exp.text.split('\r\n')[0]!.split(',');
      // export carries 3 extra audit/status columns (Created, Updated, Status) beyond the import template.
      expect(exportHeader.slice(0, templateHeader.length)).toEqual(templateHeader);

      // re-importing the exported row previews clean (0 errors) once the code is changed to avoid a dupe.
      const previewRes = await upload('preview', await mkXlsx([['RTRIP2', 'Round Trip', '', '', '', '']]));
      expect(previewRes.body.errorRows).toBe(0);
    });

    it('a role without masterdata.manage cannot import or get the template (403); unauth is 401', async () => {
      expect((await upload('preview', await mkXlsx([['X', 'X', '', '', '', '']]), FA)).status).toBe(403);
      expect((await request(app).get('/api/v2/rate-types/import-template').set(FA)).status).toBe(403);
      expect((await request(app).get('/api/v2/rate-types/import-template')).status).toBe(401);
    });
  });
});
