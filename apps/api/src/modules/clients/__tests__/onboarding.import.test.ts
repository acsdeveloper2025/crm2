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
import type {
  OnboardingConfirmResult,
  OnboardingPreviewResult,
  OnboardingSheetConfirm,
  OnboardingSheetPreview,
} from '@crm2/sdk';
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

const byNameConfirm = (result: OnboardingConfirmResult, name: SheetName): OnboardingSheetConfirm => {
  const sheet = result.sheets.find((s) => s.name === name);
  if (!sheet) throw new Error(`sheet ${name} missing from result`);
  return sheet;
};

const newLocation = async (pincode: string, area: string): Promise<void> => {
  await request(app)
    .post('/api/v2/locations')
    .set(SA)
    .send({ pincode, area, city: 'Mumbai', state: 'Maharashtra' });
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

  it('an active assignment pinned to a non-USABLE product/unit never widens to Universal (RATE_TYPE_NOT_ASSIGNED still fires)', async () => {
    const client = await newClient('ONB_C10');
    const deadProduct = await newProduct('ONB_P10_DEAD');
    const liveProduct = await newProduct('ONB_P10_X');
    const deadUnit = await newUnit('ONB_U10_DEAD');
    const liveUnit = await newUnit('ONB_U10_LIVE');
    const rtRes = await request(app)
      .post('/api/v2/rate-types')
      .set(SA)
      .send({ code: 'ONB_RT10', name: 'ONB_RT10', category: 'FIELD' });
    const rateTypeId = rtRes.body.id as number;
    // Link the LIVE product so CPV_LINK_MISSING can't fire — this test isolates the assignment guard.
    await request(app)
      .post('/api/v2/client-products')
      .set(SA)
      .send({ clientId: client.id, productId: liveProduct.id });
    // Two ACTIVE assignments, each pinned to a soon-to-be-dead specific dimension.
    await request(app)
      .post('/api/v2/rate-type-assignments')
      .set(SA)
      .send({ clientId: client.id, productId: deadProduct.id, verificationUnitId: null, rateTypeId });
    await request(app)
      .post('/api/v2/rate-type-assignments')
      .set(SA)
      .send({ clientId: client.id, productId: null, verificationUnitId: deadUnit.id, rateTypeId });
    // Deactivate the pinned product + unit: their ids no longer resolve in the USABLE-only options
    // maps. The buggy `?? null` mapping widened these tuples to Universal (matches ANY product/unit).
    expect(
      (await request(app).post(`/api/v2/products/${deadProduct.id}/deactivate`).set(SA).send({ version: 1 }))
        .status,
    ).toBe(200);
    expect(
      (
        await request(app)
          .post(`/api/v2/verification-units/${deadUnit.id}/deactivate`)
          .set(SA)
          .send({ version: 1 })
      ).status,
    ).toBe(200);

    const buf = await buildWorkbook({
      Rates: [
        {
          clientCode: client.code,
          productCode: liveProduct.code,
          unitCode: liveUnit.code,
          clientRateType: 'ONB_RT10',
          amount: 100,
        },
      ],
    });
    const res = await upload(client.id, 'preview', buf);
    expect(res.status).toBe(200);
    const rates = byName(res.body as OnboardingPreviewResult, 'Rates');
    expect(rates.errorRows).toBe(1);
    expect(rates.errors.some((e) => /RATE_TYPE_NOT_ASSIGNED/.test(e.message))).toBe(true);
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

  it('400 NOT_XLSX for a non-XLSX body (the workbook endpoint is XLSX-only; the CSV parser branch would silently scramble sheet selection)', async () => {
    const client = await newClient('ONB_C11');
    const csvish = Buffer.from('Code,Name\nONB_X,Not actually a workbook\n', 'utf8');

    const res = await upload(client.id, 'preview', csvish);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('NOT_XLSX');
  });

  // ── Task 13: confirm (`?mode=confirm`) — ordered rebuild-and-commit, CPV two-phase ──

  it('happy 5-sheet onboarding confirm: every resource exists after, per-sheet successRows correct, exactly 6 import_log rows', async () => {
    const client = await newClient('ONB2_C1');
    const unit = await newUnit('ONB2_U1');
    const rateType = await newRateType('ONB2_RT1');
    const user = await newUser('onb2_user1');
    await newLocation('400010', 'Onb2Area');

    const buf = await buildWorkbook({
      Products: [
        { code: 'ONB2_P1', name: 'Onboarding Product 1' },
        { code: 'ONB2_P2', name: 'Onboarding Product 2' },
      ],
      CPV: [
        { clientCode: client.code, productCode: 'ONB2_P1', unitCode: 'UNIVERSAL' },
        { clientCode: client.code, productCode: 'ONB2_P2', unitCode: unit.code },
      ],
      RateTypeAssignments: [
        { clientCode: client.code, productCode: 'ONB2_P1', unitCode: '', rateTypeCode: rateType },
        { clientCode: client.code, productCode: 'ONB2_P2', unitCode: unit.code, rateTypeCode: rateType },
      ],
      Rates: [
        {
          clientCode: client.code,
          productCode: 'ONB2_P2',
          unitCode: unit.code,
          clientRateType: rateType,
          amount: 100,
        },
      ],
      CommissionRates: [
        {
          username: user,
          fieldRateType: rateType,
          clientCode: client.code,
          pincode: '400010',
          area: 'Onb2Area',
          amount: 50,
        },
      ],
    });

    const res = await upload(client.id, 'confirm', buf);
    expect(res.status).toBe(200);
    const body = res.body as OnboardingConfirmResult;

    expect(byNameConfirm(body, 'Products')).toMatchObject({ totalRows: 2, successRows: 2, failedRows: 0 });
    expect(byNameConfirm(body, 'CPV')).toMatchObject({ totalRows: 2, successRows: 2, failedRows: 0 });
    expect(byNameConfirm(body, 'RateTypeAssignments')).toMatchObject({
      totalRows: 2,
      successRows: 2,
      failedRows: 0,
    });
    expect(byNameConfirm(body, 'Rates')).toMatchObject({ totalRows: 1, successRows: 1, failedRows: 0 });
    expect(byNameConfirm(body, 'CommissionRates')).toMatchObject({
      totalRows: 1,
      successRows: 1,
      failedRows: 0,
    });

    const products = await db!.pool.query(`SELECT code FROM products WHERE code IN ('ONB2_P1','ONB2_P2')`);
    expect(products.rows).toHaveLength(2);

    const links = await db!.pool.query(
      `SELECT p.code FROM client_products cp JOIN products p ON p.id = cp.product_id WHERE cp.client_id = $1`,
      [client.id],
    );
    expect(links.rows.map((r: { code: string }) => r.code).sort()).toEqual(['ONB2_P1', 'ONB2_P2']);

    const cpvUnits = await db!.pool.query(
      `SELECT cpvu.verification_unit_id FROM client_product_verification_units cpvu
         JOIN client_products cp ON cp.id = cpvu.client_product_id WHERE cp.client_id = $1`,
      [client.id],
    );
    expect(cpvUnits.rows).toHaveLength(2);

    const rta = await db!.pool.query(`SELECT id FROM rate_type_assignments WHERE client_id = $1`, [
      client.id,
    ]);
    expect(rta.rows).toHaveLength(2);

    const rates = await db!.pool.query(`SELECT id FROM rates WHERE client_id = $1`, [client.id]);
    expect(rates.rows).toHaveLength(1);

    const commission = await db!.pool.query(
      `SELECT cr.id FROM commission_rates cr JOIN users u ON u.id = cr.user_id WHERE u.username = $1`,
      [user],
    );
    expect(commission.rows).toHaveLength(1);

    const log = await db!.pool.query(`SELECT resource FROM import_log ORDER BY id`);
    expect(log.rows.map((r: { resource: string }) => r.resource)).toEqual([
      'products',
      'client_products',
      'client_product_verification_units',
      'rate-type-assignments',
      'rates',
      'commission-rates',
    ]);
  });

  it('partial failure: 1 bad product row → dependent CPV/RTA/rate rows fail with row errors, sibling rows commit', async () => {
    const client = await newClient('ONB2_C2');
    const unit = await newUnit('ONB2_U2');
    const rateType = await newRateType('ONB2_RT2');

    const buf = await buildWorkbook({
      Products: [
        { code: 'ONB2_P2GOOD', name: 'Good product' },
        { code: 'ONB2_P2BAD', name: '' }, // blank name fails CreateProductSchema — never created
      ],
      CPV: [
        { clientCode: client.code, productCode: 'ONB2_P2GOOD', unitCode: 'UNIVERSAL' },
        { clientCode: client.code, productCode: 'ONB2_P2BAD', unitCode: 'UNIVERSAL' },
      ],
      RateTypeAssignments: [
        { clientCode: client.code, productCode: 'ONB2_P2GOOD', unitCode: '', rateTypeCode: rateType },
        { clientCode: client.code, productCode: 'ONB2_P2BAD', unitCode: '', rateTypeCode: rateType },
      ],
      Rates: [
        {
          clientCode: client.code,
          productCode: 'ONB2_P2GOOD',
          unitCode: unit.code,
          clientRateType: rateType,
          amount: 100,
        },
        { clientCode: client.code, productCode: 'ONB2_P2BAD', unitCode: unit.code, amount: 50 },
      ],
    });

    const res = await upload(client.id, 'confirm', buf);
    expect(res.status).toBe(200);
    const body = res.body as OnboardingConfirmResult;

    expect(byNameConfirm(body, 'Products')).toMatchObject({ totalRows: 2, successRows: 1, failedRows: 1 });
    expect(byNameConfirm(body, 'CPV')).toMatchObject({ totalRows: 2, successRows: 1, failedRows: 1 });
    expect(
      byNameConfirm(body, 'CPV').errors.some((e) => /unknown product code ONB2_P2BAD/i.test(e.message)),
    ).toBe(true);
    expect(byNameConfirm(body, 'RateTypeAssignments')).toMatchObject({
      totalRows: 2,
      successRows: 1,
      failedRows: 1,
    });
    expect(byNameConfirm(body, 'Rates')).toMatchObject({ totalRows: 2, successRows: 1, failedRows: 1 });

    const products = await db!.pool.query(`SELECT code FROM products WHERE code LIKE 'ONB2_P2%'`);
    expect(products.rows).toHaveLength(1);
    const links = await db!.pool.query(`SELECT id FROM client_products WHERE client_id = $1`, [client.id]);
    expect(links.rows).toHaveLength(1);
    const rta = await db!.pool.query(`SELECT id FROM rate_type_assignments WHERE client_id = $1`, [
      client.id,
    ]);
    expect(rta.rows).toHaveLength(1);
    const rates = await db!.pool.query(`SELECT id FROM rates WHERE client_id = $1`, [client.id]);
    expect(rates.rows).toHaveLength(1);
  });

  it('re-run the same workbook: link phase idempotent (no dup links); CPV-unit + rate dups surface as row errors; RTA upsert is a silent no-op (its own conflict semantics — ON CONFLICT DO UPDATE); nothing explodes', async () => {
    const client = await newClient('ONB2_C3');
    const product = await newProduct('ONB2_P3');
    const unit = await newUnit('ONB2_U3');
    const rateType = await newRateType('ONB2_RT3');

    const buf = await buildWorkbook({
      CPV: [{ clientCode: client.code, productCode: product.code, unitCode: unit.code }],
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

    const first = await upload(client.id, 'confirm', buf);
    expect(first.status).toBe(200);
    const firstBody = first.body as OnboardingConfirmResult;
    expect(byNameConfirm(firstBody, 'CPV')).toMatchObject({ successRows: 1, failedRows: 0 });
    expect(byNameConfirm(firstBody, 'RateTypeAssignments')).toMatchObject({ successRows: 1, failedRows: 0 });
    expect(byNameConfirm(firstBody, 'Rates')).toMatchObject({ successRows: 1, failedRows: 0 });

    const second = await upload(client.id, 'confirm', buf);
    expect(second.status).toBe(200);
    const secondBody = second.body as OnboardingConfirmResult;
    // CPV-unit dup -> CPV_UNIT_EXISTS (409), surfaces as a row error (phase 1's link-create is the
    // ONLY idempotent-success special case; phase 2 is a normal per-row write like any other sheet).
    expect(byNameConfirm(secondBody, 'CPV')).toMatchObject({ successRows: 0, failedRows: 1 });
    // RTA's own repository upserts (ON CONFLICT ... DO UPDATE SET is_active = true) — a re-run
    // reactivates the (already-active) row rather than erroring; this is the module's real,
    // pre-existing conflict semantics, unchanged by the onboarding guard wrapping.
    expect(byNameConfirm(secondBody, 'RateTypeAssignments')).toMatchObject({ successRows: 1, failedRows: 0 });
    // Rates has a no-overlap EXCLUDE constraint (no upsert) -> RATE_EXISTS (409), a row error.
    expect(byNameConfirm(secondBody, 'Rates')).toMatchObject({ successRows: 0, failedRows: 1 });

    const links = await db!.pool.query(`SELECT id FROM client_products WHERE client_id = $1`, [client.id]);
    expect(links.rows).toHaveLength(1);
    const cpvUnits = await db!.pool.query(
      `SELECT cpvu.id FROM client_product_verification_units cpvu
         JOIN client_products cp ON cp.id = cpvu.client_product_id WHERE cp.client_id = $1`,
      [client.id],
    );
    expect(cpvUnits.rows).toHaveLength(1);
    const rta = await db!.pool.query(`SELECT id FROM rate_type_assignments WHERE client_id = $1`, [
      client.id,
    ]);
    expect(rta.rows).toHaveLength(1);
    const rates = await db!.pool.query(`SELECT id FROM rates WHERE client_id = $1`, [client.id]);
    expect(rates.rows).toHaveLength(1);
  });

  it('guard at confirm: a rates row with no rate-type assignment anywhere -> row error, no rate written', async () => {
    const client = await newClient('ONB2_C4');
    const product = await newProduct('ONB2_P4');
    const unit = await newUnit('ONB2_U4');
    const rateType = await newRateType('ONB2_RT4');
    // Pre-link via the API (not the CPV sheet) so CPV_LINK_MISSING can't fire — isolates
    // RATE_TYPE_NOT_ASSIGNED. Deliberately NO rate_type_assignment anywhere for this rate type.
    await request(app)
      .post('/api/v2/client-products')
      .set(SA)
      .send({ clientId: client.id, productId: product.id });

    const buf = await buildWorkbook({
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

    const res = await upload(client.id, 'confirm', buf);
    expect(res.status).toBe(200);
    const rates = byNameConfirm(res.body as OnboardingConfirmResult, 'Rates');
    expect(rates).toMatchObject({ successRows: 0, failedRows: 1 });
    expect(rates.errors.some((e) => /RATE_TYPE_NOT_ASSIGNED/.test(e.message))).toBe(true);

    const written = await db!.pool.query(`SELECT id FROM rates WHERE client_id = $1`, [client.id]);
    expect(written.rows).toHaveLength(0);
  });

  it('CLIENT_MISMATCH on a CPV row at confirm: row error, no link and no write', async () => {
    const target = await newClient('ONB2_C5');
    const other = await newClient('ONB2_C5B');
    const product = await newProduct('ONB2_P5');

    const buf = await buildWorkbook({
      CPV: [{ clientCode: other.code, productCode: product.code, unitCode: 'UNIVERSAL' }],
    });

    const res = await upload(target.id, 'confirm', buf);
    expect(res.status).toBe(200);
    const cpv = byNameConfirm(res.body as OnboardingConfirmResult, 'CPV');
    expect(cpv).toMatchObject({ successRows: 0, failedRows: 1 });
    expect(cpv.errors.some((e) => /CLIENT_MISMATCH/.test(e.message))).toBe(true);

    const links = await db!.pool.query(`SELECT id FROM client_products`);
    expect(links.rows).toHaveLength(0);
    const units = await db!.pool.query(`SELECT id FROM client_product_verification_units`);
    expect(units.rows).toHaveLength(0);
  });

  it('future-dated CPV effectiveFrom: phase-1 link carries it, so confirm matches preview (unit + rate rows error, no rate written)', async () => {
    const client = await newClient('ONB2_C6');
    const product = await newProduct('ONB2_P6');
    const unit = await newUnit('ONB2_U6');
    const rateType = await newRateType('ONB2_RT6');
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    const buf = await buildWorkbook({
      CPV: [
        {
          clientCode: client.code,
          productCode: product.code,
          unitCode: unit.code,
          effectiveFrom: tomorrow,
        },
      ],
      RateTypeAssignments: [
        { clientCode: client.code, productCode: '', unitCode: '', rateTypeCode: rateType },
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

    // Preview: the CPV row is conditional-pending (honesty bound — its own phase-1 makes the link),
    // and the dependent rate row is refused because the link won't be USABLE at confirm.
    const preview = await upload(client.id, 'preview', buf);
    expect(preview.status).toBe(200);
    const previewBody = preview.body as OnboardingPreviewResult;
    expect(byName(previewBody, 'CPV')).toMatchObject({ pendingRows: 1, errorRows: 0 });
    const previewRates = byName(previewBody, 'Rates');
    expect(previewRates).toMatchObject({ validRows: 0, errorRows: 1 });
    expect(previewRates.errors.some((e) => /CPV_LINK_NOT_YET_USABLE/.test(e.message))).toBe(true);

    // Confirm: phase 1 creates the link WITH the future effective_from (not now()), so the link is
    // not yet USABLE — the unit row and the rate row error, matching what preview reported.
    const confirm = await upload(client.id, 'confirm', buf);
    expect(confirm.status).toBe(200);
    const confirmBody = confirm.body as OnboardingConfirmResult;

    const link = await db!.pool.query(
      `SELECT effective_from FROM client_products WHERE client_id = $1 AND product_id = $2`,
      [client.id, product.id],
    );
    expect(link.rows).toHaveLength(1);
    expect(new Date(link.rows[0].effective_from as string).getTime()).toBeGreaterThan(Date.now());

    expect(byNameConfirm(confirmBody, 'CPV')).toMatchObject({ successRows: 0, failedRows: 1 });
    expect(
      byNameConfirm(confirmBody, 'CPV').errors.some((e) => /no usable client-product link/i.test(e.message)),
    ).toBe(true);
    const confirmRates = byNameConfirm(confirmBody, 'Rates');
    expect(confirmRates).toMatchObject({ successRows: 0, failedRows: 1 });

    const written = await db!.pool.query(`SELECT id FROM rates WHERE client_id = $1`, [client.id]);
    expect(written.rows).toHaveLength(0);
    const units = await db!.pool.query(`SELECT id FROM client_product_verification_units`);
    expect(units.rows).toHaveLength(0);
  });
});
