import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import {
  createTestDb,
  clientFactory,
  productFactory,
  verificationUnitFactory,
  authHeaderForRole,
} from '@crm2/test-utils';
import type { TaskStats, TaskView } from '@crm2/sdk';
import { createApp } from '../../../http/app.js';
import { setPool } from '../../../platform/db.js';
import { invalidateRoleCache } from '../../../platform/access/index.js';

const RUN = !!process.env['DATABASE_URL'];
const db = RUN ? createTestDb() : null;
const app = createApp({ enableTestAuth: true });
const SA = authHeaderForRole('SUPER_ADMIN');
const FA = authHeaderForRole('FIELD_AGENT'); // case.view, NOT data.export
// A day ago — CPV seeded with this effective_from is already-effective, so the immediate
// `effective_from <= now()` enablement gate can't race the clock (see seedCpv).
const PAST = new Date(Date.now() - 24 * 3600 * 1000).toISOString();

interface Ctx {
  clientId: number;
  productId: number;
  unitAId: number;
  unitBId: number;
}

/** Unwrap a seed write, failing LOUDLY with the upstream status+body (cases.api precedent). */
function seeded<T>(res: request.Response): T {
  if (res.status >= 400) throw new Error(`seed write failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body as T;
}

/** Seed a client+product with TWO CPV-enabled units (task-grain tests need sibling tasks). */
async function seedCpv(tag: string): Promise<Ctx> {
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
  const unitAId = seeded<{ id: number }>(
    await request(app)
      .post('/api/v2/verification-units')
      .set(SA)
      .send(verificationUnitFactory({ code: `UA_${tag}` })),
  ).id;
  const unitBId = seeded<{ id: number }>(
    await request(app)
      .post('/api/v2/verification-units')
      .set(SA)
      .send(verificationUnitFactory({ code: `UB_${tag}` })),
  ).id;
  // Seed the CPV mapping effective-from in the PAST. Defaulting to now() (ADR-0017) races the
  // immediate `effective_from <= now()` gate in allUnitsEnabled: a hair of clock jitter between the
  // create-txn and the addTasks-txn intermittently fails it (UNIT_NOT_ENABLED). A past value makes
  // the gate unconditionally true without touching production semantics (the seed simply onboards
  // CPV as already-effective).
  const cpId = seeded<{ id: number }>(
    await request(app)
      .post('/api/v2/client-products')
      .set(SA)
      .send({ clientId, productId, effectiveFrom: PAST }),
  ).id;
  for (const verificationUnitId of [unitAId, unitBId]) {
    seeded(
      await request(app)
        .post('/api/v2/cpv-units')
        .set(SA)
        .send({ clientProductId: cpId, verificationUnitId, effectiveFrom: PAST }),
    );
  }
  return { clientId, productId, unitAId, unitBId };
}

async function createUser(o: { username: string; name: string; role: string; reportsTo?: string }) {
  const res = await request(app).post('/api/v2/users').set(SA).send(o);
  expect(res.status).toBe(201);
  return res.body.id as string;
}

/** Create a case (optionally located) carrying one task per given unit; returns task ids in order. */
async function seedCaseTasks(
  ctx: Ctx,
  o: { name: string; unitIds: number[]; pincodeId?: number },
): Promise<{ caseId: string; taskIds: string[] }> {
  const caseId = seeded<{ id: string }>(
    await request(app)
      .post('/api/v2/cases')
      .set(SA)
      .send({
        clientId: ctx.clientId,
        productId: ctx.productId,
        backendContactNumber: '9876543210',
        applicants: [{ name: o.name }],
        dedupeDecision: 'NO_DUPLICATES_FOUND',
        ...(o.pincodeId !== undefined ? { pincodeId: o.pincodeId } : {}),
      }),
  ).id;
  const applicantId = seeded<{ applicants: { id: string }[] }>(
    await request(app).get(`/api/v2/cases/${caseId}`).set(SA),
  ).applicants[0]!.id;
  const tasks = seeded<{ id: string; verificationUnitId: number }[]>(
    await request(app)
      .post(`/api/v2/cases/${caseId}/tasks`)
      .set(SA)
      .send({
        tasks: o.unitIds.map((verificationUnitId) => ({
          verificationUnitId,
          applicantId,
          address: '12 MG ROAD',
        })),
      }),
  );
  const taskIds = o.unitIds.map((u) => {
    const t = tasks.find((x) => x.verificationUnitId === u);
    if (!t) throw new Error(`seedCaseTasks(${o.name}): no task for unit ${u}`);
    return t.id;
  });
  return { caseId, taskIds };
}

const assign = (caseId: string, taskId: string, assignedTo: string) =>
  request(app)
    .post(`/api/v2/cases/${caseId}/tasks/${taskId}/assign`)
    .set(SA)
    .send({ assignedTo, visitType: 'FIELD', distanceBand: 'LOCAL', billCount: 1, version: 1 });

const hdr = (role: string, id: string): Record<string, string> => ({ 'x-test-auth': `${role}:${id}` });

const taskIdsOf = async (h: Record<string, string>, qs = ''): Promise<string[]> =>
  ((await request(app).get(`/api/v2/tasks${qs}`).set(h)).body.items as { id: string }[]).map((t) => t.id);

describe.skipIf(!RUN)('tasks API (Pipeline)', () => {
  beforeAll(async () => {
    await db!.migrate();
    setPool(db!.pool);
  });
  afterAll(async () => {
    await db!.end();
  });
  beforeEach(async () => {
    await db!.truncate(
      'user_scope_assignments',
      'commission_rates',
      'rates',
      'case_tasks',
      'case_applicants',
      'cases',
      'client_product_verification_units',
      'client_products',
      'verification_units',
      'clients',
      'products',
      'users',
      'locations',
    );
  });

  it('returns the Paginated envelope with case context columns (1:1 joins)', async () => {
    const ctx = await seedCpv('ENV');
    await seedCaseTasks(ctx, { name: 'ENV APP', unitIds: [ctx.unitAId, ctx.unitBId] });
    const res = await request(app).get('/api/v2/tasks?limit=25').set(SA);
    expect(res.status).toBe(200);
    expect(res.body.totalCount).toBe(2);
    expect(res.body.pageSize).toBe(25);
    expect(res.body.sort).toEqual({ sortBy: 'createdAt', sortOrder: 'desc' });
    const row = res.body.items[0];
    expect(row.caseNumber).toMatch(/^CASE-\d{6}$/);
    expect(row.taskNumber).toMatch(/^CASE-\d{6}-\d+$/); // per-task number (ADR-0023)
    expect(row.clientName).toBeTruthy();
    expect(row.primaryName).toBe('ENV APP');
    expect(row.unitKind).toBe('FIELD_VISIT');
    expect(row.status).toBe('PENDING');
  });

  it('filters: status domain param + f_unitKind enum + f_caseNumber text; echoes into envelope', async () => {
    const ctx = await seedCpv('FLT');
    const a = await seedCaseTasks(ctx, { name: 'FLT ONE', unitIds: [ctx.unitAId] });
    await seedCaseTasks(ctx, { name: 'FLT TWO', unitIds: [ctx.unitBId] });
    const agent = await createUser({ username: 'fa_flt', name: 'FA FLT', role: 'FIELD_AGENT' });
    expect((await assign(a.caseId, a.taskIds[0]!, agent)).status).toBe(200);

    const assigned = await request(app).get('/api/v2/tasks?status=ASSIGNED').set(SA);
    expect(assigned.body.totalCount).toBe(1);
    expect(assigned.body.items[0].id).toBe(a.taskIds[0]);
    expect(assigned.body.filters.status).toBe('ASSIGNED');

    const kind = await request(app).get('/api/v2/tasks?f_unitKind=FIELD_VISIT').set(SA);
    expect(kind.body.totalCount).toBe(2);
    const noKind = await request(app).get('/api/v2/tasks?f_unitKind=KYC_DOCUMENT').set(SA);
    expect(noKind.body.totalCount).toBe(0);

    const caseNumber = (await request(app).get(`/api/v2/cases/${a.caseId}`).set(SA)).body
      .caseNumber as string;
    const byCase = await request(app).get(`/api/v2/tasks?f_caseNumber=${caseNumber}`).set(SA);
    expect(byCase.body.totalCount).toBe(1);
    expect(byCase.body.filters.f_caseNumber).toBe(caseNumber);
  });

  it('rejects limit > 500 (gate 41); unknown sortBy falls back (no injection surface)', async () => {
    const big = await request(app).get('/api/v2/tasks?limit=501').set(SA);
    expect(big.status).toBe(400);
    expect(big.body.error).toBe('LIMIT_TOO_LARGE');
    const inj = await request(app).get('/api/v2/tasks?sortBy=ct.status;DROP TABLE cases').set(SA);
    expect(inj.status).toBe(200);
    expect(inj.body.sort.sortBy).toBe('createdAt');
  });

  describe('data scope (TASK level)', () => {
    it('hierarchy: assignee + their leaders see the task; unrelated agents see nothing (COUNT consistent)', async () => {
      const ctx = await seedCpv('SC');
      const tl = await createUser({ username: 'tsc_tl', name: 'TSC TL', role: 'TEAM_LEADER' });
      const fa1 = await createUser({
        username: 'tsc_fa1',
        name: 'TSC FA1',
        role: 'FIELD_AGENT',
        reportsTo: tl,
      });
      const fa2 = await createUser({ username: 'tsc_fa2', name: 'TSC FA2', role: 'FIELD_AGENT' });
      const c = await seedCaseTasks(ctx, { name: 'TSC APP', unitIds: [ctx.unitAId, ctx.unitBId] });
      expect((await assign(c.caseId, c.taskIds[0]!, fa1)).status).toBe(200);

      // the assignee sees THEIR task only — not the sibling task of the same case
      const faSees = await taskIdsOf(hdr('FIELD_AGENT', fa1));
      expect(faSees).toContain(c.taskIds[0]);
      expect(faSees).not.toContain(c.taskIds[1]);
      // the leader (DIRECT_TEAM) sees the team's task
      expect(await taskIdsOf(hdr('TEAM_LEADER', tl))).toContain(c.taskIds[0]);
      // an unrelated agent sees nothing, and the COUNT agrees
      const r = await request(app).get('/api/v2/tasks').set(hdr('FIELD_AGENT', fa2));
      expect(r.body.totalCount).toBe(0);
      expect(r.body.items).toHaveLength(0);
      // SUPER_ADMIN bypasses scope (attribute-driven)
      expect(await taskIdsOf(SA)).toEqual(expect.arrayContaining(c.taskIds));
    });

    it('VERIFICATION_TYPE is task-grain: a VT-scoped user sees ONLY matching tasks, never siblings', async () => {
      const ctx = await seedCpv('VT');
      const c = await seedCaseTasks(ctx, { name: 'VT APP', unitIds: [ctx.unitAId, ctx.unitBId] });
      const be = await createUser({ username: 'tvt_be', name: 'TVT BE', role: 'BACKEND_USER' });
      // Neutralize the default PRODUCT cap so this test isolates the VERIFICATION_TYPE mechanic.
      await db!.pool.query(
        `INSERT INTO role_scope_dimensions (role_code, dimension_code, mode)
         VALUES ('BACKEND_USER', 'VERIFICATION_TYPE', 'EXPAND') ON CONFLICT (role_code, dimension_code) DO NOTHING`,
      );
      await db!.pool.query(
        `UPDATE role_scope_dimensions SET mode = 'EXPAND' WHERE role_code = 'BACKEND_USER' AND dimension_code = 'PRODUCT'`,
      );
      invalidateRoleCache();
      try {
        seeded(
          await request(app)
            .post(`/api/v2/users/${be}/scope-assignments`)
            .set(SA)
            .send({ dimension: 'VERIFICATION_TYPE', entityIds: [ctx.unitAId] }),
        );
        const seen = await taskIdsOf(hdr('BACKEND_USER', be));
        expect(seen).toContain(c.taskIds[0]); // the unit-A task
        expect(seen).not.toContain(c.taskIds[1]); // sibling unit-B task of the SAME case — hidden
      } finally {
        await db!.pool.query(
          `DELETE FROM role_scope_dimensions WHERE role_code = 'BACKEND_USER' AND dimension_code = 'VERIFICATION_TYPE'`,
        );
        await db!.pool.query(
          `UPDATE role_scope_dimensions SET mode = 'RESTRICT' WHERE role_code = 'BACKEND_USER' AND dimension_code = 'PRODUCT'`,
        );
        invalidateRoleCache();
      }
    });

    it('territory EXPAND: a field agent sees unassigned tasks of located cases in their pincode', async () => {
      const ctx = await seedCpv('TERR');
      const pin = (
        await db!.pool.query<{ id: number }>(
          `INSERT INTO locations (pincode, area, city, state, country)
           VALUES ('560002', 'Brigade Road', 'Bengaluru', 'Karnataka', 'India') RETURNING id`,
        )
      ).rows[0]!.id;
      const c = await seedCaseTasks(ctx, { name: 'TERR APP', unitIds: [ctx.unitAId], pincodeId: pin });
      const faIn = await createUser({ username: 'tfa_in', name: 'TFA IN', role: 'FIELD_AGENT' });
      const faOut = await createUser({ username: 'tfa_out', name: 'TFA OUT', role: 'FIELD_AGENT' });
      seeded(
        await request(app)
          .post(`/api/v2/users/${faIn}/scope-assignments`)
          .set(SA)
          .send({ dimension: 'PINCODE', entityIds: [pin] }),
      );
      expect(await taskIdsOf(hdr('FIELD_AGENT', faIn))).toContain(c.taskIds[0]);
      expect(await taskIdsOf(hdr('FIELD_AGENT', faOut))).not.toContain(c.taskIds[0]);
    });

    it('RESTRICT fail-closed: hierarchy ALL + CLIENT RESTRICT with zero assignments sees NOTHING', async () => {
      const ctx = await seedCpv('RST');
      await seedCaseTasks(ctx, { name: 'RST APP', unitIds: [ctx.unitAId] });
      const be = await createUser({ username: 'trs_be', name: 'TRS BE', role: 'BACKEND_USER' });
      // Neutralize the default PRODUCT cap so this test isolates the CLIENT RESTRICT fail-closed mechanic.
      await db!.pool.query(`UPDATE roles SET hierarchy_mode = 'ALL' WHERE code = 'BACKEND_USER'`);
      await db!.pool.query(
        `INSERT INTO role_scope_dimensions (role_code, dimension_code, mode)
         VALUES ('BACKEND_USER', 'CLIENT', 'RESTRICT')
         ON CONFLICT (role_code, dimension_code) DO UPDATE SET mode = 'RESTRICT', is_active = true`,
      );
      await db!.pool.query(
        `UPDATE role_scope_dimensions SET mode = 'EXPAND' WHERE role_code = 'BACKEND_USER' AND dimension_code = 'PRODUCT'`,
      );
      invalidateRoleCache();
      try {
        const r = await request(app).get('/api/v2/tasks').set(hdr('BACKEND_USER', be));
        expect(r.body.totalCount).toBe(0); // wired-but-unassigned RESTRICT caps to zero rows
        // assign the client → exactly that client's tasks appear
        seeded(
          await request(app)
            .post(`/api/v2/users/${be}/scope-assignments`)
            .set(SA)
            .send({ dimension: 'CLIENT', entityIds: [ctx.clientId] }),
        );
        const r2 = await request(app).get('/api/v2/tasks').set(hdr('BACKEND_USER', be));
        expect(r2.body.totalCount).toBe(1);
      } finally {
        await db!.pool.query(`UPDATE roles SET hierarchy_mode = 'SELF' WHERE code = 'BACKEND_USER'`);
        // CLIENT is part of the DAY-0 SEED wiring for BACKEND_USER (EXPAND) — restore it, never
        // DELETE it (suite-order poisoning: later tests rely on the seed). PRODUCT → its RESTRICT default.
        await db!.pool.query(
          `UPDATE role_scope_dimensions SET mode = 'EXPAND', is_active = true
           WHERE role_code = 'BACKEND_USER' AND dimension_code = 'CLIENT'`,
        );
        await db!.pool.query(
          `UPDATE role_scope_dimensions SET mode = 'RESTRICT' WHERE role_code = 'BACKEND_USER' AND dimension_code = 'PRODUCT'`,
        );
        invalidateRoleCache();
      }
    });
  });

  it('stats: scoped bucket counts honoring search, MINUS the status bucket param', async () => {
    const ctx = await seedCpv('ST');
    const c = await seedCaseTasks(ctx, { name: 'ST APP', unitIds: [ctx.unitAId, ctx.unitBId] });
    const agent = await createUser({ username: 'tst_fa', name: 'TST FA', role: 'FIELD_AGENT' });
    expect((await assign(c.caseId, c.taskIds[0]!, agent)).status).toBe(200);

    const all = await request(app).get('/api/v2/tasks/stats').set(SA);
    expect(all.status).toBe(200);
    expect(all.body).toEqual({
      pending: 1,
      assigned: 1,
      inProgress: 0,
      completed: 0,
      revoked: 0,
      overdue: 0, // both tasks just created → within TAT
      commissionable: 0, // nothing completed yet
      total: 2,
    });
    // scoped: the agent's buckets count only their own task
    const mine = await request(app).get('/api/v2/tasks/stats').set(hdr('FIELD_AGENT', agent));
    expect(mine.body.assigned).toBe(1);
    expect(mine.body.total).toBe(1);
  });

  it('Out of TAT (ADR-0044): an OPEN task past its tat_hours since assigned_at is counted, filtered by overdue=1, flagged + with due_at/tatHours on the row', async () => {
    const ctx = await seedCpv('TTAT');
    const c = await seedCaseTasks(ctx, { name: 'TTAT APP', unitIds: [ctx.unitAId, ctx.unitBId] });
    // task A: assigned ~5h ago with a 4h target → OVERDUE (clock starts at assigned_at, not created_at)
    await db!.pool.query(
      `UPDATE case_tasks SET status = 'ASSIGNED', assigned_at = now() - interval '5 hours', tat_hours = 4 WHERE id = $1`,
      [c.taskIds[0]],
    );
    // task B: assigned just now with a 48h target → WELL within target
    await db!.pool.query(
      `UPDATE case_tasks SET status = 'ASSIGNED', assigned_at = now(), tat_hours = 48 WHERE id = $1`,
      [c.taskIds[1]],
    );

    // stats: exactly one task is out of TAT
    const stats = await request(app).get('/api/v2/tasks/stats').set(SA);
    expect(stats.body.overdue).toBe(1);

    const list = await request(app).get('/api/v2/tasks?overdue=1').set(SA);
    expect(list.status).toBe(200);
    const ids = (list.body.items as TaskView[]).map((t) => t.id);
    expect(ids).toContain(c.taskIds[0]); // the overdue task
    expect(ids).not.toContain(c.taskIds[1]); // the within-target task is excluded
    expect(list.body.filters.overdue).toBe('1');

    const overdueRow = (list.body.items as TaskView[]).find((t) => t.id === c.taskIds[0])!;
    expect(overdueRow.overdue).toBe(true);
    expect(overdueRow.tatHours).toBe(4);
    expect(typeof overdueRow.dueAt).toBe('string'); // assigned_at + 4h, computed

    // the non-overdue task carries its read-model fields too (overdue false), even off the overdue filter
    const allRow = ((await request(app).get('/api/v2/tasks?limit=25').set(SA)).body.items as TaskView[]).find(
      (t) => t.id === c.taskIds[1],
    )!;
    expect(allRow.overdue).toBe(false);
    expect(allRow.tatHours).toBe(48);

    // completing the overdue task clears it (terminal tasks are never out of TAT)
    await db!.pool.query(`UPDATE case_tasks SET status = 'COMPLETED' WHERE id = $1`, [c.taskIds[0]]);
    expect((await request(app).get('/api/v2/tasks/stats').set(SA)).body.overdue).toBe(0);
  });

  it('task-create accepts tatHours (override) and otherwise defaults from priority (ADR-0044 mapping)', async () => {
    const ctx = await seedCpv('CRTAT');
    const caseId = seeded<{ id: string }>(
      await request(app)
        .post('/api/v2/cases')
        .set(SA)
        .send({
          clientId: ctx.clientId,
          productId: ctx.productId,
          backendContactNumber: '9876543210',
          applicants: [{ name: 'CRTAT APP' }],
          dedupeDecision: 'NO_DUPLICATES_FOUND',
        }),
    ).id;
    const applicantId = seeded<{ applicants: { id: string }[] }>(
      await request(app).get(`/api/v2/cases/${caseId}`).set(SA),
    ).applicants[0]!.id;
    const created = seeded<{ id: string; verificationUnitId: number }[]>(
      await request(app)
        .post(`/api/v2/cases/${caseId}/tasks`)
        .set(SA)
        .send({
          tasks: [
            { verificationUnitId: ctx.unitAId, applicantId, address: '12 MG ROAD', tatHours: 6 }, // explicit override
            { verificationUnitId: ctx.unitBId, applicantId, address: '12 MG ROAD', priority: 'URGENT' }, // default URGENT→4
          ],
        }),
    );
    const tA = created.find((t) => t.verificationUnitId === ctx.unitAId)!.id;
    const tB = created.find((t) => t.verificationUnitId === ctx.unitBId)!.id;
    const rows = await db!.pool.query<{ id: string; tat_hours: number }>(
      `SELECT id, tat_hours FROM case_tasks WHERE id = ANY($1::uuid[])`,
      [[tA, tB]],
    );
    const byId = new Map(rows.rows.map((r) => [r.id, r.tat_hours]));
    expect(byId.get(tA)).toBe(6); // explicit tatHours wins
    expect(byId.get(tB)).toBe(4); // URGENT → 4h default (ADR-0044 mapping)
  });

  // ── Assignment workbench (slice 2): intersection pool + bulk assign ──
  describe('assignable-users + bulk-assign', () => {
    it('pool follows the visit type + FIELD territory intersection across tasks (ADR-0024)', async () => {
      const ctx = await seedCpv('INT');
      const mkLoc = async (pincode: string, area: string): Promise<number> =>
        (
          await db!.pool.query<{ id: number }>(
            `INSERT INTO locations (pincode, area, city, state, country)
             VALUES ($1, $2, 'Bengaluru', 'Karnataka', 'India') RETURNING id`,
            [pincode, area],
          )
        ).rows[0]!.id;
      const locA = await mkLoc('560001', 'Area INT A');
      const locB = await mkLoc('560002', 'Area INT B');
      // one case, two FIELD tasks in DIFFERENT locations (per-task territory, ADR-0024)
      const caseId = seeded<{ id: string }>(
        await request(app)
          .post('/api/v2/cases')
          .set(SA)
          .send({
            clientId: ctx.clientId,
            productId: ctx.productId,
            backendContactNumber: '9876543210',
            applicants: [{ name: 'INT APP' }],
            dedupeDecision: 'NO_DUPLICATES_FOUND',
          }),
      ).id;
      const applicantId = (await request(app).get(`/api/v2/cases/${caseId}`).set(SA)).body.applicants[0]
        .id as string;
      const tasks = seeded<{ id: string }[]>(
        await request(app)
          .post(`/api/v2/cases/${caseId}/tasks`)
          .set(SA)
          .send({
            tasks: [
              {
                verificationUnitId: ctx.unitAId,
                applicantId,
                address: '12 MG ROAD',
                pincodeId: locA,
                areaId: locA,
              },
              {
                verificationUnitId: ctx.unitBId,
                applicantId,
                address: '12 MG ROAD',
                pincodeId: locB,
                areaId: locB,
              },
            ],
          }),
      );
      const tA = tasks[0]!.id;
      const tB = tasks[1]!.id;
      const faBoth = await createUser({ username: 'int_both', name: 'INT BOTH', role: 'FIELD_AGENT' });
      const faA = await createUser({ username: 'int_a', name: 'INT A', role: 'FIELD_AGENT' });
      const kyc = await createUser({ username: 'int_kyc', name: 'INT KYC', role: 'KYC_VERIFIER' });
      const giveArea = async (uid: string, ids: number[]) =>
        seeded(
          await request(app)
            .post(`/api/v2/users/${uid}/scope-assignments`)
            .set(SA)
            .send({ dimension: 'AREA', entityIds: ids }),
        );
      await giveArea(faBoth, [locA, locB]);
      await giveArea(faA, [locA]);
      const idsOf = (r: request.Response): string[] => (r.body as { id: string }[]).map((u) => u.id);

      // FIELD pool across BOTH tasks → only the agent covering EVERY task's location.
      const both = await request(app)
        .get(`/api/v2/tasks/assignable-users?taskIds=${tA},${tB}&visitType=FIELD`)
        .set(SA);
      expect(both.status).toBe(200);
      expect(idsOf(both)).toContain(faBoth);
      expect(idsOf(both)).not.toContain(faA); // covers locA only
      // task A alone → both covering agents; never the wrong-pool KYC user.
      const onlyA = await request(app)
        .get(`/api/v2/tasks/assignable-users?taskIds=${tA}&visitType=FIELD`)
        .set(SA);
      expect(idsOf(onlyA)).toEqual(expect.arrayContaining([faBoth, faA]));
      expect(idsOf(onlyA)).not.toContain(kyc);
      // OFFICE pool → the KYC desk verifier, no field agents, no territory needed.
      const office = await request(app)
        .get(`/api/v2/tasks/assignable-users?taskIds=${tA},${tB}&visitType=OFFICE`)
        .set(SA);
      expect(idsOf(office)).toContain(kyc);
      expect(idsOf(office)).not.toContain(faBoth);
      // an unknown/foreign id in the list → 404 (visibility ≡ existence)
      const ghost = await request(app)
        .get(
          `/api/v2/tasks/assignable-users?taskIds=${tA},00000000-0000-0000-0000-00000000dead&visitType=FIELD`,
        )
        .set(SA);
      expect(ghost.status).toBe(404);
    });

    it('bulk-assign: per-row OK / CONFLICT / NOT_ASSIGNABLE / NOT_FOUND outcomes + history rows', async () => {
      const ctx = await seedCpv('BLK');
      const c1 = await seedCaseTasks(ctx, { name: 'BLK ONE', unitIds: [ctx.unitAId] });
      const c2 = await seedCaseTasks(ctx, { name: 'BLK TWO', unitIds: [ctx.unitAId] });
      const c3 = await seedCaseTasks(ctx, { name: 'BLK THREE', unitIds: [ctx.unitAId] });
      const fa = await createUser({ username: 'blk_fa', name: 'BLK FA', role: 'FIELD_AGENT' });
      await db!.pool.query(`UPDATE case_tasks SET status = 'COMPLETED' WHERE id = $1`, [c3.taskIds[0]]);

      const res = await request(app)
        .post('/api/v2/tasks/bulk-assign')
        .set(SA)
        .send({
          items: [
            { id: c1.taskIds[0], version: 1 }, // OK
            { id: c2.taskIds[0], version: 99 }, // CONFLICT (stale)
            { id: c3.taskIds[0], version: 1 }, // NOT_ASSIGNABLE (COMPLETED)
            { id: '00000000-0000-0000-0000-00000000dead', version: 1 }, // NOT_FOUND
          ],
          assignedTo: fa,
          visitType: 'FIELD',
          distanceBand: 'LOCAL',
          billCount: 1,
        });
      expect(res.status).toBe(200);
      const byId = new Map(
        (res.body.results as { id: string; status: string }[]).map((r) => [r.id, r.status]),
      );
      expect(byId.get(c1.taskIds[0]!)).toBe('OK');
      expect(byId.get(c2.taskIds[0]!)).toBe('CONFLICT');
      expect(byId.get(c3.taskIds[0]!)).toBe('NOT_ASSIGNABLE');
      expect(byId.get('00000000-0000-0000-0000-00000000dead')).toBe('NOT_FOUND');
      expect(res.body).toMatchObject({
        okCount: 1,
        conflictCount: 1,
        notAssignableCount: 1,
        notFoundCount: 1,
        ineligibleCount: 0,
      });
      // the OK row was really assigned + history written; the CONFLICT row untouched
      const { rows } = await db!.pool.query<{ status: string; assigned_to: string | null }>(
        `SELECT status, assigned_to FROM case_tasks WHERE id = $1`,
        [c1.taskIds[0]],
      );
      expect(rows[0]).toMatchObject({ status: 'ASSIGNED', assigned_to: fa });
      const hist = await db!.pool.query(
        `SELECT 1 FROM task_assignment_history WHERE task_id = $1 AND action = 'ASSIGNED'`,
        [c1.taskIds[0]],
      );
      expect(hist.rowCount).toBe(1);
    });

    it('bulk-assign reports INELIGIBLE_ASSIGNEE (wrong visit-type pool) and gates on case.assign (403)', async () => {
      const ctx = await seedCpv('BLI');
      const c = await seedCaseTasks(ctx, { name: 'BLI APP', unitIds: [ctx.unitAId] });
      const kyc = await createUser({ username: 'bli_kyc', name: 'BLI KYC', role: 'KYC_VERIFIER' });
      // FIELD pool is FIELD_AGENT only — a KYC verifier is ineligible (ADR-0024). (Under OFFICE the
      // same user would be eligible — the pool follows the visit type, not the unit's worker_role.)
      const res = await request(app)
        .post('/api/v2/tasks/bulk-assign')
        .set(SA)
        .send({
          items: [{ id: c.taskIds[0], version: 1 }],
          assignedTo: kyc,
          visitType: 'FIELD',
          distanceBand: 'LOCAL',
          billCount: 1,
        });
      expect(res.status).toBe(200);
      expect(res.body.ineligibleCount).toBe(1);
      expect(res.body.results[0].status).toBe('INELIGIBLE_ASSIGNEE');

      const denied = await request(app)
        .post('/api/v2/tasks/bulk-assign')
        .set(FA)
        .send({
          items: [{ id: c.taskIds[0], version: 1 }],
          assignedTo: kyc,
          visitType: 'FIELD',
          distanceBand: 'LOCAL',
          billCount: 1,
        });
      expect(denied.status).toBe(403);
    });
  });

  describe('export (B-13)', () => {
    it('current view → CSV with the manifest headers; FIELD_AGENT (no data.export) → 403', async () => {
      const ctx = await seedCpv('EX');
      await seedCaseTasks(ctx, { name: 'EX APP', unitIds: [ctx.unitAId] });
      const res = await request(app).get('/api/v2/tasks/export?format=csv&mode=current').set(SA);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/csv');
      const header = (res.text as string).split(/\r?\n/)[0];
      expect(header).toBe(
        'Case,Task,Client,Applicant,Unit,Kind,Status,Assignee,Bill Count,Bill Amount,Commission,Assigned At,Created,Updated',
      );
      expect(res.text).toContain('EX APP');
      const denied = await request(app).get('/api/v2/tasks/export?format=csv&mode=current').set(FA);
      expect(denied.status).toBe(403);
    });

    it('selected mode with empty/invalid ids exports NOTHING (never falls through to all)', async () => {
      const ctx = await seedCpv('EXS');
      const c = await seedCaseTasks(ctx, { name: 'EXS APP', unitIds: [ctx.unitAId, ctx.unitBId] });
      const none = await request(app)
        .get('/api/v2/tasks/export?format=csv&mode=selected&ids=not-a-uuid')
        .set(SA);
      expect(none.status).toBe(200);
      expect((none.text as string).trim().split('\n')).toHaveLength(1); // header only
      const one = await request(app)
        .get(`/api/v2/tasks/export?format=csv&mode=selected&ids=${c.taskIds[0]}`)
        .set(SA);
      expect((one.text as string).trim().split('\n')).toHaveLength(2);
    });

    it('export honors the assignedTo filter (export ≡ the filtered list — B-13)', async () => {
      const ctx = await seedCpv('EXA');
      const a = await seedCaseTasks(ctx, { name: 'EXA ONE', unitIds: [ctx.unitAId] });
      await seedCaseTasks(ctx, { name: 'EXA TWO', unitIds: [ctx.unitBId] }); // unassigned
      const agent = await createUser({ username: 'fa_exa', name: 'FA EXA', role: 'FIELD_AGENT' });
      expect((await assign(a.caseId, a.taskIds[0]!, agent)).status).toBe(200);
      // export filtered to the agent → only their one task (not the unassigned sibling)
      const res = await request(app)
        .get(`/api/v2/tasks/export?format=csv&mode=all&assignedTo=${agent}`)
        .set(SA);
      expect(res.status).toBe(200);
      const lines = (res.text as string).trim().split(/\r?\n/);
      expect(lines).toHaveLength(2); // header + the assigned task only
      expect(res.text).toContain('EXA ONE');
      expect(res.text).not.toContain('EXA TWO');
    });

    it('export honors the actor scope — a portfolio user exports only their clients’ tasks', async () => {
      const ctxA = await seedCpv('EXSA');
      const ctxB = await seedCpv('EXSB');
      await seedCaseTasks(ctxA, { name: 'EXSC A', unitIds: [ctxA.unitAId] });
      await seedCaseTasks(ctxB, { name: 'EXSC B', unitIds: [ctxB.unitAId] });
      // BACKEND_USER scope = CLIENT EXPAND capped by PRODUCT RESTRICT — a full client+product portfolio.
      const be = await createUser({ username: 'tex_be', name: 'TEX BE', role: 'BACKEND_USER' });
      seeded(
        await request(app)
          .post(`/api/v2/users/${be}/scope-assignments`)
          .set(SA)
          .send({ dimension: 'CLIENT', entityIds: [ctxA.clientId] }),
      );
      seeded(
        await request(app)
          .post(`/api/v2/users/${be}/scope-assignments`)
          .set(SA)
          .send({ dimension: 'PRODUCT', entityIds: [ctxA.productId] }),
      );
      const res = await request(app)
        .get('/api/v2/tasks/export?format=csv&mode=all')
        .set(hdr('BACKEND_USER', be));
      expect(res.status).toBe(200);
      const lines = (res.text as string).trim().split('\n');
      expect(lines).toHaveLength(2); // header + the client-A task only
      expect(res.text).toContain('EXSC A');
      expect(res.text).not.toContain('EXSC B');
    });
  });

  // ADR-0036 slice 5d — billing VIEW on the Pipeline: derived per-task bill/commission amounts,
  // a `billable` flag (=COMPLETED), and the Commissionable bucket. Reuses the shared billing laterals.
  describe('billing view (5d)', () => {
    const seedCommission = (userId: string, amount: number) =>
      request(app).post('/api/v2/commission-rates').set(SA).send({ userId, rateType: 'LOCAL', amount });
    async function complete(caseId: string, taskId: string, fa: string) {
      expect((await assign(caseId, taskId, fa)).status).toBe(200);
      expect(
        (await request(app).post(`/api/v2/verification-tasks/${taskId}/start`).set(hdr('FIELD_AGENT', fa)))
          .status,
      ).toBe(200);
      // ADR-0047: device submits → SUBMITTED; the office records the result → COMPLETED (billable)
      const submit = await request(app)
        .post(`/api/v2/verification-tasks/${taskId}/complete`)
        .set(hdr('FIELD_AGENT', fa));
      expect(submit.status).toBe(200);
      expect(
        (
          await request(app)
            .post(`/api/v2/cases/${caseId}/tasks/${taskId}/complete`)
            .set(SA)
            .send({ result: 'POSITIVE', remark: 'office verified', version: submit.body.version })
        ).status,
      ).toBe(200);
    }

    it('a completed task exposes billable + derived bill/commission amounts; a pending sibling does not bill', async () => {
      const ctx = await seedCpv('5DA');
      const fa = await createUser({ username: 'fa_5da', name: 'FA 5DA', role: 'FIELD_AGENT' });
      seeded(
        await request(app).post('/api/v2/rates').set(SA).send({
          clientId: ctx.clientId,
          productId: ctx.productId,
          verificationUnitId: ctx.unitAId,
          rateType: 'LOCAL',
          amount: 150,
        }),
      );
      expect((await seedCommission(fa, 40)).status).toBe(201);
      const c = await seedCaseTasks(ctx, { name: '5DA APP', unitIds: [ctx.unitAId, ctx.unitBId] });
      await complete(c.caseId, c.taskIds[0]!, fa); // unit A completed; unit B left PENDING

      const items = (await request(app).get('/api/v2/tasks?limit=25').set(SA)).body.items as TaskView[];
      const done = items.find((t) => t.status === 'COMPLETED')!;
      const pending = items.find((t) => t.status === 'PENDING')!;
      expect(done.billable).toBe(true);
      expect(done.billAmount).toBe(150);
      expect(done.commissionAmount).toBe(40);
      expect(pending.billable).toBe(false); // only completed tasks bill
    });

    it('Commissionable bucket: counts + filters completed tasks with a resolved commission; a completed task with no commission is excluded but still bills', async () => {
      const ctx = await seedCpv('5DB');
      const paid = await createUser({ username: 'fa_paid', name: 'FA PAID', role: 'FIELD_AGENT' });
      const unpaid = await createUser({ username: 'fa_unpaid', name: 'FA UNPAID', role: 'FIELD_AGENT' });
      seeded(
        await request(app).post('/api/v2/rates').set(SA).send({
          clientId: ctx.clientId,
          productId: ctx.productId,
          verificationUnitId: ctx.unitAId,
          rateType: 'LOCAL',
          amount: 100,
        }),
      );
      seeded(
        await request(app).post('/api/v2/rates').set(SA).send({
          clientId: ctx.clientId,
          productId: ctx.productId,
          verificationUnitId: ctx.unitBId,
          rateType: 'LOCAL',
          amount: 100,
        }),
      );
      expect((await seedCommission(paid, 25)).status).toBe(201); // only `paid` has a commission rate
      const a = await seedCaseTasks(ctx, { name: '5DB PAID', unitIds: [ctx.unitAId] });
      const b = await seedCaseTasks(ctx, { name: '5DB UNPAID', unitIds: [ctx.unitBId] });
      await complete(a.caseId, a.taskIds[0]!, paid);
      await complete(b.caseId, b.taskIds[0]!, unpaid);

      const stats = (await request(app).get('/api/v2/tasks/stats').set(SA)).body as TaskStats;
      expect(stats.completed).toBe(2);
      expect(stats.commissionable).toBe(1); // only the `paid` task

      const commItems = (await request(app).get('/api/v2/tasks?commissionable=1&limit=25').set(SA)).body
        .items as TaskView[];
      expect(commItems).toHaveLength(1);
      expect(commItems[0]!.commissionAmount).toBe(25);

      // the unpaid task still bills (eligibility = ANY completed task), commission just null
      const unpaidRow = (
        (await request(app).get('/api/v2/tasks?status=COMPLETED&limit=25').set(SA)).body.items as TaskView[]
      ).find((t) => t.assignedTo === unpaid)!;
      expect(unpaidRow.billable).toBe(true);
      expect(unpaidRow.billAmount).toBe(100);
      expect(unpaidRow.commissionAmount).toBeNull();
    });

    it('₹ amounts are billing.view-gated: a case.view-only role sees billable but null amounts + a 0 commissionable bucket', async () => {
      const ctx = await seedCpv('5DG');
      const fa = await createUser({ username: 'fa_5dg', name: 'FA 5DG', role: 'FIELD_AGENT' });
      seeded(
        await request(app).post('/api/v2/rates').set(SA).send({
          clientId: ctx.clientId,
          productId: ctx.productId,
          verificationUnitId: ctx.unitAId,
          rateType: 'LOCAL',
          amount: 150,
        }),
      );
      expect((await seedCommission(fa, 40)).status).toBe(201);
      const c = await seedCaseTasks(ctx, { name: '5DG APP', unitIds: [ctx.unitAId] });
      await complete(c.caseId, c.taskIds[0]!, fa);

      // SA (grants_all) sees the comp amounts...
      const saRow = (
        (await request(app).get('/api/v2/tasks?status=COMPLETED&limit=25').set(SA)).body.items as TaskView[]
      )[0]!;
      expect(saRow.commissionAmount).toBe(40);
      // ...but the FIELD_AGENT (case.view, NOT billing.view) sees billable yet NULL ₹ amounts.
      const faHdr = hdr('FIELD_AGENT', fa);
      const faRow = (
        (await request(app).get('/api/v2/tasks?status=COMPLETED&limit=25').set(faHdr)).body
          .items as TaskView[]
      )[0]!;
      expect(faRow.billable).toBe(true);
      expect(faRow.billAmount).toBeNull();
      expect(faRow.commissionAmount).toBeNull();
      // and the Commissionable bucket is 0 for them (the count is comp data too).
      const faStats = (await request(app).get('/api/v2/tasks/stats').set(faHdr)).body as TaskStats;
      expect(faStats.commissionable).toBe(0);
    });
  });
});
