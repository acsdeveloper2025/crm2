import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import ExcelJS from 'exceljs';
import {
  createTestDb,
  clientFactory,
  productFactory,
  verificationUnitFactory,
  authHeaderForRole,
} from '@crm2/test-utils';
import type { OnboardingPreviewResult, OnboardingSheetPreview } from '@crm2/sdk';
import { createApp } from '../../../http/app.js';
import { setPool } from '../../../platform/db.js';
import { ONBOARDING_SHEET_NAMES } from '../onboarding.js';
import { MASTER_IMPORT_COLUMNS } from '../../shared/masterDataImport.js';
import { WORKBOOK_CPV_IMPORT_COLUMNS } from '../../cpv/import.js';
import { RATE_TYPE_ASSIGNMENT_IMPORT_COLUMNS } from '../../rateTypeAssignments/import.js';
import { RATE_IMPORT_COLUMNS } from '../../rates/import.js';
import { COMMISSION_RATE_IMPORT_COLUMNS } from '../../commissionRates/import.js';

const RUN = !!process.env['DATABASE_URL'];
const db = RUN ? createTestDb() : null;
const app = createApp({ enableTestAuth: true });
const SA = authHeaderForRole('SUPER_ADMIN');
const BE = authHeaderForRole('BACKEND_USER'); // holds masterdata.view but not masterdata.manage -> 403

type SheetName = (typeof ONBOARDING_SHEET_NAMES)[number];

// Same header set the runner's specs use to parse each named sheet (WORKBOOK_CPV — unitCode optional,
// per ADR-0092 S5 — not the standalone CPV_IMPORT_COLUMNS).
const SHEET_COLUMNS: Record<SheetName, { id: string; header: string }[]> = {
  Products: MASTER_IMPORT_COLUMNS,
  CPV: WORKBOOK_CPV_IMPORT_COLUMNS,
  RateTypeAssignments: RATE_TYPE_ASSIGNMENT_IMPORT_COLUMNS,
  Rates: RATE_IMPORT_COLUMNS,
  CommissionRates: COMMISSION_RATE_IMPORT_COLUMNS,
};

type Row = Record<string, string | number>;

/** Build a 5-sheet onboarding workbook — one worksheet per ONBOARDING_SHEET_NAMES entry (always
 *  present, even when empty — a genuinely absent sheet is covered by the module's own missing-sheet
 *  handling, not re-tested here), rows keyed by column id (mapped to the real header on write). */
async function buildWorkbook(sheets: Partial<Record<SheetName, Row[]>>): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  for (const name of ONBOARDING_SHEET_NAMES) {
    const ws = wb.addWorksheet(name);
    const columns = SHEET_COLUMNS[name];
    ws.addRow(columns.map((c) => c.header));
    for (const row of sheets[name] ?? []) {
      ws.addRow(columns.map((c) => row[c.id] ?? ''));
    }
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** A workbook whose sheets carry `n` filler rows each (or just the named sheet) — for the 413 cap
 *  tests, where row COUNT is all that matters (caps run before any schema parsing). */
async function buildFillerWorkbook(rowsPerSheet: Partial<Record<SheetName, number>>): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  for (const name of ONBOARDING_SHEET_NAMES) {
    const ws = wb.addWorksheet(name);
    const columns = SHEET_COLUMNS[name];
    ws.addRow(columns.map((c) => c.header));
    const n = rowsPerSheet[name] ?? 0;
    for (let i = 0; i < n; i++) ws.addRow([`R${i}`]);
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const upload = (clientId: number, mode: 'preview' | 'confirm' | string, buf: Buffer, auth = SA) =>
  request(app)
    .post(`/api/v2/clients/${clientId}/onboarding-import?mode=${mode}`)
    .set(auth)
    .set('content-type', 'application/octet-stream')
    .set('x-filename', 'onboarding.xlsx')
    .send(buf);

const newClient = async (code: string): Promise<{ id: number; code: string }> => {
  const res = await request(app).post('/api/v2/clients').set(SA).send(clientFactory({ code }));
  return { id: res.body.id as number, code: res.body.code as string };
};
const newProduct = async (code: string): Promise<{ id: number; code: string }> => {
  const res = await request(app).post('/api/v2/products').set(SA).send(productFactory({ code }));
  return { id: res.body.id as number, code: res.body.code as string };
};
const newUnit = async (code: string): Promise<{ id: number; code: string }> => {
  const res = await request(app)
    .post('/api/v2/verification-units')
    .set(SA)
    .send(verificationUnitFactory({ code }));
  return { id: res.body.id as number, code: res.body.code as string };
};
const newRateType = async (code: string, category: 'FIELD' | 'OFFICE' = 'FIELD'): Promise<string> => {
  const res = await request(app).post('/api/v2/rate-types').set(SA).send({ code, name: code, category });
  return res.body.code as string;
};
const newUser = async (username: string): Promise<string> => {
  const res = await request(app)
    .post('/api/v2/users')
    .set(SA)
    .send({
      email: `${username}@test.crm2.local`,
      username,
      name: username.toUpperCase(),
      role: 'FIELD_AGENT',
    });
  return res.body.username as string;
};

const byName = (result: OnboardingPreviewResult, name: SheetName): OnboardingSheetPreview => {
  const sheet = result.sheets.find((s) => s.name === name);
  if (!sheet) throw new Error(`sheet ${name} missing from result`);
  return sheet;
};

describe.skipIf(!RUN)('client onboarding workbook import API (ADR-0092 S5)', () => {
  beforeAll(async () => {
    await db!.migrate();
    setPool(db!.pool);
  });
  afterAll(async () => {
    await db!.end();
  });
  beforeEach(async () => {
    await db!.truncate(
      'clients',
      'products',
      'verification_units',
      'client_products',
      'client_product_verification_units',
      'rate_types',
      'rate_type_assignments',
      'rates',
      'commission_rates',
      'locations',
      'users',
      'audit_log',
      'import_log',
    );
  });

  it('cross-sheet code resolve: a product only in the Products sheet salvages CPV/RTA/Rates rows to pending, 0 errors', async () => {
    const client = await newClient('ONB_C1');
    const unit = await newUnit('ONB_U1');
    const rateType = await newRateType('ONB_RT1');

    const buf = await buildWorkbook({
      Products: [{ code: 'ONB_NEWPROD', name: 'Brand New Product' }],
      CPV: [{ clientCode: client.code, productCode: 'ONB_NEWPROD', unitCode: 'UNIVERSAL' }],
      RateTypeAssignments: [
        { clientCode: client.code, productCode: 'ONB_NEWPROD', unitCode: '', rateTypeCode: rateType },
      ],
      Rates: [
        {
          clientCode: client.code,
          productCode: 'ONB_NEWPROD',
          unitCode: unit.code,
          amount: 100,
        },
      ],
    });

    const res = await upload(client.id, 'preview', buf);
    expect(res.status).toBe(200);
    const body = res.body as OnboardingPreviewResult;

    expect(byName(body, 'Products')).toMatchObject({
      totalRows: 1,
      validRows: 1,
      pendingRows: 0,
      errorRows: 0,
    });
    expect(byName(body, 'CPV')).toMatchObject({ totalRows: 1, validRows: 0, pendingRows: 1, errorRows: 0 });
    expect(byName(body, 'RateTypeAssignments')).toMatchObject({
      totalRows: 1,
      validRows: 0,
      pendingRows: 1,
      errorRows: 0,
    });
    expect(byName(body, 'Rates')).toMatchObject({ totalRows: 1, validRows: 0, pendingRows: 1, errorRows: 0 });
  });

  it('same-sheet CPV pair projection: a brand-new (client,product) link + concrete unit is pending, not "no usable link"', async () => {
    const client = await newClient('ONB_C2');
    const product = await newProduct('ONB_P2');
    const unit = await newUnit('ONB_U2');
    // Deliberately NO client-products link pre-created — the pair is brand new.

    const buf = await buildWorkbook({
      CPV: [{ clientCode: client.code, productCode: product.code, unitCode: unit.code }],
    });

    const res = await upload(client.id, 'preview', buf);
    expect(res.status).toBe(200);
    const cpv = byName(res.body as OnboardingPreviewResult, 'CPV');
    expect(cpv).toMatchObject({ totalRows: 1, validRows: 0, pendingRows: 1, errorRows: 0 });
    expect(cpv.errors.some((e) => /no usable client-product link/i.test(e.message))).toBe(false);
  });

  it('RTA-tuple -> Rates: an assignment declared only in the RTA sheet makes the rate row pending; without it, RATE_TYPE_NOT_ASSIGNED', async () => {
    const client = await newClient('ONB_C3');
    const product = await newProduct('ONB_P3');
    const unit = await newUnit('ONB_U3');
    const rateType = await newRateType('ONB_RT3');
    // Pre-existing CPV link so this test isolates the RTA-tuple behavior from CPV_LINK_MISSING.
    await request(app)
      .post('/api/v2/client-products')
      .set(SA)
      .send({ clientId: client.id, productId: product.id });

    const withRta = await buildWorkbook({
      RateTypeAssignments: [
        { clientCode: client.code, productCode: product.code, unitCode: unit.code, rateTypeCode: rateType },
      ],
      Rates: [
        {
          clientCode: client.code,
          productCode: product.code,
          unitCode: unit.code,
          clientRateType: rateType,
          amount: 100,
        },
      ],
    });
    const resWithRta = await upload(client.id, 'preview', withRta);
    expect(resWithRta.status).toBe(200);
    const ratesWithRta = byName(resWithRta.body as OnboardingPreviewResult, 'Rates');
    expect(ratesWithRta).toMatchObject({ validRows: 0, pendingRows: 1, errorRows: 0 });

    const withoutRta = await buildWorkbook({
      Rates: [
        {
          clientCode: client.code,
          productCode: product.code,
          unitCode: unit.code,
          clientRateType: rateType,
          amount: 100,
        },
      ],
    });
    const resWithoutRta = await upload(client.id, 'preview', withoutRta);
    expect(resWithoutRta.status).toBe(200);
    const ratesWithoutRta = byName(resWithoutRta.body as OnboardingPreviewResult, 'Rates');
    expect(ratesWithoutRta.errorRows).toBe(1);
    expect(ratesWithoutRta.errors.some((e) => /RATE_TYPE_NOT_ASSIGNED/.test(e.message))).toBe(true);
  });

  it('CPV_LINK_MISSING on a rates row for an unlinked pair absent from the CPV sheet', async () => {
    const client = await newClient('ONB_C4');
    const product = await newProduct('ONB_P4');
    const unit = await newUnit('ONB_U4');
    // No CPV sheet row, no pre-existing client-products link.

    const buf = await buildWorkbook({
      Rates: [{ clientCode: client.code, productCode: product.code, unitCode: unit.code, amount: 100 }],
    });
    const res = await upload(client.id, 'preview', buf);
    expect(res.status).toBe(200);
    const rates = byName(res.body as OnboardingPreviewResult, 'Rates');
    expect(rates.errorRows).toBe(1);
    expect(rates.errors.some((e) => /CPV_LINK_MISSING/.test(e.message))).toBe(true);
  });

  it('CLIENT_MISMATCH on a CPV row with another client code; blank CommissionRates clientCode is OK', async () => {
    const target = await newClient('ONB_C5');
    const other = await newClient('ONB_C5B');
    const product = await newProduct('ONB_P5');
    const user = await newUser('onb_user5');
    // ADR-0050 waives the location requirement only for the LITERAL code 'OFFICE' (a flat desk rate).
    const officeRateType = await newRateType('OFFICE', 'OFFICE');

    const buf = await buildWorkbook({
      CPV: [{ clientCode: other.code, productCode: product.code, unitCode: 'UNIVERSAL' }],
      CommissionRates: [{ username: user, fieldRateType: officeRateType, amount: 50 }], // clientCode blank = universal
    });
    const res = await upload(target.id, 'preview', buf);
    expect(res.status).toBe(200);
    const body = res.body as OnboardingPreviewResult;

    const cpv = byName(body, 'CPV');
    expect(cpv.errorRows).toBe(1);
    expect(cpv.errors.some((e) => /CLIENT_MISMATCH/.test(e.message))).toBe(true);

    const commission = byName(body, 'CommissionRates');
    expect(commission).toMatchObject({ errorRows: 0 });
  });

  it("UNKNOWN_RATE_TYPE on the CommissionRates sheet for a typo'd rate type code", async () => {
    const client = await newClient('ONB_C6');
    const user = await newUser('onb_user6');
    await request(app)
      .post('/api/v2/locations')
      .set(SA)
      .send({ pincode: '400006', area: 'Onb6', city: 'Mumbai', state: 'Maharashtra' });

    const buf = await buildWorkbook({
      CommissionRates: [
        {
          username: user,
          fieldRateType: 'NOT_A_REAL_RATE_TYPE',
          clientCode: client.code,
          pincode: '400006',
          area: 'Onb6',
          amount: 50,
        },
      ],
    });
    const res = await upload(client.id, 'preview', buf);
    expect(res.status).toBe(200);
    const commission = byName(res.body as OnboardingPreviewResult, 'CommissionRates');
    expect(commission.errorRows).toBe(1);
    expect(commission.errors.some((e) => /UNKNOWN_RATE_TYPE/.test(e.message))).toBe(true);
  });

  it('a future-effectiveFrom product referenced by a rates row errors in preview (not pending)', async () => {
    const client = await newClient('ONB_C7');
    const unit = await newUnit('ONB_U7');
    const future = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();

    const buf = await buildWorkbook({
      Products: [{ code: 'ONB_FUTUREPROD', name: 'Future Product', effectiveFrom: future }],
      Rates: [{ clientCode: client.code, productCode: 'ONB_FUTUREPROD', unitCode: unit.code, amount: 100 }],
    });
    const res = await upload(client.id, 'preview', buf);
    expect(res.status).toBe(200);
    const body = res.body as OnboardingPreviewResult;
    expect(byName(body, 'Products')).toMatchObject({ validRows: 1, errorRows: 0 });
    const rates = byName(body, 'Rates');
    expect(rates.errorRows).toBe(1);
    expect(rates.errors.some((e) => /not usable/i.test(e.message))).toBe(true);
  });

  it('413 per-sheet (one sheet >= threshold) and 413 total (every sheet under threshold, sum over)', async () => {
    const client = await newClient('ONB_C8');

    const perSheetBig = await buildFillerWorkbook({ Products: 10000 });
    const perSheetRes = await upload(client.id, 'preview', perSheetBig);
    expect(perSheetRes.status).toBe(413);
    expect(perSheetRes.body.error).toBe('IMPORT_TOO_LARGE');

    const totalBig = await buildFillerWorkbook({
      Products: 2001,
      CPV: 2001,
      RateTypeAssignments: 2001,
      Rates: 2001,
      CommissionRates: 2001,
    });
    const totalRes = await upload(client.id, 'preview', totalBig);
    expect(totalRes.status).toBe(413);
    expect(totalRes.body.error).toBe('IMPORT_TOO_LARGE');
  }, 30000);

  it('403 for a role without masterdata.manage; 401 unauthenticated; 404 unknown client; 400 bad mode', async () => {
    const client = await newClient('ONB_C9');
    const buf = await buildWorkbook({});

    const forbidden = await upload(client.id, 'preview', buf, BE);
    expect(forbidden.status).toBe(403);

    const unauth = await request(app)
      .post(`/api/v2/clients/${client.id}/onboarding-import?mode=preview`)
      .set('content-type', 'application/octet-stream')
      .send(buf);
    expect(unauth.status).toBe(401);

    const notFound = await upload(999999, 'preview', buf);
    expect(notFound.status).toBe(404);
    expect(notFound.body.error).toBe('CLIENT_NOT_FOUND');

    const badMode = await upload(client.id, 'bogus', buf);
    expect(badMode.status).toBe(400);
  });
});
