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
import { billingRepository, type BillingCaseListOptions } from '../repository.js';
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

/** Create a locations row (pincode + area) and return its id. */
async function seedLocation(pincode: string, area: string): Promise<number> {
  const res = await request(app)
    .post('/api/v2/locations')
    .set(SA)
    .send({ pincode, area, city: 'Mumbai', state: 'MH' });
  return seeded<{ id: number }>(res).id;
}

async function createUser(o: { username: string; name: string; role: string }): Promise<string> {
  const res = await request(app).post('/api/v2/users').set(SA).send(o);
  expect(res.status).toBe(201);
  return res.body.id as string;
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
      rateType: 'LOCAL',
      amount,
    }),
  );
}

/**
 * Create a commission_rates row directly (the create endpoint does not carry the new dimensions
 * until Task 6). Returns the row id. `locationId`/`tatBand` default to NULL (= applies generally).
 */
async function seedCommissionRate(o: {
  userId: string;
  locationId?: number;
  amount: number;
}): Promise<number> {
  const [row] = await query<{ id: number }>(
    `INSERT INTO commission_rates (user_id, location_id, amount, currency, effective_from)
     VALUES ($1, $2, $3, 'INR', now() - interval '2 days')
     RETURNING id`,
    [o.userId, o.locationId ?? null, o.amount],
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
 * Assign → start → (set location) → complete a task as the field agent. The optional `locationId` is
 * stamped onto the task AFTER start but BEFORE complete: assign validates assignee eligibility by
 * territory (a located task the agent isn't scoped to → 400), so the location can't exist at assign;
 * but the commission snapshot is taken at completion (ADR-0046 §4), so it must exist by then.
 */
async function driveToCompleted(
  caseId: string,
  taskId: string,
  fa: string,
  locationId?: number,
): Promise<void> {
  expect(
    (
      await request(app)
        .post(`/api/v2/cases/${caseId}/tasks/${taskId}/assign`)
        .set(SA)
        .send({ assignedTo: fa, visitType: 'FIELD', distanceBand: 'LOCAL', billCount: 1, version: 1 })
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
  ).toBe(200);
}

describe.skipIf(!RUN)('commission rebuild §E (ADR-0046)', () => {
  // SUPER_ADMIN ALL scope = empty scope object (no hierarchy/restrict filter).
  const baseOpts: BillingCaseListOptions = {
    scope: {},
    sortColumn: 'last_completed_at',
    sortOrder: 'desc',
    limit: 50,
    offset: 0,
  };

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

    // Commission for agent U: CR-base ₹50 as the all-NULL universal default + CR-L2 ₹90 scoped to L2.
    // Neither carries a rate_type — the per-location resolution proves the decoupling. T1 (@L1) has no
    // L1-specific row so it resolves the location-less default (₹50); T2 (@L2) resolves CR-L2 (₹90).
    // Task 6's `revise` carries dimensions forward, so revising CR-L2 keeps location=L2 and never
    // collides with the all-NULL base under the no-overlap EXCLUDE.
    await seedCommissionRate({ userId: fa, amount: 50 });
    crL2Id = await seedCommissionRate({ userId: fa, locationId: l2, amount: 90 });

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
    // Each task's location (area=pincode) is set inside driveToCompleted — after start, before complete
    // — so the commission snapshot (stamped at completion, ADR-0046 §4) resolves the correct per-location
    // rate. (It cannot be set before assign: assign validates the assignee's territory eligibility.)
    await driveToCompleted(caseId, t1Id, fa, l1); // stamps commission_amount: T1 @ L1 → 50
    await driveToCompleted(caseId, t2Id, fa, l2); // → 90

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

  it('§E: commission differs per-location for the same executive (decoupled from rate_type)', async () => {
    const lines = await billingRepository.caseTasks(caseId);
    const t1 = lines.find((l) => l.taskNumber === t1Number)!;
    const t2 = lines.find((l) => l.taskNumber === t2Number)!;
    expect(t1.commissionAmount).toBe(50); // CR-base @ L1
    expect(t2.commissionAmount).toBe(90); // CR-L2 @ L2 — different amount, same executive, only location differs
    // sanity: the client bill is the per-location rate (unchanged RATE_LATERAL)
    expect(t1.billAmount).toBe(350);
    expect(t2.billAmount).toBe(500);

    const { items } = await billingRepository.listCases(baseOpts);
    const c = items.find((i) => i.caseId === caseId)!;
    expect(c.commissionTotal).toBe(140); // 50 + 90 (was 100 when coupled to rate_type)
    expect(c.billTotal).toBe(850); // 350 + 500
    expect(c.completedTaskCount).toBe(2);
  });

  it('§4: revising a commission rate after completion does NOT rewrite historical commission', async () => {
    const before = await commissionRateRepository.findById(crL2Id);
    const l2Id = before!.locationId;
    expect(l2Id).not.toBeNull(); // CR-L2 is location-scoped
    const next = await commissionRateRepository.revise(crL2Id, 999, null, saId, before!.version);
    // The task's anchor is its earlier completed_at (now - 1 day); the revise end-dates the old row
    // at now() and the new ₹999 row starts at now() — neither covers the completion instant, so the
    // old ₹90 row is still the effective one as-of completion.
    const lines = await billingRepository.caseTasks(caseId);
    expect(lines.find((l) => l.taskNumber === t2Number)!.commissionAmount).toBe(90);
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
    const lines = await billingRepository.caseTasks(caseId);
    expect(lines.find((l) => l.taskNumber === t1Number)!.commissionAmount).toBe(50); // snapshot, not live
    expect(lines.find((l) => l.taskNumber === t2Number)!.commissionAmount).toBe(90);
    const { items } = await billingRepository.listCases(baseOpts);
    expect(items.find((i) => i.caseId === caseId)!.commissionTotal).toBe(140);
  });

  it('breakdown groups by location and by completed-in band', async () => {
    const bd = await billingRepository.breakdown(baseOpts);
    const l1 = bd.byLocation.find((r) => r.area === 'L1AREA');
    const l2 = bd.byLocation.find((r) => r.area === 'L2AREA');
    expect(l1?.commissionTotal).toBe(50); // T1 @ L1
    expect(l2?.commissionTotal).toBe(90); // T2 @ L2
    expect(l1?.billTotal).toBe(350);
    expect(l2?.billTotal).toBe(500);
    expect(l1?.completedTaskCount).toBe(1);
    expect(l2?.billableUnits).toBe(1);
    // Both tasks completed in 60 minutes → the same completed-in band; at least one band group.
    expect(bd.byBand.length).toBeGreaterThanOrEqual(1);
    const bandCommission = bd.byBand.reduce((s, b) => s + b.commissionTotal, 0);
    expect(bandCommission).toBe(140); // 50 + 90 across all bands
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
      `INSERT INTO rates (client_id, product_id, verification_unit_id, location_id, rate_type, amount, effective_from)
       VALUES ($1, $2, $3, NULL, 'LOCAL', 100, now() - interval '2 days')`,
      [ctxShared.clientId, ctxShared.productId, ctxShared.unitId],
    );
    const lines = await billingRepository.caseTasks(caseId);
    // The FALSE>NULL bug ranks the non-matching L2 override (₹500) above the NULL default → would bill 500.
    // The ADR-0048 CASE rank picks the location-less default instead.
    expect(lines.find((l) => l.taskNumber === t1Number)!.billAmount).toBe(100);
    // T2 (@ L2) still matches its own L2 rate.
    expect(lines.find((l) => l.taskNumber === t2Number)!.billAmount).toBe(500);
  });

  // NOTE: mutates the shared seed (bill_count). `beforeEach` re-seeds, so isolation holds, but this
  // is kept as the LAST `it()` so the earlier §E bill_count=1 assertions (850/140) are unaffected.
  it('bill_count multiplies bill+commission and reports billable_units', async () => {
    await query(`UPDATE case_tasks SET bill_count = 3 WHERE task_number = $1`, [t2Number]);
    const { items } = await billingRepository.listCases(baseOpts);
    const c = items.find((i) => i.caseId === caseId)!;
    expect(c.billTotal).toBe(350 + 500 * 3); // 1850
    expect(c.commissionTotal).toBe(50 + 90 * 3); // 320
    expect(c.billableUnits).toBe(4); // 1 + 3
    expect(c.completedTaskCount).toBe(2); // task count unchanged
  });
});
