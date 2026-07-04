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
import { billingRepository, type BillingLineListOptions } from '../repository.js';
import type { BillingLineRow } from '@crm2/sdk';
import { commissionRateRepository } from '../../commissionRates/repository.js';

/**
 * §E acceptance (ADR-0046) — commission resolves from the executive's OWN location, decoupled from
 * the client rate (no `cmr.rate_type = rt.rate_type` join), point-in-time as-of completed_at.
 *
 * Seed: client C, product P, unit VU; two locations L1, L2; client `rates` R-L1(loc L1, ₹350) /
 * R-L2(loc L2, ₹500); agent U; commission `CR-base(U, all-NULL universal default, ₹50)` +
 * `CR-L2(U, location=L2, ₹90)`. One case CASE-1 with two COMPLETED tasks T1(area=pincode=L1) /
 * T2(area=pincode=L2), assignee U, bill_count=1. The discriminator: T1 → ₹50 (no L1-specific row → the
 * location-less default), T2 → ₹90 — different commission for the SAME executive when ONLY the location
 * differs, with NO rate_type on either commission row (today both ₹50, because the old lateral joins
 * `cmr.rate_type = rt.rate_type` and ignores location).
 *
 * CR-base is the all-NULL universal default now that `revise` carries dimensions forward (Task 6): the
 * §4 revise of CR-L2 produces a new L2-scoped row (not NULL-location), so it never collides with the
 * all-NULL base under the no-overlap EXCLUDE.
 */

const RUN = !!process.env['DATABASE_URL'];
const db = RUN ? createTestDb() : null;
const app = createApp({ enableTestAuth: true });
const SA = authHeaderForRole('SUPER_ADMIN');
const BC = '9876543210';
const PAST = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
const hdr = (role: string, id: string): Record<string, string> => ({ 'x-test-auth': `${role}:${id}` });

function seeded<T>(res: request.Response): T {
  if (res.status >= 400) throw new Error(`seed write failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body as T;
}

async function seedCpvUnit(
  tag: string,
  opts: { workerRole?: 'KYC_VERIFIER' } = {},
): Promise<{ clientId: number; productId: number; unitId: number }> {
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
  // A KYC unit lets a desk (OFFICE) task pass the visitType↔worker-role binding (A2026-0623-05).
  const unitId = seeded<{ id: number }>(
    await request(app)
      .post('/api/v2/verification-units')
      .set(SA)
      .send(
        verificationUnitFactory({
          code: `U_${tag}`,
          ...(opts.workerRole ? { workerRole: opts.workerRole } : {}),
        }),
      ),
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

/** Create a locations row (pincode + area) and return its id. */
async function seedLocation(pincode: string, area: string): Promise<number> {
  const res = await request(app)
    .post('/api/v2/locations')
    .set(SA)
    .send({ pincode, area, city: 'Mumbai', state: 'MH' });
  return seeded<{ id: number }>(res).id;
}

async function createUser(o: { username: string; name: string; role: string }): Promise<string> {
  const res = await request(app)
    .post('/api/v2/users')
    .set(SA)
    .send({ email: `${o.username}@test.crm2.local`, ...o });
  expect(res.status).toBe(201);
  const id = res.body.id as string;
  // ADR-0073: OFFICE assignment is now gated by a per-unit grant. Make a test KYC verifier universally
  // OFFICE-eligible (grant every active unit — incl FIELD units, since ADR-0070 decoupled visit type from
  // the unit) so pre-existing desk-flow assertions hold. The gate itself is covered by
  // userKycUnits.api.test.ts. Idempotent.
  if (o.role === 'KYC_VERIFIER')
    await query(
      `INSERT INTO user_kyc_unit_access (user_id, verification_unit_id)
       SELECT $1, vu.id FROM verification_units vu WHERE vu.is_active
       ON CONFLICT DO NOTHING`,
      [id],
    );
  return id;
}

/** Create a client `rates` row scoped to a location. */
async function seedRate(
  ctx: { clientId: number; productId: number; unitId: number },
  locationId: number,
  amount: number,
): Promise<void> {
  seeded(
    await request(app).post('/api/v2/rates').set(SA).send({
      clientId: ctx.clientId,
      productId: ctx.productId,
      verificationUnitId: ctx.unitId,
      locationId,
      clientRateType: 'LOCAL',
      amount,
    }),
  );
}

/**
 * Create a commission_rates row directly as a FULLY-SPECIFIED tariff line (ADR-0050): the resolver
 * now matches EXACTLY on user + client + product + verification unit + rate_type (= the task's
 * field_rate_type) + tat_band + location (one of the task/case locations — no location-less default).
 * Defaults: `fieldRateType` LOCAL, `tatBand` 4 — these tasks submit within ~1 minute of assignment, so the
 * submit-in band resolves to the smallest active `tat_policies` band (the migration seeds 4/6/8/12/24/48
 * hours, and CEIL(1 min / 60) = 1h → the 4-hour band). Returns the row id.
 */
const DEFAULT_TAT_BAND = 4; // smallest active migration-seeded tat_policy ≥ a sub-minute submit
async function seedCommissionRate(o: {
  userId: string;
  clientId: number;
  productId: number;
  verificationUnitId: number;
  locationId: number;
  fieldRateType?: 'LOCAL' | 'OGL';
  tatBand?: number;
  amount: number;
}): Promise<number> {
  const [row] = await query<{ id: number }>(
    `INSERT INTO commission_rates
       (user_id, client_id, product_id, verification_unit_id, location_id, rate_type_id, tat_band,
        amount, currency, effective_from)
     VALUES ($1, $2, $3, $4, $5, (SELECT id FROM rate_types WHERE code = $6), $7, $8, 'INR', now() - interval '2 days')
     RETURNING id`,
    [
      o.userId,
      o.clientId,
      o.productId,
      o.verificationUnitId,
      o.locationId,
      o.fieldRateType ?? 'LOCAL',
      o.tatBand ?? DEFAULT_TAT_BAND,
      o.amount,
    ],
  );
  return row!.id;
}

/**
 * Create the case's PENDING tasks in ONE call (the add-tasks endpoint returns the case's FULL task
 * list, so a per-task call would mis-identify rows). Returns id keyed by applicantId.
 */
async function addTasks(
  caseId: string,
  unitId: number,
  applicants: { applicantId: string; address: string }[],
): Promise<Map<string, string>> {
  const rows = seeded<{ id: string; applicantId: string }[]>(
    await request(app)
      .post(`/api/v2/cases/${caseId}/tasks`)
      .set(SA)
      .send({
        tasks: applicants.map((a) => ({
          verificationUnitId: unitId,
          applicantId: a.applicantId,
          address: a.address,
          trigger: 'x',
        })),
      }),
  );
  return new Map(rows.map((r) => [r.applicantId, r.id]));
}

/**
 * Assign → start → (set location) → device SUBMIT → office COMPLETE (ADR-0047). The optional `locationId`
 * is stamped AFTER start but BEFORE submit: assign validates assignee eligibility by territory (a located
 * task the agent isn't scoped to → 400), so the location can't exist at assign; and the commission
 * snapshot is now FROZEN at SUBMIT (ADR-0047), so the location must exist by then. The office then records
 * the result → COMPLETED (which does NOT re-stamp commission — it stays frozen at submit).
 */
async function driveToCompleted(
  caseId: string,
  taskId: string,
  fa: string,
  locationId?: number,
  fieldRateType: 'LOCAL' | 'OGL' = 'LOCAL',
): Promise<void> {
  expect(
    (
      await request(app)
        .post(`/api/v2/cases/${caseId}/tasks/${taskId}/assign`)
        .set(SA)
        .send({ assignedTo: fa, visitType: 'FIELD', fieldRateType, billCount: 1, version: 1 })
    ).status,
  ).toBe(200);
  expect(
    (await request(app).post(`/api/v2/verification-tasks/${taskId}/start`).set(hdr('FIELD_AGENT', fa)))
      .status,
  ).toBe(200);
  if (locationId !== undefined) {
    await query(`UPDATE case_tasks SET area_id = $2, pincode_id = $2 WHERE id = $1`, [taskId, locationId]);
  }
  const submit = await request(app)
    .post(`/api/v2/verification-tasks/${taskId}/complete`)
    .set(hdr('FIELD_AGENT', fa));
  expect(submit.status).toBe(200); // device → SUBMITTED (commission frozen here)
  expect(
    (
      await request(app)
        .post(`/api/v2/cases/${caseId}/tasks/${taskId}/complete`)
        .set(SA)
        .send({ result: 'POSITIVE', remark: 'office verified', version: submit.body.version })
    ).status,
  ).toBe(200); // office → COMPLETED (client bill)
}

/** Assign → start → (set location) → device SUBMIT only (NO office complete) — ADR-0047: the field
 *  terminal. The commission snapshot is frozen here; the client bill stays absent until the office completes. */
async function driveToSubmitted(
  caseId: string,
  taskId: string,
  fa: string,
  locationId?: number,
  fieldRateType: 'LOCAL' | 'OGL' = 'LOCAL',
): Promise<void> {
  expect(
    (
      await request(app)
        .post(`/api/v2/cases/${caseId}/tasks/${taskId}/assign`)
        .set(SA)
        .send({ assignedTo: fa, visitType: 'FIELD', fieldRateType, billCount: 1, version: 1 })
    ).status,
  ).toBe(200);
  expect(
    (await request(app).post(`/api/v2/verification-tasks/${taskId}/start`).set(hdr('FIELD_AGENT', fa)))
      .status,
  ).toBe(200);
  if (locationId !== undefined) {
    await query(`UPDATE case_tasks SET area_id = $2, pincode_id = $2 WHERE id = $1`, [taskId, locationId]);
  }
  expect(
    (await request(app).post(`/api/v2/verification-tasks/${taskId}/complete`).set(hdr('FIELD_AGENT', fa)))
      .status,
  ).toBe(200); // device → SUBMITTED (commission frozen; not yet billable)
}

describe.skipIf(!RUN)('commission rebuild §E (ADR-0046)', () => {
  // SUPER_ADMIN ALL scope = empty scope object (no hierarchy/restrict filter).
  const baseOpts: BillingLineListOptions = {
    scope: {},
    sortColumn: 'ct.completed_at',
    sortOrder: 'desc',
    limit: 50,
    offset: 0,
  };

  // Commission Summary (ADR-0081) opts helper — per-agent monthly rollup unless overridden. Declared
  // here (above its first use) so both the §E resolution tests and the ADR-0081 tests below share it.
  const sumOpts = (o: Partial<Parameters<typeof billingRepository.commissionSummary>[0]>) => ({
    scope: {},
    period: 'month' as const,
    groupBy: 'agent' as const,
    limit: 50,
    offset: 0,
    ...o,
  });

  let caseId: string;
  let t1Number: string;
  let t2Number: string;
  let crL2Id: number;
  let saId: string;
  let l1Id: number;
  let ctxShared: { clientId: number; productId: number; unitId: number };

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

    const ctx = await seedCpvUnit('EE');
    const fa = await createUser({ username: 'ee_fa', name: 'EE FA', role: 'FIELD_AGENT' });
    saId = await createUser({ username: 'ee_sa', name: 'EE SA', role: 'SUPER_ADMIN' });

    // Two distinct locations L1, L2 (distinct pincode + area).
    const l1 = await seedLocation('400001', 'L1AREA');
    const l2 = await seedLocation('400002', 'L2AREA');
    l1Id = l1;
    ctxShared = ctx;

    // Client rates: R-L1 ₹350 (loc L1), R-L2 ₹500 (loc L2). Same client+product+unit.
    await seedRate(ctx, l1, 350);
    await seedRate(ctx, l2, 500);

    // Commission for agent U (ADR-0050 — fully-specified exact-match tariff lines; tat_band defaults to
    // the 4-hour band these ~1-min submits resolve to): CR-L1 (LOCAL @ L1, ₹50) + CR-L2 (OGL @ L2, ₹90).
    // T1 is assigned LOCAL @ L1
    // and resolves CR-L1 (₹50); T2 is assigned OGL @ L2 and resolves CR-L2 (₹90) — a different amount for
    // the same executive when the location AND distance band differ. (The dedicated same-location §E test
    // below isolates the LOCAL-vs-OGL pricing on its own.)
    await seedCommissionRate({
      userId: fa,
      clientId: ctx.clientId,
      productId: ctx.productId,
      verificationUnitId: ctx.unitId,
      locationId: l1,
      fieldRateType: 'LOCAL',
      amount: 50,
    });
    crL2Id = await seedCommissionRate({
      userId: fa,
      clientId: ctx.clientId,
      productId: ctx.productId,
      verificationUnitId: ctx.unitId,
      locationId: l2,
      fieldRateType: 'OGL',
      amount: 90,
    });

    // One case with two applicants → two tasks (T1 @ L1, T2 @ L2), same assignee U.
    const created = seeded<{ id: string }>(
      await request(app)
        .post('/api/v2/cases')
        .set(SA)
        .send({
          clientId: ctx.clientId,
          productId: ctx.productId,
          backendContactNumber: BC,
          applicants: [
            { name: 'EE APP1', mobile: '9000012345' },
            { name: 'EE APP2', mobile: '9000012346' },
          ],
          dedupeDecision: 'NO_DUPLICATES_FOUND',
        }),
    );
    caseId = created.id;
    const applicants = seeded<{ applicants: { id: string }[] }>(
      await request(app).get(`/api/v2/cases/${caseId}`).set(SA),
    ).applicants;

    const byApplicant = await addTasks(caseId, ctx.unitId, [
      { applicantId: applicants[0]!.id, address: '1 L1 ROAD' },
      { applicantId: applicants[1]!.id, address: '2 L2 ROAD' },
    ]);
    const t1Id = byApplicant.get(applicants[0]!.id)!;
    const t2Id = byApplicant.get(applicants[1]!.id)!;
    // Each task's location (area=pincode) is set inside driveToCompleted — after start, before submit —
    // so the commission snapshot (frozen at SUBMIT, ADR-0047) resolves the correct tariff line. (It can't
    // be set before assign: assign validates the assignee's territory eligibility.) T1 → LOCAL @ L1 (CR-L1
    // ₹50); T2 → OGL @ L2 (CR-L2 ₹90).
    await driveToCompleted(caseId, t1Id, fa, l1, 'LOCAL'); // stamps commission_amount: T1 LOCAL @ L1 → 50
    await driveToCompleted(caseId, t2Id, fa, l2, 'OGL'); // → 90

    // Pin a PAST completion instant + a small completed-in band so the as-of-completed_at reads + the
    // band derivation stay deterministic. The snapshot was already stamped at the live completion above.
    await query(
      `UPDATE case_tasks SET completed_at = now() - interval '1 day', completed_elapsed_minutes = 60
       WHERE id = ANY($1)`,
      [[t1Id, t2Id]],
    );

    // db.query camelizes row keys → taskNumber (not task_number).
    const nums = await query<{ id: string; taskNumber: string }>(
      `SELECT id, task_number FROM case_tasks WHERE id = ANY($1) ORDER BY task_number`,
      [[t1Id, t2Id]],
    );
    t1Number = nums.find((n) => n.id === t1Id)!.taskNumber;
    t2Number = nums.find((n) => n.id === t2Id)!.taskNumber;
  });

  it('§E: commission resolves the exact-match tariff line per task (ADR-0050)', async () => {
    // ADR-0086: commission is read from the Commission surface (commissionDetail), not the billing lines.
    const { items: detail } = await billingRepository.commissionDetail({ scope: {}, limit: 50, offset: 0 });
    const t1 = detail.find((l) => l.taskNumber === t1Number)!;
    const t2 = detail.find((l) => l.taskNumber === t2Number)!;
    expect(t1.commissionAmount).toBe(50); // CR-L1 (LOCAL @ L1)
    expect(t2.commissionAmount).toBe(90); // CR-L2 (OGL @ L2) — different exact-match line, same executive
    // sanity: the client bill is the per-location rate (unchanged RATE_LATERAL — independent of distance band)
    expect(t1.billAmount).toBe(350);
    expect(t2.billAmount).toBe(500);

    // billing surface (bill-only) is now a flat per-task line list; roll up the client bill for the case
    const { items } = await billingRepository.listLines(baseOpts);
    const caseLines = items.filter((l: BillingLineRow) => l.caseId === caseId);
    expect(caseLines.reduce((s: number, l: BillingLineRow) => s + (l.billTotal ?? 0), 0)).toBe(850); // 350 + 500
    expect(caseLines.length).toBe(2);
    // per-agent commission rollup = 140 (50 + 90) on the Commission surface
    const { items: summary } = await billingRepository.commissionSummary(sumOpts({}));
    expect(summary.find((r) => r.agentName === 'EE FA')!.commissionTotal).toBe(140);
  });

  it('§E (ADR-0050): LOCAL and OGL price differently for the SAME exec+client+product+unit+location+band', async () => {
    // Isolate the distance-band dimension: two tasks at the SAME location, same client/product/unit/band,
    // assigned LOCAL vs OGL. Two commission rows identical on every dimension EXCEPT rate_type
    // (LOCAL=₹50, OGL=₹90) — proving rate_type is a resolution key (re-coupled) so the bands can carry
    // different amounts. This was impossible under ADR-0046 (rate_type decoupled → the two rows collided).
    const ctx = await seedCpvUnit('LO');
    const fa = await createUser({ username: 'lo_fa', name: 'LO FA', role: 'FIELD_AGENT' });
    const loc = await seedLocation('400077', 'LOAREA'); // ONE shared location for both tasks
    await seedRate(ctx, loc, 200); // client bill rate (location-only; same for both)
    // Two tariff lines differing ONLY in rate_type.
    await seedCommissionRate({
      userId: fa,
      clientId: ctx.clientId,
      productId: ctx.productId,
      verificationUnitId: ctx.unitId,
      locationId: loc,
      fieldRateType: 'LOCAL',
      amount: 50,
    });
    await seedCommissionRate({
      userId: fa,
      clientId: ctx.clientId,
      productId: ctx.productId,
      verificationUnitId: ctx.unitId,
      locationId: loc,
      fieldRateType: 'OGL',
      amount: 90,
    });

    const created = seeded<{ id: string }>(
      await request(app)
        .post('/api/v2/cases')
        .set(SA)
        .send({
          clientId: ctx.clientId,
          productId: ctx.productId,
          backendContactNumber: BC,
          applicants: [
            { name: 'LO A1', mobile: '9000012345' },
            { name: 'LO A2', mobile: '9000012346' },
          ],
          dedupeDecision: 'NO_DUPLICATES_FOUND',
        }),
    );
    const applicants = seeded<{ applicants: { id: string }[] }>(
      await request(app).get(`/api/v2/cases/${created.id}`).set(SA),
    ).applicants;
    const byApplicant = await addTasks(created.id, ctx.unitId, [
      { applicantId: applicants[0]!.id, address: '1 LO ROAD' },
      { applicantId: applicants[1]!.id, address: '2 LO ROAD' },
    ]);
    const localTaskId = byApplicant.get(applicants[0]!.id)!;
    const oglTaskId = byApplicant.get(applicants[1]!.id)!;
    await driveToCompleted(created.id, localTaskId, fa, loc, 'LOCAL'); // → CR LOCAL ₹50
    await driveToCompleted(created.id, oglTaskId, fa, loc, 'OGL'); // → CR OGL ₹90

    const { items: detail } = await billingRepository.commissionDetail({ scope: {}, limit: 50, offset: 0 });
    expect(detail.find((l) => l.taskId === localTaskId)!.commissionAmount).toBe(50); // LOCAL
    expect(detail.find((l) => l.taskId === oglTaskId)!.commissionAmount).toBe(90); // OGL — same context, different band

    const { items } = await billingRepository.listLines(baseOpts);
    const caseLines = items.filter((l: BillingLineRow) => l.caseId === created.id);
    expect(caseLines.reduce((s: number, l: BillingLineRow) => s + (l.billTotal ?? 0), 0)).toBe(400); // 200 + 200 — client bill is location-only, identical for both
    // commission (₹50 LOCAL + ₹90 OGL = ₹140) for LO FA on the Commission surface
    const { items: summary } = await billingRepository.commissionSummary(sumOpts({}));
    expect(summary.find((r) => r.agentName === 'LO FA')!.commissionTotal).toBe(140);
  });

  it('§4 office (ADR-0050): a flat OFFICE commission resolves for a desk task — auto-stamped field_rate_type=OFFICE, location-less', async () => {
    const ctx = await seedCpvUnit('OFF', { workerRole: 'KYC_VERIFIER' }); // desk task ⇒ KYC unit (binding)
    // the office executive = the OFFICE assignment pool (relays the task; never completes it).
    const officeExec = await createUser({ username: 'off_kyc', name: 'OFF DESK', role: 'KYC_VERIFIER' });
    // A location-less client rate (the desk task has no trip/location) so the bill resolves, and a FLAT
    // OFFICE commission row (Universal client/product/unit/band, location-less) — e.g. "PAN desk = ₹20".
    await query(
      `INSERT INTO rates (client_id, product_id, verification_unit_id, location_id, rate_type_id,
                          amount, currency, effective_from)
       VALUES ($1, $2, $3, NULL, (SELECT id FROM rate_types WHERE code = 'LOCAL'), 300, 'INR', now() - interval '2 days')`,
      [ctx.clientId, ctx.productId, ctx.unitId],
    );
    await query(
      `INSERT INTO commission_rates (user_id, client_id, product_id, verification_unit_id, location_id,
                                     rate_type_id, tat_band, amount, currency, effective_from)
       VALUES ($1, NULL, NULL, NULL, NULL, (SELECT id FROM rate_types WHERE code = 'OFFICE'), NULL, 20, 'INR', now() - interval '2 days')`,
      [officeExec],
    );

    const created = seeded<{ id: string }>(
      await request(app)
        .post('/api/v2/cases')
        .set(SA)
        .send({
          clientId: ctx.clientId,
          productId: ctx.productId,
          backendContactNumber: BC,
          applicants: [{ name: 'OFF APP', mobile: '9000099999' }],
          dedupeDecision: 'NO_DUPLICATES_FOUND',
        }),
    );
    const applicantId = seeded<{ applicants: { id: string }[] }>(
      await request(app).get(`/api/v2/cases/${created.id}`).set(SA),
    ).applicants[0]!.id;
    const taskId = (await addTasks(created.id, ctx.unitId, [{ applicantId, address: '9 DESK LANE' }])).get(
      applicantId,
    )!;

    // Assign OFFICE → the server auto-stamps field_rate_type='OFFICE' (no LOCAL/OGL picker, no location).
    expect(
      (
        await request(app)
          .post(`/api/v2/cases/${created.id}/tasks/${taskId}/assign`)
          .set(SA)
          .send({ assignedTo: officeExec, visitType: 'OFFICE', billCount: 1, version: 1 })
      ).status,
    ).toBe(200);
    const [stamped] = await query<{ fieldRateType: string }>(
      `SELECT (SELECT code FROM rate_types WHERE id = ct.rate_type_id) AS field_rate_type
         FROM case_tasks ct WHERE ct.id = $1`,
      [taskId],
    );
    expect(stamped!.fieldRateType).toBe('OFFICE'); // desk auto-stamp

    // A KYC desk task needs document evidence before completion (A2026-0623-16).
    await query(
      `INSERT INTO case_attachments (case_id, task_id, original_name, mime_type, file_size, storage_key, sha256, uploaded_by)
       VALUES ($1, $2, 'doc.pdf', 'application/pdf', 10, $3, 'sha', $4)`,
      [created.id, taskId, `k/${taskId}.pdf`, officeExec],
    );
    // The closer (SA here; in production BACKEND_USER / MANAGER / TEAM_LEADER) completes → COMPLETED,
    // which freezes the flat OFFICE commission via stampCommissionSnapshot.
    expect(
      (
        await request(app)
          .post(`/api/v2/cases/${created.id}/tasks/${taskId}/complete`)
          .set(SA)
          .send({ result: 'POSITIVE', remark: 'desk verified', version: 2 })
      ).status,
    ).toBe(200);

    const { items: detail } = await billingRepository.commissionDetail({ scope: {}, limit: 50, offset: 0 });
    const line = detail.find((l) => l.taskId === taskId)!;
    expect(line.commissionAmount).toBe(20); // flat OFFICE row (location-less commission branch)
    expect(line.billAmount).toBe(300); // location-less client rate
  });

  it('§4: revising a commission rate after completion does NOT rewrite historical commission', async () => {
    const before = await commissionRateRepository.findById(crL2Id);
    const l2Id = before!.locationId;
    expect(l2Id).not.toBeNull(); // CR-L2 is location-scoped
    const next = await commissionRateRepository.revise(crL2Id, 999, null, saId, before!.version);
    // The task's anchor is its earlier completed_at (now - 1 day); the revise end-dates the old row
    // at now() and the new ₹999 row starts at now() — neither covers the completion instant, so the
    // old ₹90 row is still the effective one as-of completion.
    const { items: detail } = await billingRepository.commissionDetail({ scope: {}, limit: 50, offset: 0 });
    expect(detail.find((l) => l.taskNumber === t2Number)!.commissionAmount).toBe(90);
    // …AND the new effective-dated row preserves the location dimension (Task 6 — revise carries dims).
    expect(next.locationId).toBe(l2Id);
    const current = await commissionRateRepository.findById(next.id);
    expect(current!.locationId).toBe(l2Id);
  });

  it('§4 persisted: commission is stamped on the task at completion and survives rate deletion (owner 2026-06-19)', async () => {
    // The amount was stamped onto each task at completion (location set pre-completion in the seed).
    const [t2] = await query<{ commissionAmount: number | null }>(
      `SELECT commission_amount::float8 AS commission_amount FROM case_tasks WHERE task_number = $1`,
      [t2Number],
    );
    expect(t2!.commissionAmount).toBe(90); // stamped @ completion (T2 @ L2 → CR-L2)
    // Remove ALL commission rates → the live lateral now resolves NULL, but the stored snapshot holds.
    await query(`DELETE FROM commission_rates`);
    const { items: detail } = await billingRepository.commissionDetail({ scope: {}, limit: 50, offset: 0 });
    expect(detail.find((l) => l.taskNumber === t1Number)!.commissionAmount).toBe(50); // snapshot, not live
    expect(detail.find((l) => l.taskNumber === t2Number)!.commissionAmount).toBe(90);
    const { items: summary } = await billingRepository.commissionSummary(sumOpts({}));
    expect(summary.find((r) => r.agentName === 'EE FA')!.commissionTotal).toBe(140); // snapshot survives
  });

  it('CLIENT BILL per location reads off the flat billing lines (ADR-0086: breakdown removed, bill-only)', async () => {
    // ADR-0086 removed the billing breakdown panels; the same per-location bill numbers now come from the
    // flat per-task lines (grouped in code). TAT-band grouping was removed with the breakdown.
    const { items: lines } = await billingRepository.listLines(baseOpts);
    const billFor = (area: string) =>
      lines
        .filter((l: BillingLineRow) => l.area === area)
        .reduce((s: number, l: BillingLineRow) => s + (l.billTotal ?? 0), 0);
    expect(billFor('L1AREA')).toBe(350);
    expect(billFor('L2AREA')).toBe(500);
    expect(lines.filter((l: BillingLineRow) => l.area === 'L1AREA').length).toBe(1);
    expect(
      lines
        .filter((l: BillingLineRow) => l.area === 'L2AREA')
        .reduce((s: number, l: BillingLineRow) => s + l.billCount, 0),
    ).toBe(1);
    // total client bill across all lines
    expect(lines.reduce((s: number, l: BillingLineRow) => s + (l.billTotal ?? 0), 0)).toBe(850); // 350 + 500
    // (Commission is no longer grouped by location/band — that lived on the removed billing breakdown, ADR-0086.)
  });

  it('G-8 (ADR-0048): an unmatched-location task bills the location-less default, not a different-location override', async () => {
    // Deactivate the L1-specific rate so T1 (@ L1) has NO matching rate; add a location-less default ₹100
    // for the CPV alongside the existing L2 override (₹500). T1 must resolve the DEFAULT.
    await query(
      `UPDATE rates SET is_active = false
         WHERE client_id = $1 AND product_id = $2 AND verification_unit_id = $3 AND location_id = $4`,
      [ctxShared.clientId, ctxShared.productId, ctxShared.unitId, l1Id],
    );
    await query(
      `INSERT INTO rates (client_id, product_id, verification_unit_id, location_id, rate_type_id, amount, effective_from)
       VALUES ($1, $2, $3, NULL, (SELECT id FROM rate_types WHERE code = 'LOCAL'), 100, now() - interval '2 days')`,
      [ctxShared.clientId, ctxShared.productId, ctxShared.unitId],
    );
    const { items: lines } = await billingRepository.listLines(baseOpts);
    // The FALSE>NULL bug ranks the non-matching L2 override (₹500) above the NULL default → would bill 500.
    // The ADR-0048 CASE rank picks the location-less default instead.
    expect(lines.find((l: BillingLineRow) => l.taskNumber === t1Number)!.billAmount).toBe(100);
    // T2 (@ L2) still matches its own L2 rate.
    expect(lines.find((l: BillingLineRow) => l.taskNumber === t2Number)!.billAmount).toBe(500);
  });

  // --- Commission Summary (ADR-0081) — periodic per-field-user rollup (sumOpts declared above) ---
  // The §E seed = one agent (fa) with two COMPLETED tasks earned THIS month (submitted_at = now):
  // T1 → ₹50, T2 → ₹90. These exercise the billingRepository.commissionSummary read-model.

  it('ADR-0081: per-agent monthly rollup sums the frozen commission for the period', async () => {
    const { items, totalCount } = await billingRepository.commissionSummary(sumOpts({}));
    expect(totalCount).toBe(1); // one agent, one month
    const row = items[0]!;
    expect(row.commissionTotal).toBe(140); // 50 + 90
    expect(row.taskCount).toBe(2);
    expect(row.billableUnits).toBe(2);
    expect(row.clientId).toBeNull(); // groupBy = agent → client/product not split out
    expect(row.productName).toBeNull();
    expect(row.periodKey).toMatch(/^\d{4}-\d{2}$/); // YYYY-MM
  });

  it('ADR-0081: groupBy=agentClientProduct splits out client + product', async () => {
    const { items } = await billingRepository.commissionSummary(sumOpts({ groupBy: 'agentClientProduct' }));
    expect(items).toHaveLength(1); // both tasks share the one client+product
    expect(items[0]!.clientId).not.toBeNull();
    expect(items[0]!.productName).not.toBeNull();
    expect(items[0]!.commissionTotal).toBe(140);
  });

  it('ADR-0081 (FC-5): buckets + filters on earned-at COALESCE(submitted_at, completed_at), not completed_at', async () => {
    // Re-date the two tasks into DIFFERENT months via submitted_at (the earned-at anchor). The frozen
    // commission_amount is unchanged — only the bucket moves. completed_at stays now-1day (different month)
    // to prove the bucket follows submitted_at, NOT completed_at.
    await query(`UPDATE case_tasks SET submitted_at = '2026-01-15T10:00:00Z' WHERE task_number = $1`, [
      t1Number,
    ]);
    await query(`UPDATE case_tasks SET submitted_at = '2026-03-20T10:00:00Z' WHERE task_number = $1`, [
      t2Number,
    ]);

    const monthly = await billingRepository.commissionSummary(sumOpts({}));
    expect(monthly.totalCount).toBe(2); // two distinct months now
    const jan = monthly.items.find((r) => r.periodKey === '2026-01')!;
    const mar = monthly.items.find((r) => r.periodKey === '2026-03')!;
    expect(jan.commissionTotal).toBe(50); // T1 earned in Jan
    expect(mar.commissionTotal).toBe(90); // T2 earned in Mar
    expect(monthly.items[0]!.periodKey).toBe('2026-03'); // ORDER BY period_start DESC

    // Earned-at range filter excludes the Jan task.
    const filtered = await billingRepository.commissionSummary(sumOpts({ from: '2026-02-01T00:00:00Z' }));
    expect(filtered.totalCount).toBe(1);
    expect(filtered.items[0]!.commissionTotal).toBe(90);

    // Quarterly bucket collapses Jan→Q1, Mar→Q1 into ONE row.
    const quarterly = await billingRepository.commissionSummary(sumOpts({ period: 'quarter' }));
    expect(quarterly.totalCount).toBe(1);
    expect(quarterly.items[0]!.periodKey).toBe('2026-Q1');
    expect(quarterly.items[0]!.commissionTotal).toBe(140);
  });

  it('ADR-0081: fortnight buckets split a month at the 15th (H1 / H2)', async () => {
    await query(`UPDATE case_tasks SET submitted_at = '2026-05-10T10:00:00Z' WHERE task_number = $1`, [
      t1Number,
    ]);
    await query(`UPDATE case_tasks SET submitted_at = '2026-05-20T10:00:00Z' WHERE task_number = $1`, [
      t2Number,
    ]);
    const { items, totalCount } = await billingRepository.commissionSummary(sumOpts({ period: 'fortnight' }));
    expect(totalCount).toBe(2);
    expect(items.find((r) => r.periodKey === '2026-05-H1')!.commissionTotal).toBe(50); // 10th → H1
    expect(items.find((r) => r.periodKey === '2026-05-H2')!.commissionTotal).toBe(90); // 20th → H2
  });

  it('ADR-0081 (Option A): summary carries billTotal; agentClientProductRateType splits by client+field rate type', async () => {
    // plain agent grouping now carries billTotal (client bill sum) alongside commission
    const agg = await billingRepository.commissionSummary(sumOpts({}));
    expect(agg.items[0]!.billTotal).toBe(850); // 350 (T1) + 500 (T2), both COMPLETED
    expect(agg.items[0]!.commissionTotal).toBe(140);
    expect(agg.items[0]!.clientRateType).toBeNull(); // not split at this grain
    expect(agg.items[0]!.fieldRateType).toBeNull();

    // rate-type grouping → one row per (client_rate_type, field_rate_type) combo
    const rt = await billingRepository.commissionSummary(sumOpts({ groupBy: 'agentClientProductRateType' }));
    expect(rt.totalCount).toBe(2);
    const local = rt.items.find((r) => r.fieldRateType === 'LOCAL')!; // T1
    const ogl = rt.items.find((r) => r.fieldRateType === 'OGL')!; // T2
    expect(local.clientRateType).toBe('LOCAL');
    expect(local.billTotal).toBe(350);
    expect(local.commissionTotal).toBe(50);
    expect(ogl.clientRateType).toBe('LOCAL'); // both client bill rates are LOCAL
    expect(ogl.billTotal).toBe(500);
    expect(ogl.commissionTotal).toBe(90);
    expect(local.clientName).not.toBeNull(); // client/product populated at this grain
    expect(local.productName).not.toBeNull();
  });

  it('ADR-0081 (Option B): commissionDetail = per-task rows with both rate types + the real per-task rate', async () => {
    const { items, totalCount } = await billingRepository.commissionDetail({
      scope: {},
      limit: 50,
      offset: 0,
    });
    expect(totalCount).toBe(2);
    const t1 = items.find((r) => r.taskNumber === t1Number)!;
    const t2 = items.find((r) => r.taskNumber === t2Number)!;
    expect(t1.clientRateType).toBe('LOCAL');
    expect(t1.fieldRateType).toBe('LOCAL');
    expect(t1.billAmount).toBe(350); // the REAL per-task client bill rate (not a total)
    expect(t1.commissionAmount).toBe(50);
    expect(t2.fieldRateType).toBe('OGL');
    expect(t2.billAmount).toBe(500);
    expect(t2.commissionAmount).toBe(90);
    expect(t1.agentName).toBeTruthy();
    expect(t1.clientName).toBeTruthy();
    expect(t1.unitName).toBeTruthy();
    expect(t1.caseNumber).toBeTruthy();
    expect(t1.status).toBe('COMPLETED');
  });

  // NOTE: mutates the shared seed (bill_count). `beforeEach` re-seeds, so isolation holds, but this
  // is kept as the LAST `it()` so the earlier §E bill_count=1 assertions (850/140) are unaffected.
  it('bill_count multiplies bill+commission and reports billable_units', async () => {
    await query(`UPDATE case_tasks SET bill_count = 3 WHERE task_number = $1`, [t2Number]);
    const { items } = await billingRepository.listLines(baseOpts);
    const caseLines = items.filter((l: BillingLineRow) => l.caseId === caseId);
    expect(caseLines.reduce((s: number, l: BillingLineRow) => s + (l.billTotal ?? 0), 0)).toBe(350 + 500 * 3); // 1850
    expect(caseLines.reduce((s: number, l: BillingLineRow) => s + l.billCount, 0)).toBe(4); // 1 + 3
    expect(caseLines.length).toBe(2); // task count unchanged
    // commission also multiplies by bill_count on the Commission surface: 50*1 + 90*3 = 320
    const { items: summary } = await billingRepository.commissionSummary(sumOpts({}));
    expect(summary.find((r) => r.agentName === 'EE FA')!.commissionTotal).toBe(50 + 90 * 3); // 320
  });

  it('ADR-0047: a SUBMITTED task shows field commission but NO client bill; a COMPLETED sibling bills', async () => {
    const ctx = await seedCpvUnit('SB');
    const fa = await createUser({ username: 'sb_fa', name: 'SB FA', role: 'FIELD_AGENT' });
    const loc = await seedLocation('500001', 'SBAREA');
    await seedRate(ctx, loc, 350); // client bill rate
    // Field commission as a fully-specified LOCAL tariff line @ loc, tat_band -1 (no tat_policies seeded).
    await seedCommissionRate({
      userId: fa,
      clientId: ctx.clientId,
      productId: ctx.productId,
      verificationUnitId: ctx.unitId,
      locationId: loc,
      fieldRateType: 'LOCAL',
      amount: 50,
    });

    const created = seeded<{ id: string }>(
      await request(app)
        .post('/api/v2/cases')
        .set(SA)
        .send({
          clientId: ctx.clientId,
          productId: ctx.productId,
          backendContactNumber: BC,
          applicants: [
            { name: 'SB A1', mobile: '9000012345' },
            { name: 'SB A2', mobile: '9000012346' },
          ],
          dedupeDecision: 'NO_DUPLICATES_FOUND',
        }),
    );
    const applicants = seeded<{ applicants: { id: string }[] }>(
      await request(app).get(`/api/v2/cases/${created.id}`).set(SA),
    ).applicants;
    const byApplicant = await addTasks(created.id, ctx.unitId, [
      { applicantId: applicants[0]!.id, address: '1 SB ROAD' },
      { applicantId: applicants[1]!.id, address: '2 SB ROAD' },
    ]);
    const subTaskId = byApplicant.get(applicants[0]!.id)!;
    const compTaskId = byApplicant.get(applicants[1]!.id)!;
    await driveToSubmitted(created.id, subTaskId, fa, loc); // → SUBMITTED (commission ₹50, no bill)
    await driveToCompleted(created.id, compTaskId, fa, loc); // → COMPLETED (commission ₹50 + bill ₹350)

    // bill (billing surface): the flat lines list is COMPLETED-only, so the SUBMITTED task is ABSENT;
    // the COMPLETED sibling appears and bills.
    const { items: lines } = await billingRepository.listLines(baseOpts);
    expect(lines.find((l: BillingLineRow) => l.taskId === subTaskId)).toBeUndefined(); // NOT billed until the office completes
    expect(lines.find((l: BillingLineRow) => l.taskId === compTaskId)!.billAmount).toBe(350);

    // commission (Commission surface): field commission frozen at submit for BOTH tasks
    const { items: detail } = await billingRepository.commissionDetail({ scope: {}, limit: 50, offset: 0 });
    expect(detail.find((l) => l.taskId === subTaskId)!.commissionAmount).toBe(50); // frozen at submit
    expect(detail.find((l) => l.taskId === compTaskId)!.commissionAmount).toBe(50);

    const { items } = await billingRepository.listLines(baseOpts);
    const caseLines = items.filter((l: BillingLineRow) => l.caseId === created.id);
    expect(caseLines.reduce((s: number, l: BillingLineRow) => s + (l.billTotal ?? 0), 0)).toBe(350); // only the COMPLETED task bills the client
    expect(caseLines.length).toBe(1); // client billing count = COMPLETED only
    // both tasks are field-commissioned (50 + 50 = 100) for SB FA on the Commission surface
    const { items: summary } = await billingRepository.commissionSummary(sumOpts({}));
    expect(summary.find((r) => r.agentName === 'SB FA')!.commissionTotal).toBe(100);
  });
});
