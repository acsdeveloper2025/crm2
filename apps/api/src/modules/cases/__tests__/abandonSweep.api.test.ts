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
import { setPool } from '../../../platform/db.js';
import { AUTO_REVOKE_REASON, SYSTEM_ACTOR_ID, TASK_ABANDONED_DAYS } from '../../../platform/tat/overdue.js';
import { runAbandonSweep } from '../abandonSweep.js';

/**
 * The abandonment sweep (ADR-0095): 45 days after assignment, a task the agent never finished is
 * auto-revoked so the office SEES it and can reassign.
 *
 * Coverage exists because the last rule that shipped without it (the TAT/overdue fix, 2026-07-15) had
 * FOUR hand-typed copies, two of them drifted, and nothing caught it. Every assertion here is about a
 * behaviour the owner asked for or a hazard the design deliberately accepted.
 */
const RUN = !!process.env['DATABASE_URL'];
const db = RUN ? createTestDb() : null;
const app = createApp({ enableTestAuth: true });
const SA = authHeaderForRole('SUPER_ADMIN');
const PAST = new Date(Date.now() - 24 * 3600 * 1000).toISOString();

function seeded<T>(res: request.Response): T {
  if (res.status >= 300) {
    throw new Error(`seed failed ${res.status}: ${JSON.stringify(res.body)}`);
  }
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
  const res = await request(app)
    .post('/api/v2/users')
    .set(SA)
    .send({ email: `${o.username}@test.crm2.local`, ...o });
  return seeded<{ id: string }>(res).id;
}

async function seedTask(
  ctx: { clientId: number; productId: number; unitId: number },
  name: string,
): Promise<{ caseId: string; taskId: string }> {
  const created = seeded<{ id: string }>(
    await request(app)
      .post('/api/v2/cases')
      .set(SA)
      .send({
        clientId: ctx.clientId,
        productId: ctx.productId,
        backendContactNumber: '9876543210',
        dedupeDecision: 'NO_DUPLICATES_FOUND',
        applicants: [{ name, applicantType: 'APPLICANT' }],
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
  return { caseId: created.id, taskId: tasks[0]!.id };
}

const assign = (caseId: string, taskId: string, assignedTo: string) =>
  request(app)
    .post(`/api/v2/cases/${caseId}/tasks/${taskId}/assign`)
    .set(SA)
    .send({ assignedTo, visitType: 'FIELD', fieldRateType: 'LOCAL', billCount: 1, version: 1 });

/** Age a task past the window — the only way to test a 45-day rule without waiting 45 days. */
async function backdateAssignedAt(taskId: string, days: number): Promise<void> {
  await db!.pool.query(`UPDATE case_tasks SET assigned_at = now() - ($2 * interval '1 day') WHERE id = $1`, [
    taskId,
    days,
  ]);
}

const statusOf = async (taskId: string): Promise<string> =>
  (await db!.pool.query<{ status: string }>('SELECT status FROM case_tasks WHERE id = $1', [taskId])).rows[0]!
    .status;

describe.skipIf(!RUN)('abandonment sweep (ADR-0095)', () => {
  beforeAll(async () => {
    await db!.migrate();
    setPool(db!.pool);
  });
  afterAll(async () => {
    await db!.end();
  });
  beforeEach(async () => {
    await db!.truncate(
      'notifications',
      'case_attachments',
      'task_assignment_history',
      'user_scope_assignments',
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

  it("the window IS 45 days — the owner's number, pinned in absolute days", async () => {
    // Relative assertions (TASK_ABANDONED_DAYS ± 1) move with the constant, so they cannot catch the
    // window itself being changed — verified: flipping 45 to 0 left every other test green. These two
    // are absolute on purpose.
    expect(TASK_ABANDONED_DAYS).toBe(45);

    const ctx = await seedCpvUnit('A0');
    const fa = await createUser({ username: 'ab_fa0', name: 'AB FA0', role: 'FIELD_AGENT' });

    const young = await seedTask(ctx, 'DAY 44 APPLICANT');
    expect((await assign(young.caseId, young.taskId, fa)).status).toBe(200);
    await backdateAssignedAt(young.taskId, 44);

    const old = await seedTask(ctx, 'DAY 46 APPLICANT');
    expect((await assign(old.caseId, old.taskId, fa)).status).toBe(200);
    await backdateAssignedAt(old.taskId, 46);

    expect(await runAbandonSweep()).toEqual({ revoked: 1, failed: 0 });
    expect(await statusOf(young.taskId)).toBe('ASSIGNED'); // day 44: still the agent's
    expect(await statusOf(old.taskId)).toBe('REVOKED'); // day 46: taken back
  });

  it('auto-revokes an ASSIGNED task past the window, with the system actor and reason', async () => {
    const ctx = await seedCpvUnit('A1');
    const fa = await createUser({ username: 'ab_fa1', name: 'AB FA1', role: 'FIELD_AGENT' });
    const t = await seedTask(ctx, 'ABANDONED APPLICANT');
    expect((await assign(t.caseId, t.taskId, fa)).status).toBe(200);
    await backdateAssignedAt(t.taskId, TASK_ABANDONED_DAYS + 1);

    const out = await runAbandonSweep();
    expect(out).toEqual({ revoked: 1, failed: 0 });

    const row = (
      await db!.pool.query<{
        status: string;
        remark: string | null;
        updatedBy: string | null;
        revokedAt: Date | null;
        assignedTo: string | null;
      }>(
        `SELECT status, remark, updated_by AS "updatedBy", revoked_at AS "revokedAt",
                assigned_to AS "assignedTo"
           FROM case_tasks WHERE id = $1`,
        [t.taskId],
      )
    ).rows[0]!;

    expect(row.status).toBe('REVOKED');
    expect(row.remark).toBe(AUTO_REVOKE_REASON);
    // A UUID literal, no users row — updated_by is FK-less by design (mig 0010).
    expect(row.updatedBy).toBe(SYSTEM_ACTOR_ID);
    // mig 0119 — without this the first agent's hold is erased from the audit trail.
    expect(row.revokedAt).not.toBeNull();
    // The assignee is KEPT, which is what makes the revoke reach the device: down-sync matches on
    // assigned_to, so clearing it would make the task vanish instead of arriving as REVOKED.
    expect(row.assignedTo).toBe(fa);
  });

  it('auto-revokes an IN_PROGRESS task too (owner: 45d is long enough)', async () => {
    const ctx = await seedCpvUnit('A2');
    const fa = await createUser({ username: 'ab_fa2', name: 'AB FA2', role: 'FIELD_AGENT' });
    const t = await seedTask(ctx, 'IN PROGRESS APPLICANT');
    expect((await assign(t.caseId, t.taskId, fa)).status).toBe(200);
    await db!.pool.query(`UPDATE case_tasks SET status = 'IN_PROGRESS' WHERE id = $1`, [t.taskId]);
    await backdateAssignedAt(t.taskId, TASK_ABANDONED_DAYS + 1);

    expect(await runAbandonSweep()).toEqual({ revoked: 1, failed: 0 });
    expect(await statusOf(t.taskId)).toBe('REVOKED');
  });

  it('leaves a task INSIDE the window alone', async () => {
    const ctx = await seedCpvUnit('A3');
    const fa = await createUser({ username: 'ab_fa3', name: 'AB FA3', role: 'FIELD_AGENT' });
    const t = await seedTask(ctx, 'FRESH APPLICANT');
    expect((await assign(t.caseId, t.taskId, fa)).status).toBe(200);
    await backdateAssignedAt(t.taskId, TASK_ABANDONED_DAYS - 1);

    expect(await runAbandonSweep()).toEqual({ revoked: 0, failed: 0 });
    expect(await statusOf(t.taskId)).toBe('ASSIGNED');
  });

  it('never touches work the agent already delivered, however old', async () => {
    // The whole point of the status filter: SUBMITTED/COMPLETED are the agent's work DONE. Revoking
    // one would destroy a real submission — and its evidence on the device.
    const ctx = await seedCpvUnit('A4');
    const fa = await createUser({ username: 'ab_fa4', name: 'AB FA4', role: 'FIELD_AGENT' });
    for (const status of ['SUBMITTED', 'COMPLETED', 'REVOKED']) {
      const t = await seedTask(ctx, `${status} APPLICANT`);
      expect((await assign(t.caseId, t.taskId, fa)).status).toBe(200);
      await db!.pool.query(`UPDATE case_tasks SET status = $2 WHERE id = $1`, [t.taskId, status]);
      await backdateAssignedAt(t.taskId, TASK_ABANDONED_DAYS + 10);

      expect(await runAbandonSweep()).toEqual({ revoked: 0, failed: 0 });
      expect(await statusOf(t.taskId)).toBe(status);
    }
  });

  it('never touches an UNASSIGNED (PENDING) task, however old', async () => {
    // PENDING has no agent holding it, and revokeTaskInPlace would 409 on it anyway.
    const ctx = await seedCpvUnit('A5');
    const t = await seedTask(ctx, 'PENDING APPLICANT');
    await db!.pool.query(`UPDATE case_tasks SET assigned_at = now() - interval '400 days' WHERE id = $1`, [
      t.taskId,
    ]);

    expect(await runAbandonSweep()).toEqual({ revoked: 0, failed: 0 });
    expect(await statusOf(t.taskId)).toBe('PENDING');
  });

  it('is idempotent — a second sweep finds nothing to do', async () => {
    const ctx = await seedCpvUnit('A6');
    const fa = await createUser({ username: 'ab_fa6', name: 'AB FA6', role: 'FIELD_AGENT' });
    const t = await seedTask(ctx, 'TWICE APPLICANT');
    expect((await assign(t.caseId, t.taskId, fa)).status).toBe(200);
    await backdateAssignedAt(t.taskId, TASK_ABANDONED_DAYS + 1);

    expect(await runAbandonSweep()).toEqual({ revoked: 1, failed: 0 });
    // The REVOKED row is out of the predicate, so it cannot be swept again and re-notified.
    expect(await runAbandonSweep()).toEqual({ revoked: 0, failed: 0 });
  });

  it('tells the OFFICE user who dispatched it — the point of the whole feature', async () => {
    const ctx = await seedCpvUnit('A7');
    const fa = await createUser({ username: 'ab_fa7', name: 'AB FA7', role: 'FIELD_AGENT' });
    const bu = await createUser({ username: 'ab_bu7', name: 'AB BU7', role: 'BACKEND_USER' });
    const t = await seedTask(ctx, 'NOTIFY APPLICANT');
    expect((await assign(t.caseId, t.taskId, fa)).status).toBe(200);

    // Re-point assigned_by at a REAL backend user, which is what prod holds. The SUPER_ADMIN test
    // header assigns as ...0001 — the principal migration 0007 SEEDS — and `beforeEach` truncates
    // `users`, so that row is gone and `notifications.user_id REFERENCES users(id)` (mig 0045:13)
    // would reject the insert. notify() swallows its own failures by design ("a failed notification
    // must NEVER break the task flow"), so the notification would vanish silently and this test would
    // be asserting the wrong thing. The sweep only reads assigned_by, so pointing it at a live row is
    // faithful. (Assigning as BACKEND_USER directly is a 403 — it lacks the permission.)
    await db!.pool.query('UPDATE case_tasks SET assigned_by = $2 WHERE id = $1', [t.taskId, bu]);
    const assignedBy = bu;

    await backdateAssignedAt(t.taskId, TASK_ABANDONED_DAYS + 1);
    expect(await runAbandonSweep()).toEqual({ revoked: 1, failed: 0 });

    // Notifications are produced fire-and-forget; give the producer a tick to land the row.
    await new Promise((r) => setTimeout(r, 200));
    const notes = await db!.pool.query<{ userId: string; type: string }>(
      `SELECT user_id AS "userId", type FROM notifications WHERE type = 'TASK_REVOKED'`,
    );
    const recipients = notes.rows.map((r) => r.userId);
    // The backend user is told: "so backend user understand task auto revoke".
    expect(recipients).toContain(assignedBy);
    // ...and the agent, whose device drops the task on TASK_REVOKED.
    expect(recipients).toContain(fa);
  });

  it('honours the batch cap so the first run cannot stampede', async () => {
    const ctx = await seedCpvUnit('A8');
    const fa = await createUser({ username: 'ab_fa8', name: 'AB FA8', role: 'FIELD_AGENT' });
    for (const n of [1, 2, 3]) {
      const t = await seedTask(ctx, `BATCH APPLICANT ${n}`);
      expect((await assign(t.caseId, t.taskId, fa)).status).toBe(200);
      await backdateAssignedAt(t.taskId, TASK_ABANDONED_DAYS + n);
    }
    // Oldest-first, capped: the backlog drains across ticks instead of one thundering herd.
    expect(await runAbandonSweep(2)).toEqual({ revoked: 2, failed: 0 });
    expect(await runAbandonSweep(2)).toEqual({ revoked: 1, failed: 0 });
    expect(await runAbandonSweep(2)).toEqual({ revoked: 0, failed: 0 });
  });
});
