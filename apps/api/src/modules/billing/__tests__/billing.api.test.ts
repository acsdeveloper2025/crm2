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

const RUN = !!process.env['DATABASE_URL'];
const db = RUN ? createTestDb() : null;
const app = createApp({ enableTestAuth: true });
const SA = authHeaderForRole('SUPER_ADMIN');
const BE = authHeaderForRole('BACKEND_USER'); // holds billing.view
const TL = authHeaderForRole('TEAM_LEADER'); // does NOT hold billing.view
const BC = '9876543210';
const PAST = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
const hdr = (role: string, id: string): Record<string, string> => ({ 'x-test-auth': `${role}:${id}` });

function seeded<T>(res: request.Response): T {
  if (res.status >= 400) throw new Error(`seed write failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body as T;
}

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

async function createUser(o: { username: string; name: string; role: string }): Promise<string> {
  const res = await request(app).post('/api/v2/users').set(SA).send(o);
  expect(res.status).toBe(201);
  return res.body.id as string;
}

/** Seed a case with one task, assign to `fa`, and device-complete it. Returns the case id. */
async function seedCompletedTask(
  ctx: { clientId: number; productId: number; unitId: number },
  fa: string,
  name: string,
  locationId?: number,
): Promise<{ caseId: string; caseNumber: string; taskId: string }> {
  const created = seeded<{ id: string; caseNumber: string }>(
    await request(app)
      .post('/api/v2/cases')
      .set(SA)
      .send({
        clientId: ctx.clientId,
        productId: ctx.productId,
        backendContactNumber: BC,
        applicants: [{ name, mobile: '9000012345' }],
        dedupeDecision: 'NO_DUPLICATES_FOUND',
      }),
  );
  const applicantId = seeded<{ applicants: { id: string }[] }>(
    await request(app).get(`/api/v2/cases/${created.id}`).set(SA),
  ).applicants[0]!.id;
  const tasks = seeded<{ id: string }[]>(
    await request(app)
      .post(`/api/v2/cases/${created.id}/tasks`)
      .set(SA)
      .send({
        tasks: [{ verificationUnitId: ctx.unitId, applicantId, address: '12 MG ROAD', trigger: 'x' }],
      }),
  );
  const taskId = tasks[0]!.id;
  expect(
    (
      await request(app)
        .post(`/api/v2/cases/${created.id}/tasks/${taskId}/assign`)
        .set(SA)
        .send({ assignedTo: fa, visitType: 'FIELD', fieldRateType: 'LOCAL', billCount: 1, version: 1 })
    ).status,
  ).toBe(200);
  expect(
    (await request(app).post(`/api/v2/verification-tasks/${taskId}/start`).set(hdr('FIELD_AGENT', fa)))
      .status,
  ).toBe(200);
  // Stamp the task location AFTER start, BEFORE submit (ADR-0050: the commission lateral matches on the
  // task's location; it can't be set before assign, which validates assignee territory eligibility).
  if (locationId !== undefined) {
    await query(`UPDATE case_tasks SET area_id = $2, pincode_id = $2 WHERE id = $1`, [taskId, locationId]);
  }
  // ADR-0047: device complete now SUBMITS; the office records the result → COMPLETED (billable)
  const submit = await request(app)
    .post(`/api/v2/verification-tasks/${taskId}/complete`)
    .set(hdr('FIELD_AGENT', fa));
  expect(submit.status).toBe(200);
  expect(
    (
      await request(app)
        .post(`/api/v2/cases/${created.id}/tasks/${taskId}/complete`)
        .set(SA)
        .send({ result: 'POSITIVE', remark: 'office verified', version: submit.body.version })
    ).status,
  ).toBe(200);
  return { caseId: created.id, caseNumber: created.caseNumber, taskId };
}

describe.skipIf(!RUN)('billing API (ADR-0036 slice 5b)', () => {
  beforeAll(async () => {
    await db!.migrate();
    setPool(db!.pool);
  });
  afterAll(async () => {
    await db!.end();
  });
  beforeEach(async () => {
    await db!.truncate(
      'commission_rates',
      'rates',
      'task_assignment_history',
      'case_tasks',
      'case_applicants',
      'cases',
      'client_product_verification_units',
      'client_products',
      'verification_units',
      'clients',
      'products',
      'locations',
      'users',
    );
  });

  it('rolls up a completed task into per-case bill totals (billing surface bill-only, ADR-0086); commission on the Commission surface', async () => {
    const ctx = await seedCpvUnit('ROLL');
    const fa = await createUser({ username: 'bil_fa', name: 'BILL FA', role: 'FIELD_AGENT' });
    const loc = seeded<{ id: number }>(
      await request(app)
        .post('/api/v2/locations')
        .set(SA)
        .send({ pincode: '400061', area: 'ROLLAREA', city: 'Mumbai', state: 'MH' }),
    ).id;
    // a LOCAL rate ₹100 for the CPV (location-less default) + a fully-specified LOCAL commission ₹30
    // (ADR-0050: exact-match on the agent + client + product + unit + location + LOCAL band + the 4-hour
    // submit-in TAT band) for the agent.
    seeded(
      await request(app).post('/api/v2/rates').set(SA).send({
        clientId: ctx.clientId,
        productId: ctx.productId,
        verificationUnitId: ctx.unitId,
        clientRateType: 'LOCAL',
        amount: 100,
      }),
    );
    seeded(
      await request(app).post('/api/v2/commission-rates').set(SA).send({
        userId: fa,
        clientId: ctx.clientId,
        productId: ctx.productId,
        verificationUnitId: ctx.unitId,
        locationId: loc,
        fieldRateType: 'LOCAL',
        tatBand: 4,
        amount: 30,
      }),
    );
    const c = await seedCompletedTask(ctx, fa, 'ROLL APP', loc);

    // ADR-0086: the billing surface is a FLAT list — one row per COMPLETED billable task, bill-only.
    const list = await request(app).get('/api/v2/billing/lines').set(SA);
    expect(list.status).toBe(200);
    expect(list.body.items).toHaveLength(1);
    const row = list.body.items[0];
    expect(row).toMatchObject({
      caseNumber: c.caseNumber,
      taskNumber: `${c.caseNumber}-1`,
      caseId: c.caseId,
      clientRateType: 'LOCAL',
      billCount: 1,
      billAmount: 100,
      billTotal: 100,
    });
    expect(row.pincode).toBe('400061');
    expect(row.area).toBe('ROLLAREA');
    expect(row.completedAt).toBeTruthy();
    // commission is gone from the billing surface (row + total).
    expect(row).not.toHaveProperty('commissionAmount');
    expect(row).not.toHaveProperty('commissionTotal');
    // ADR-0086 review — the JOINed detail columns map correctly:
    expect(row.unitName).toBeTruthy(); // vu.name
    expect(row.assigneeName).toBe('BILL FA'); // au.name
    expect(row).toHaveProperty('tatBand'); // COMPLETED_BAND derivation (band value covered in billing.commission.test)

    // filter-aware bill total (grid footer): ₹100 across 1 line, and it follows the filters.
    const summary = await request(app).get('/api/v2/billing/lines/summary').set(SA);
    expect(summary.status).toBe(200);
    expect(summary.body).toMatchObject({ billTotal: 100, lineCount: 1 });
    expect(
      (await request(app).get('/api/v2/billing/lines?f_rateType=LOCAL').set(SA)).body.items,
    ).toHaveLength(1);
    expect((await request(app).get('/api/v2/billing/lines?f_rateType=OGL').set(SA)).body.items).toHaveLength(
      0,
    );
    expect(
      (await request(app).get('/api/v2/billing/lines/summary?f_rateType=OGL').set(SA)).body,
    ).toMatchObject({ billTotal: 0, lineCount: 0 });

    // TAT-band filter: pin a deterministic band (30 min → the 4h band), then filter by it.
    await query(`UPDATE case_tasks SET completed_elapsed_minutes = 30 WHERE case_id = $1`, [c.caseId]);
    expect((await request(app).get('/api/v2/billing/lines?f_tatBand=4').set(SA)).body.items).toHaveLength(1);
    expect((await request(app).get('/api/v2/billing/lines?f_tatBand=6').set(SA)).body.items).toHaveLength(0);

    // The SAME commission (₹30) still resolves on the SEPARATE Commission surface (ADR-0081/0086).
    const detail = await request(app).get('/api/v2/billing/commission-detail').set(SA);
    expect(detail.status).toBe(200);
    expect(detail.body.items).toHaveLength(1);
    expect(detail.body.items[0]).toMatchObject({
      taskNumber: `${c.caseNumber}-1`,
      billAmount: 100,
      commissionAmount: 30,
    });
  });

  it('eligibility = ANY completed task; billing surface is bill-only; commission-detail shows null commission when the assignee has no rate (bill still resolves)', async () => {
    const ctx = await seedCpvUnit('ANY');
    const fa = await createUser({ username: 'bil_fa2', name: 'BILL FA2', role: 'FIELD_AGENT' });
    seeded(
      await request(app).post('/api/v2/rates').set(SA).send({
        clientId: ctx.clientId,
        productId: ctx.productId,
        verificationUnitId: ctx.unitId,
        clientRateType: 'LOCAL',
        amount: 100,
      }),
    );
    // NO commission rate for this agent
    await seedCompletedTask(ctx, fa, 'ANY APP');
    const list = await request(app).get('/api/v2/billing/lines').set(SA);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0].billAmount).toBe(100);
    expect(list.body.items[0].billTotal).toBe(100);
    expect(list.body.items[0]).not.toHaveProperty('commissionAmount'); // ADR-0086: bill-only surface
    // commission is null (no rate) on the Commission surface — bill still resolves there too.
    const detail = await request(app).get('/api/v2/billing/commission-detail').set(SA);
    expect(detail.body.items[0].billAmount).toBe(100);
    expect(detail.body.items[0].commissionAmount).toBeNull(); // unset, not a failure
  });

  it('excludes a case with no COMPLETED tasks (only completed tasks bill)', async () => {
    const ctx = await seedCpvUnit('PEND');
    // a case with a PENDING task only (created, not assigned/completed)
    const created = seeded<{ id: string }>(
      await request(app)
        .post('/api/v2/cases')
        .set(SA)
        .send({
          clientId: ctx.clientId,
          productId: ctx.productId,
          backendContactNumber: BC,
          applicants: [{ name: 'PEND APP', mobile: '9000012345' }],
          dedupeDecision: 'NO_DUPLICATES_FOUND',
        }),
    );
    const applicantId = seeded<{ applicants: { id: string }[] }>(
      await request(app).get(`/api/v2/cases/${created.id}`).set(SA),
    ).applicants[0]!.id;
    seeded(
      await request(app)
        .post(`/api/v2/cases/${created.id}/tasks`)
        .set(SA)
        .send({ tasks: [{ verificationUnitId: ctx.unitId, applicantId, address: 'a', trigger: 'x' }] }),
    );
    const list = await request(app).get('/api/v2/billing/lines').set(SA);
    expect(list.body.items).toHaveLength(0);
  });

  it('billing.view gates the flat lines list + export: BACKEND_USER allowed, TEAM_LEADER + FIELD_AGENT denied', async () => {
    const ctx = await seedCpvUnit('PERM');
    const fa = await createUser({ username: 'bil_perm', name: 'BP', role: 'FIELD_AGENT' });
    await seedCompletedTask(ctx, fa, 'PERM APP');
    expect((await request(app).get('/api/v2/billing/lines').set(BE)).status).toBe(200);
    expect((await request(app).get('/api/v2/billing/lines').set(TL)).status).toBe(403);
    expect((await request(app).get('/api/v2/billing/lines').set(hdr('FIELD_AGENT', fa))).status).toBe(403);
    // the filter-aware summary shares the same billing.view gate.
    expect((await request(app).get('/api/v2/billing/lines/summary').set(BE)).status).toBe(200);
    expect((await request(app).get('/api/v2/billing/lines/summary').set(TL)).status).toBe(403);

    // export carries the SAME sensitive bill amounts → must share the list's audience (billing.view),
    // NOT just data.export. TEAM_LEADER holds data.export but NOT billing.view → must be 403 on export
    // too (else a TL blocked from /lines could exfiltrate the amounts via export).
    expect((await request(app).get('/api/v2/billing/lines/export?format=csv&mode=all').set(BE)).status).toBe(
      200,
    );
    expect((await request(app).get('/api/v2/billing/lines/export?format=csv&mode=all').set(TL)).status).toBe(
      403,
    );
  });

  it('ADR-0081/0086: Commission Summary is gated by its DEDICATED commission_summary.view (list + export)', async () => {
    // BACKEND_USER holds commission_summary.view (mig 0107 + the 0112 rename + ROLE_PERMISSIONS) → 200.
    expect((await request(app).get('/api/v2/billing/commission-summary?period=month').set(BE)).status).toBe(
      200,
    );
    expect(
      (
        await request(app)
          .get('/api/v2/billing/commission-summary/export?period=month&format=csv&mode=all')
          .set(BE)
      ).status,
    ).toBe(200);
    // TEAM_LEADER holds NEITHER billing.view NOR the dedicated perm → 403 on both (independent gate).
    expect((await request(app).get('/api/v2/billing/commission-summary?period=month').set(TL)).status).toBe(
      403,
    );
    expect(
      (
        await request(app)
          .get('/api/v2/billing/commission-summary/export?period=month&format=csv&mode=all')
          .set(TL)
      ).status,
    ).toBe(403);
  });
});
