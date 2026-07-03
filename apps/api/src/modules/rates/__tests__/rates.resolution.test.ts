import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import {
  createTestDb,
  clientFactory,
  productFactory,
  verificationUnitFactory,
  authHeaderForRole,
} from '@crm2/test-utils';
import { createApp } from '../../../http/app.js';
import { setPool, query } from '../../../platform/db.js';
import { billingRepository } from '../../billing/repository.js';

/**
 * ADR-0071 — billing rate resolution with Universal (NULL) product / verification unit. The billing
 * RATE_LATERAL must wildcard-match product + unit (`col IS NULL OR col = task.col`) and pick the
 * MOST-SPECIFIC active rate, with dimension specificity (product, then unit) outranking location
 * specificity — exactly like commission_rates (ADR-0050). A SPECIFIC rate must NEVER be overridden by a
 * Universal one. Asserted through the billing read-model's `listLines` (its `billAmount` + `clientRateType`
 * are the RATE_LATERAL outputs). Resolution is exercised on a COMPLETED task — set directly (no
 * assign/submit dance needed: the bill lateral keys only on the case's client/product + the task's
 * unit/location/status).
 */
const RUN = !!process.env['DATABASE_URL'];
const db = RUN ? createTestDb() : null;
const app = createApp({ enableTestAuth: true });
const SA = authHeaderForRole('SUPER_ADMIN');
const BC = '9876543210';
const PAST = new Date(Date.now() - 24 * 3600 * 1000).toISOString();

function seeded<T>(res: request.Response): T {
  if (res.status >= 400) throw new Error(`seed write failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body as T;
}

/** client + product + unit, CPV-enabled so add-tasks accepts the unit. */
async function seedCpvUnit(tag: string): Promise<{ clientId: number; productId: number; unitId: number }> {
  const clientId = seeded<{ id: number }>(
    await request(app)
      .post('/api/v2/clients')
      .set(SA)
      .send(clientFactory({ code: `C_${tag}` })),
  ).id;
  const productId = seeded<{ id: number }>(
    await request(app)
      .post('/api/v2/products')
      .set(SA)
      .send(productFactory({ code: `P_${tag}` })),
  ).id;
  const unitId = seeded<{ id: number }>(
    await request(app)
      .post('/api/v2/verification-units')
      .set(SA)
      .send(verificationUnitFactory({ code: `U_${tag}` })),
  ).id;
  const cpId = seeded<{ id: number }>(
    await request(app)
      .post('/api/v2/client-products')
      .set(SA)
      .send({ clientId, productId, effectiveFrom: PAST }),
  ).id;
  seeded(
    await request(app)
      .post('/api/v2/cpv-units')
      .set(SA)
      .send({ clientProductId: cpId, verificationUnitId: unitId, effectiveFrom: PAST }),
  );
  return { clientId, productId, unitId };
}

async function seedLocation(pincode: string, area: string): Promise<number> {
  return seeded<{ id: number }>(
    await request(app).post('/api/v2/locations').set(SA).send({ pincode, area, city: 'Mumbai', state: 'MH' }),
  ).id;
}

/** Create a rate; omit product/unit/location to store NULL (= Universal). */
async function postRate(o: {
  clientId: number;
  productId?: number | null;
  verificationUnitId?: number | null;
  locationId?: number | null;
  clientRateType?: string | null;
  amount: number;
}): Promise<void> {
  seeded(
    await request(app)
      .post('/api/v2/rates')
      .set(SA)
      .send({
        clientId: o.clientId,
        ...(o.productId != null ? { productId: o.productId } : {}),
        ...(o.verificationUnitId != null ? { verificationUnitId: o.verificationUnitId } : {}),
        ...(o.locationId != null ? { locationId: o.locationId } : {}),
        ...(o.clientRateType != null ? { clientRateType: o.clientRateType } : {}),
        amount: o.amount,
      }),
  );
}

/** One COMPLETED task at (ctx.client, ctx.product, ctx.unit, location). Returns caseId. */
async function completedTaskCase(
  ctx: { clientId: number; productId: number; unitId: number },
  locationId: number,
): Promise<string> {
  const caseId = seeded<{ id: string }>(
    await request(app)
      .post('/api/v2/cases')
      .set(SA)
      .send({
        clientId: ctx.clientId,
        productId: ctx.productId,
        backendContactNumber: BC,
        applicants: [{ name: 'APP', mobile: '9000000001' }],
        dedupeDecision: 'NO_DUPLICATES_FOUND',
      }),
  ).id;
  const applicants = seeded<{ applicants: { id: string }[] }>(
    await request(app).get(`/api/v2/cases/${caseId}`).set(SA),
  ).applicants;
  const rows = seeded<{ id: string; applicantId: string }[]>(
    await request(app)
      .post(`/api/v2/cases/${caseId}/tasks`)
      .set(SA)
      .send({
        tasks: [
          { verificationUnitId: ctx.unitId, applicantId: applicants[0]!.id, address: '1 RD', trigger: 'x' },
        ],
      }),
  );
  // Bill resolution keys only on status + the task's unit/location + the case's client/product — set
  // COMPLETED + location directly (no assign/submit/office-complete dance needed).
  await query(
    `UPDATE case_tasks SET status = 'COMPLETED', area_id = $2, pincode_id = $2, completed_at = now() WHERE id = $1`,
    [rows[0]!.id, locationId],
  );
  return caseId;
}

async function billLine(
  caseId: string,
): Promise<{ billAmount: number | null; clientRateType: string | null }> {
  const { items } = await billingRepository.listLines({
    scope: {},
    sortColumn: 'ct.completed_at',
    sortOrder: 'desc',
    limit: 50,
    offset: 0,
  });
  const l = items.find((line) => line.caseId === caseId)!;
  return { billAmount: l.billAmount, clientRateType: l.clientRateType };
}

describe.skipIf(!RUN)('rate resolution — Universal product/unit (ADR-0071)', () => {
  beforeAll(async () => {
    await db!.migrate();
    setPool(db!.pool);
  });
  afterAll(async () => {
    await db!.end();
  });
  beforeEach(async () => {
    await db!.truncate(
      'rates',
      'case_tasks',
      'case_applicants',
      'cases',
      'client_product_verification_units',
      'client_products',
      'verification_units',
      'clients',
      'products',
      'locations',
    );
  });

  it('a Universal-PRODUCT rate (product NULL) bills a task at any product (fallback)', async () => {
    const ctx = await seedCpvUnit('UP');
    const l1 = await seedLocation('400001', 'L1');
    await postRate({
      clientId: ctx.clientId,
      verificationUnitId: ctx.unitId,
      locationId: l1,
      clientRateType: 'LOCAL',
      amount: 100,
    });
    const caseId = await completedTaskCase(ctx, l1);
    const { billAmount, clientRateType } = await billLine(caseId);
    expect(billAmount).toBe(100); // product NULL matched cs.product_id
    expect(clientRateType).toBe('LOCAL'); // the label also resolves through the Universal rate
  });

  it('a Universal-UNIT rate (unit NULL) bills a task at any unit (fallback)', async () => {
    const ctx = await seedCpvUnit('UU');
    const l1 = await seedLocation('400002', 'L2');
    await postRate({ clientId: ctx.clientId, productId: ctx.productId, locationId: l1, amount: 120 });
    const caseId = await completedTaskCase(ctx, l1);
    expect((await billLine(caseId)).billAmount).toBe(120); // unit NULL matched ct.verification_unit_id
  });

  it('a SPECIFIC rate wins over a Universal one for the same task (most-specific, do not regress)', async () => {
    const ctx = await seedCpvUnit('SW');
    const l1 = await seedLocation('400003', 'L3');
    await postRate({
      clientId: ctx.clientId,
      productId: ctx.productId,
      verificationUnitId: ctx.unitId,
      locationId: l1,
      amount: 500,
    });
    await postRate({ clientId: ctx.clientId, verificationUnitId: ctx.unitId, locationId: l1, amount: 100 }); // Universal product
    const caseId = await completedTaskCase(ctx, l1);
    expect((await billLine(caseId)).billAmount).toBe(500); // specific product beats Universal — NEVER 100
  });

  it('product specificity outranks location specificity (dimension > location)', async () => {
    const ctx = await seedCpvUnit('DL');
    const l1 = await seedLocation('400004', 'L4');
    // Specific product but location-less (Universal location) ₹500; Universal product but location-EXACT ₹100.
    await postRate({
      clientId: ctx.clientId,
      productId: ctx.productId,
      verificationUnitId: ctx.unitId,
      amount: 500,
    });
    await postRate({ clientId: ctx.clientId, verificationUnitId: ctx.unitId, locationId: l1, amount: 100 });
    const caseId = await completedTaskCase(ctx, l1);
    expect((await billLine(caseId)).billAmount).toBe(500); // product-exact wins despite the other's exact location
  });
});
