import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import ExcelJS from 'exceljs';
import { createTestDb, clientFactory, authHeaderForRole } from '@crm2/test-utils';
import { createApp } from '../../../http/app.js';
import { setPool } from '../../../platform/db.js';
import { ONBOARDING_SHEET_NAMES } from '../onboarding.js';
import { MASTER_IMPORT_COLUMNS } from '../../shared/masterDataImport.js';
import { CPV_IMPORT_COLUMNS } from '../../cpv/import.js';
import { RATE_TYPE_ASSIGNMENT_IMPORT_COLUMNS } from '../../rateTypeAssignments/import.js';
import { RATE_IMPORT_COLUMNS } from '../../rates/import.js';
import { COMMISSION_RATE_IMPORT_COLUMNS } from '../../commissionRates/import.js';

const RUN = !!process.env['DATABASE_URL'];
const db = RUN ? createTestDb() : null;
const app = createApp({ enableTestAuth: true });
const SA = authHeaderForRole('SUPER_ADMIN');
const BE = authHeaderForRole('BACKEND_USER');

const SHEET_COLUMNS: Record<(typeof ONBOARDING_SHEET_NAMES)[number], { header: string }[]> = {
  Products: MASTER_IMPORT_COLUMNS,
  CPV: CPV_IMPORT_COLUMNS,
  RateTypeAssignments: RATE_TYPE_ASSIGNMENT_IMPORT_COLUMNS,
  Rates: RATE_IMPORT_COLUMNS,
  CommissionRates: COMMISSION_RATE_IMPORT_COLUMNS,
};

describe.skipIf(!RUN)('client onboarding template API', () => {
  beforeAll(async () => {
    await db!.migrate();
    setPool(db!.pool);
  });
  afterAll(async () => {
    await db!.end();
  });
  beforeEach(async () => {
    await db!.truncate('clients', 'audit_log');
  });

  const download = (id: number, auth: Record<string, string>) =>
    request(app)
      .get(`/api/v2/clients/${id}/onboarding-template`)
      .set(auth)
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => {
          const buf = Buffer.concat(chunks);
          // Error responses are JSON (checked via `.body.error` below); only a 200 is the XLSX buffer.
          cb(null, (r.statusCode ?? 0) >= 400 ? JSON.parse(buf.toString('utf8') || '{}') : buf);
        });
      });

  it('SUPER_ADMIN downloads a 5-sheet workbook, headers byte-equal + Client Code pre-filled', async () => {
    const created = await request(app)
      .post('/api/v2/clients')
      .set(SA)
      .send(clientFactory({ code: 'ONBOARD1' }));
    const id = created.body.id as number;

    const res = await download(id, SA);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');
    expect(res.headers['content-disposition']).toContain('client-ONBOARD1-onboarding-import-template.xlsx');
    const buf = res.body as Buffer;
    expect(buf.subarray(0, 2).toString('latin1')).toBe('PK');

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as Parameters<typeof wb.xlsx.load>[0]);
    expect(wb.worksheets.map((w) => w.name)).toEqual([...ONBOARDING_SHEET_NAMES]);

    for (const name of ONBOARDING_SHEET_NAMES) {
      const ws = wb.getWorksheet(name)!;
      const expectedHeaders = SHEET_COLUMNS[name].map((c) => c.header);
      const actualHeaders: unknown[] = [];
      ws.getRow(1).eachCell({ includeEmpty: true }, (cell, col) => {
        actualHeaders[col - 1] = cell.value;
      });
      expect(actualHeaders).toEqual(expectedHeaders);

      const clientCodeIdx = SHEET_COLUMNS[name].findIndex((c) => c.header === 'Client Code');
      if (clientCodeIdx >= 0) {
        expect(ws.getRow(2).getCell(clientCodeIdx + 1).value).toBe('ONBOARD1');
      }
    }
  });

  it('unknown client id -> 404 CLIENT_NOT_FOUND', async () => {
    const res = await download(999999, SA);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('CLIENT_NOT_FOUND');
  });

  it('BACKEND_USER (no masterdata.manage) -> 403', async () => {
    const created = await request(app)
      .post('/api/v2/clients')
      .set(SA)
      .send(clientFactory({ code: 'ONBOARD2' }));
    const id = created.body.id as number;
    const res = await download(id, BE);
    expect(res.status).toBe(403);
  });

  it('unauthenticated request -> 401', async () => {
    const res = await request(app).get('/api/v2/clients/1/onboarding-template');
    expect(res.status).toBe(401);
  });
});
