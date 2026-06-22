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

const RUN = !!process.env['DATABASE_URL'];
const db = RUN ? createTestDb() : null;
const app = createApp({ enableTestAuth: true });
const SA = authHeaderForRole('SUPER_ADMIN');
const BC = '9876543210';
// A day ago — CPV seeded with this effective_from is already-effective, so the immediate
// `effective_from <= now()` enablement gate can't race the clock (see seedCpvUnit).
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

/** Create an unlocated case with one task (custom trigger/priority), return ids + caseNumber. */
async function seedTask(
  ctx: { clientId: number; productId: number; unitId: number },
  o: {
    name: string;
    trigger: string;
    priority?: string;
    company?: string;
    latitude?: number;
    longitude?: number;
  },
): Promise<{ caseId: string; caseNumber: string; taskId: string }> {
  const created = seeded<{ id: string; caseNumber: string }>(
    await request(app)
      .post('/api/v2/cases')
      .set(SA)
      .send({
        clientId: ctx.clientId,
        productId: ctx.productId,
        backendContactNumber: BC,
        applicants: [
          { name: o.name, mobile: '9000012345', ...(o.company ? { companyName: o.company } : {}) },
        ],
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
        tasks: [
          {
            verificationUnitId: ctx.unitId,
            applicantId,
            address: '12 MG ROAD',
            ...(o.latitude !== undefined ? { latitude: o.latitude } : {}),
            ...(o.longitude !== undefined ? { longitude: o.longitude } : {}),
            trigger: o.trigger,
            ...(o.priority ? { priority: o.priority } : {}),
          },
        ],
      }),
  );
  return { caseId: created.id, caseNumber: created.caseNumber, taskId: tasks[0]!.id };
}

const assign = (caseId: string, taskId: string, assignedTo: string) =>
  request(app)
    .post(`/api/v2/cases/${caseId}/tasks/${taskId}/assign`)
    .set(SA)
    .send({ assignedTo, visitType: 'FIELD', fieldRateType: 'LOCAL', billCount: 1, version: 1 });

describe.skipIf(!RUN)('sync API (mobile down-sync)', () => {
  beforeAll(async () => {
    await db!.migrate();
    setPool(db!.pool);
  });
  afterAll(async () => {
    await db!.end();
  });
  beforeEach(async () => {
    await db!.truncate(
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

  it('serves the device user their assigned task in the v2-native bare body', async () => {
    const ctx = await seedCpvUnit('ENV');
    const fa = await createUser({ username: 'fa_sync', name: 'FIELD SYNC', role: 'FIELD_AGENT' });
    const t = await seedTask(ctx, {
      name: 'RAMESH SYNC',
      trigger: 'VERIFY RESIDENCE — ref 99',
      priority: 'HIGH',
    });
    expect((await assign(t.caseId, t.taskId, fa)).status).toBe(200);

    const res = await request(app).get('/api/v2/sync/download').set(hdr('FIELD_AGENT', fa));
    expect(res.status).toBe(200);
    // v2-native: the body IS the bare { tasks, revokedAssignmentIds, syncTimestamp, hasMore, nextCursor }
    const d = res.body;
    expect(d.success).toBeUndefined(); // no v1 { success, message, data } wrapper
    expect(d.data).toBeUndefined();
    expect(d.tasks).toHaveLength(1);
    expect(d.revokedAssignmentIds).toEqual([]);
    expect(typeof d.syncTimestamp).toBe('string');
    expect(d.hasMore).toBe(false);
    expect(d.nextCursor).toBeNull();

    const task = d.tasks[0];
    expect(task.id).toBe(t.taskId);
    expect(task.taskNumber).toBe(`${t.caseNumber}-1`);
    expect(task.caseId).toBe(t.caseId); // v2-native: the case UUID
    expect(task.caseId).not.toBe(t.caseNumber); // NOT the case number anymore
    expect(task.caseNumber).toBe(t.caseNumber);
    expect(task.customerName).toBe('RAMESH SYNC'); // derived from the targeted applicant
    expect(task.customerPhone).toBe('9000012345');
    expect(task.customerCallingCode).toMatch(/^CC-/);
    expect(task.address).toBe('12 MG ROAD');
    expect(task.addressPincode).toBe('');
    expect(task.notes).toBe('VERIFY RESIDENCE — REF 99'); // trigger → notes (uppercased display field, ADR-0058)
    expect(task.priority).toBe('HIGH');
    expect(task.status).toBe('ASSIGNED');
    expect(task.applicantType).toBe('APPLICANT');
    expect(task.backendContactNumber).toBe(BC);
    expect(task.assignedToFieldUser).toBe('FIELD SYNC');
    expect(task.client.name).toBeTruthy();
    expect(task.verificationUnit).toEqual({
      id: ctx.unitId,
      name: expect.any(String),
      code: expect.any(String),
    });
    expect(task.attachmentCount).toBe(0);
    expect(task.companyName).toBeUndefined(); // omitted when the applicant has no company

    // dropped v1 aliases/phantoms are ABSENT
    expect(task.verificationTaskId).toBeUndefined();
    expect(task.verificationTaskNumber).toBeUndefined();
    expect(task.title).toBeUndefined();
    expect(task.description).toBeUndefined();
    expect(task.addressStreet).toBeUndefined();
    expect(task.addressCity).toBeUndefined();
    expect(task.addressState).toBeUndefined();
    expect(task.isSaved).toBeUndefined();
    expect(task.savedAt).toBeUndefined();
    expect(task.syncStatus).toBeUndefined();
    expect(task.attachments).toBeUndefined();
    expect(task.verificationType).toBeUndefined();
    expect(task.verificationTypeDetails).toBeUndefined();
  });

  it('emits the applicant company_name additively when present (omitted otherwise)', async () => {
    const ctx = await seedCpvUnit('CMP');
    const fa = await createUser({ username: 'fa_cmp', name: 'FA CMP', role: 'FIELD_AGENT' });
    const t = await seedTask(ctx, { name: 'BIZ APP', trigger: 'x', company: 'ACME INDUSTRIES' });
    expect((await assign(t.caseId, t.taskId, fa)).status).toBe(200);

    const res = await request(app).get('/api/v2/sync/download').set(hdr('FIELD_AGENT', fa));
    expect(res.body.tasks[0].companyName).toBe('ACME INDUSTRIES');
  });

  it('emits the task dispatch coordinates (latitude/longitude) as numbers when set, omitted otherwise', async () => {
    const ctx = await seedCpvUnit('GEO');
    const fa = await createUser({ username: 'fa_geo', name: 'FA GEO', role: 'FIELD_AGENT' });
    const t = await seedTask(ctx, { name: 'GEO APP', trigger: 'x', latitude: 19.076, longitude: 72.8777 });
    expect((await assign(t.caseId, t.taskId, fa)).status).toBe(200);

    const res = await request(app).get('/api/v2/sync/download').set(hdr('FIELD_AGENT', fa));
    const task = res.body.tasks[0];
    expect(typeof task.latitude).toBe('number'); // pg numeric → string → coerced to number
    expect(task.latitude).toBe(19.076);
    expect(task.longitude).toBe(72.8777);

    // a task without coordinates omits them (not null)
    const t2 = await seedTask(ctx, { name: 'NO GEO', trigger: 'x' });
    expect((await assign(t2.caseId, t2.taskId, fa)).status).toBe(200);
    const res2 = await request(app).get('/api/v2/sync/download').set(hdr('FIELD_AGENT', fa));
    const noGeo = res2.body.tasks.find((c: { id: string }) => c.id === t2.taskId);
    expect(noGeo.latitude).toBeUndefined();
  });

  it('reports attachmentCount = the task’s reference docs (case-level + this task), excluding deleted', async () => {
    const ctx = await seedCpvUnit('ATT');
    const fa = await createUser({ username: 'fa_att', name: 'FA ATT', role: 'FIELD_AGENT' });
    const t = await seedTask(ctx, { name: 'ATT APP', trigger: 'x' });
    expect((await assign(t.caseId, t.taskId, fa)).status).toBe(200);
    const ins = (taskId: string | null, deleted: boolean) =>
      db!.pool.query(
        `INSERT INTO case_attachments
           (case_id, task_id, original_name, mime_type, file_size, storage_key, sha256, uploaded_by, deleted_at)
         VALUES ($1, $2, 'd.pdf', 'application/pdf', 1, 'k', 'h', $3, ${deleted ? 'now()' : 'NULL'})`,
        [t.caseId, taskId, fa],
      );
    await ins(null, false); // case-level → counts
    await ins(t.taskId, false); // this task → counts
    await ins(t.taskId, true); // soft-deleted → excluded
    const res = await request(app).get('/api/v2/sync/download').set(hdr('FIELD_AGENT', fa));
    expect(res.body.tasks[0].attachmentCount).toBe(2);
  });

  it('a device only sees its OWN assigned tasks, never another agent’s (assignment is the scope)', async () => {
    const ctx = await seedCpvUnit('OWN');
    const fa1 = await createUser({ username: 'fa_own1', name: 'FA ONE', role: 'FIELD_AGENT' });
    const fa2 = await createUser({ username: 'fa_own2', name: 'FA TWO', role: 'FIELD_AGENT' });
    const t = await seedTask(ctx, { name: 'OWNED', trigger: 'x' });
    expect((await assign(t.caseId, t.taskId, fa1)).status).toBe(200);

    const seenBy1 = await request(app).get('/api/v2/sync/download').set(hdr('FIELD_AGENT', fa1));
    const seenBy2 = await request(app).get('/api/v2/sync/download').set(hdr('FIELD_AGENT', fa2));
    expect(seenBy1.body.tasks).toHaveLength(1);
    expect(seenBy2.body.tasks).toHaveLength(0); // fa2 was never assigned → never synced
  });

  it('the watermark filters out tasks unchanged since lastSyncTimestamp', async () => {
    const ctx = await seedCpvUnit('WM');
    const fa = await createUser({ username: 'fa_wm', name: 'FA WM', role: 'FIELD_AGENT' });
    const t = await seedTask(ctx, { name: 'WM APP', trigger: 'x' });
    expect((await assign(t.caseId, t.taskId, fa)).status).toBe(200);

    const future = new Date(Date.now() + 60_000).toISOString();
    const res = await request(app)
      .get(`/api/v2/sync/download?lastSyncTimestamp=${encodeURIComponent(future)}`)
      .set(hdr('FIELD_AGENT', fa));
    expect(res.body.tasks).toHaveLength(0); // nothing changed after a future watermark
  });

  it('paginates with limit / offset → hasMore + nextCursor', async () => {
    const ctx = await seedCpvUnit('PG');
    const fa = await createUser({ username: 'fa_pg', name: 'FA PG', role: 'FIELD_AGENT' });
    const t1 = await seedTask(ctx, { name: 'PG ONE', trigger: 'a' });
    const t2 = await seedTask(ctx, { name: 'PG TWO', trigger: 'b' });
    expect((await assign(t1.caseId, t1.taskId, fa)).status).toBe(200);
    expect((await assign(t2.caseId, t2.taskId, fa)).status).toBe(200);

    const page1 = await request(app)
      .get('/api/v2/sync/download?limit=1&offset=0')
      .set(hdr('FIELD_AGENT', fa));
    expect(page1.body.tasks).toHaveLength(1);
    expect(page1.body.hasMore).toBe(true);
    expect(page1.body.nextCursor).toBe('1');

    const page2 = await request(app)
      .get('/api/v2/sync/download?limit=1&offset=1')
      .set(hdr('FIELD_AGENT', fa));
    expect(page2.body.tasks).toHaveLength(1);
    expect(page2.body.hasMore).toBe(false);
    expect(page2.body.nextCursor).toBeNull();
    // the two pages are different tasks
    expect(page1.body.tasks[0].id).not.toBe(page2.body.tasks[0].id);
  });

  it('rejects a malformed lastSyncTimestamp with 400 (not a 500)', async () => {
    const fa = await createUser({ username: 'fa_bad', name: 'FA BAD', role: 'FIELD_AGENT' });
    const res = await request(app)
      .get('/api/v2/sync/download?lastSyncTimestamp=not-a-date')
      .set(hdr('FIELD_AGENT', fa));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_TIMESTAMP');
  });

  it('requires authentication (401 unauth)', async () => {
    expect((await request(app).get('/api/v2/sync/download')).status).toBe(401);
  });

  // ─── slice 2c-2 tail (ADR-0035): delta arrays + execution fields ───

  it('puts a reassigned-away task in revokedAssignmentIds for the old assignee (and it leaves their cases)', async () => {
    const ctx = await seedCpvUnit('RA');
    const fa1 = await createUser({ username: 'fa_ra1', name: 'FA RA1', role: 'FIELD_AGENT' });
    const fa2 = await createUser({ username: 'fa_ra2', name: 'FA RA2', role: 'FIELD_AGENT' });
    const t = await seedTask(ctx, { name: 'RA APP', trigger: 'x' });
    expect((await assign(t.caseId, t.taskId, fa1)).status).toBe(200); // version 1 → 2
    // ADR-0055: single /assign no longer re-points a live task; the in-place reassign-away that produces a
    // purge signal now flows through bulk-assign (still PENDING|ASSIGNED). Reassign away fa1 → fa2 (version
    // is now 2) → REASSIGNED history, previous_assigned_to = fa1.
    const reassign = await request(app)
      .post('/api/v2/tasks/bulk-assign')
      .set(SA)
      .send({
        items: [{ id: t.taskId, version: 2 }],
        assignedTo: fa2,
        visitType: 'FIELD',
        fieldRateType: 'LOCAL',
        billCount: 1,
      });
    expect(reassign.status).toBe(200);
    expect(reassign.body.okCount).toBe(1);

    const seenBy1 = await request(app).get('/api/v2/sync/download').set(hdr('FIELD_AGENT', fa1));
    expect(seenBy1.body.tasks).toEqual([]); // no longer assigned → out of the tasks filter
    expect(seenBy1.body.revokedAssignmentIds).toEqual([t.taskId]); // purge-orphan signal (task UUID)

    const seenBy2 = await request(app).get('/api/v2/sync/download').set(hdr('FIELD_AGENT', fa2));
    expect(seenBy2.body.tasks).toHaveLength(1); // the new assignee now sees it
    expect(seenBy2.body.tasks[0].id).toBe(t.taskId);
    expect(seenBy2.body.revokedAssignmentIds).toEqual([]); // fa2 lost nothing
  });

  it('does NOT purge a revoked-but-still-assigned task — it flows via cases with isRevoked=true', async () => {
    const ctx = await seedCpvUnit('RV');
    const fa = await createUser({ username: 'fa_rv', name: 'FA RV', role: 'FIELD_AGENT' });
    const t = await seedTask(ctx, { name: 'RV APP', trigger: 'x' });
    expect((await assign(t.caseId, t.taskId, fa)).status).toBe(200);
    // device revokes its own assigned task (status → REVOKED, assignee KEPT for lineage)
    const rev = await request(app)
      .post(`/api/v2/verification-tasks/${t.taskId}/revoke`)
      .set(hdr('FIELD_AGENT', fa))
      .send({ reason: 'gate locked' });
    expect(rev.status).toBe(200);

    const res = await request(app).get('/api/v2/sync/download').set(hdr('FIELD_AGENT', fa));
    expect(res.body.revokedAssignmentIds).toEqual([]); // NOT a purge — assignee unchanged
    expect(res.body.tasks).toHaveLength(1);
    const rv = res.body.tasks[0];
    expect(rv.status).toBe('REVOKED');
    expect(rv.isRevoked).toBe(true); // device's keep-the-row cleanup path
    // revoke detail restored (v1 parity) — only on a revoked task
    expect(rv.revokeReason).toBe('gate locked'); // ← case_tasks.remark
    expect(typeof rv.revokedAt).toBe('string'); // ← the revoke write's updated_at
    expect(rv.revokedByName).toBe('FA RV'); // ← who revoked (ct.updated_by)
  });

  it('does NOT leak a reassign-after-revoke replacement task into the revoked agent’s purge list', async () => {
    // A's task is revoked then reassigned-after-revoke to B → the REPLACEMENT task records
    // previous_assigned_to = A. A was never the actual assignee of the replacement, so it must NOT
    // appear in A's revokedAssignmentIds (the EXISTS guard). A's own revoked task stays in A's cases.
    const ctx = await seedCpvUnit('RAR');
    const fa1 = await createUser({ username: 'fa_rar1', name: 'FA RAR1', role: 'FIELD_AGENT' });
    const fa2 = await createUser({ username: 'fa_rar2', name: 'FA RAR2', role: 'FIELD_AGENT' });
    const t = await seedTask(ctx, { name: 'RAR APP', trigger: 'x' });
    expect((await assign(t.caseId, t.taskId, fa1)).status).toBe(200);
    expect(
      (
        await request(app)
          .post(`/api/v2/verification-tasks/${t.taskId}/revoke`)
          .set(hdr('FIELD_AGENT', fa1))
          .send({ reason: 'gate locked' })
      ).status,
    ).toBe(200);
    // office reassigns-after-revoke to fa2 → new replacement task assigned to fa2
    const reassign = await request(app)
      .post(`/api/v2/cases/${t.caseId}/tasks/${t.taskId}/reassign`)
      .set(SA)
      .send({ assignedTo: fa2, visitType: 'FIELD', fieldRateType: 'LOCAL', billCount: 1 });
    expect(reassign.status).toBe(201);
    const replacementId = reassign.body.id as string;

    const seenBy1 = await request(app).get('/api/v2/sync/download').set(hdr('FIELD_AGENT', fa1));
    expect(seenBy1.body.revokedAssignmentIds).toEqual([]); // replacement NOT leaked to fa1
    expect(seenBy1.body.tasks.map((c: { id: string }) => c.id)).toEqual([t.taskId]); // only the revoked one
    const seenBy2 = await request(app).get('/api/v2/sync/download').set(hdr('FIELD_AGENT', fa2));
    expect(seenBy2.body.tasks.map((c: { id: string }) => c.id)).toContain(replacementId);
    expect(seenBy2.body.revokedAssignmentIds).toEqual([]);
  });

  it('emits inProgressAt + submittedAt once the device starts and submits the task', async () => {
    const ctx = await seedCpvUnit('EX');
    const fa = await createUser({ username: 'fa_ex', name: 'FA EX', role: 'FIELD_AGENT' });
    const t = await seedTask(ctx, { name: 'EX APP', trigger: 'x' });
    expect((await assign(t.caseId, t.taskId, fa)).status).toBe(200);

    const beforeStart = await request(app).get('/api/v2/sync/download').set(hdr('FIELD_AGENT', fa));
    expect(beforeStart.body.tasks[0].inProgressAt).toBeUndefined(); // omitted while null
    expect(beforeStart.body.tasks[0].completedAt).toBeUndefined();
    expect(beforeStart.body.tasks[0].submittedAt).toBeUndefined();

    expect(
      (await request(app).post(`/api/v2/verification-tasks/${t.taskId}/start`).set(hdr('FIELD_AGENT', fa)))
        .status,
    ).toBe(200);
    expect(
      (await request(app).post(`/api/v2/verification-tasks/${t.taskId}/complete`).set(hdr('FIELD_AGENT', fa)))
        .status,
    ).toBe(200);

    const after = await request(app).get('/api/v2/sync/download').set(hdr('FIELD_AGENT', fa));
    const task = after.body.tasks[0];
    expect(task.status).toBe('SUBMITTED'); // ADR-0047: the device terminal is SUBMITTED, not COMPLETED
    expect(typeof task.inProgressAt).toBe('string'); // ← started_at
    expect(typeof task.submittedAt).toBe('string'); // ← submitted_at set by the device submit (ADR-0047)
    expect(task.completedAt).toBeUndefined(); // completed_at is set only by the office complete (omitted while null)
    expect(task.formData).toBeUndefined(); // no form submitted on this task → no form_data to echo
  });

  it('echoes the submitted formData (inner keys preserved) + the office verificationOutcome (v1 parity)', async () => {
    const ctx = await seedCpvUnit('FD');
    const fa = await createUser({ username: 'fa_fd', name: 'FA FD', role: 'FIELD_AGENT' });
    const t = await seedTask(ctx, { name: 'FD APP', trigger: 'x' });
    expect((await assign(t.caseId, t.taskId, fa)).status).toBe(200);
    // device submits the residence form → stores form_data[residence] (and completes the task)
    expect(
      (
        await request(app)
          .post(`/api/v2/verification-tasks/${t.taskId}/verification/residence`)
          .set(hdr('FIELD_AGENT', fa))
          .send({ formData: { address_confirmed: true } })
      ).status,
    ).toBe(200);
    // office later records the official result (the device complete leaves it null)
    await db!.pool.query(`UPDATE case_tasks SET verification_outcome = 'POSITIVE' WHERE id = $1`, [t.taskId]);

    const res = await request(app).get('/api/v2/sync/download').set(hdr('FIELD_AGENT', fa));
    const task = res.body.tasks[0];
    expect(task.verificationOutcome).toBe('POSITIVE');
    // the jsonb blob round-trips with inner keys INTACT (shallow camelize) — address_confirmed not mangled
    expect(task.formData.residence.formData.address_confirmed).toBe(true);
  });

  it('serves the v2-native bare body — NOT the v1 envelope, NOT the Paginated list shape', async () => {
    const ctx = await seedCpvUnit('SH');
    const fa = await createUser({ username: 'fa_sh', name: 'FA SH', role: 'FIELD_AGENT' });
    const t = await seedTask(ctx, { name: 'SH APP', trigger: 'x' });
    expect((await assign(t.caseId, t.taskId, fa)).status).toBe(200);

    const res = await request(app).get('/api/v2/sync/download').set(hdr('FIELD_AGENT', fa));
    // top-level IS the bare body — exactly these keys, no v1 wrapper, no v1 delta arrays
    expect(Object.keys(res.body).sort()).toEqual(
      ['hasMore', 'nextCursor', 'revokedAssignmentIds', 'syncTimestamp', 'tasks'].sort(),
    );
    // v1 envelope + v1-only delta arrays are GONE
    expect(res.body.success).toBeUndefined();
    expect(res.body.message).toBeUndefined();
    expect(res.body.data).toBeUndefined();
    expect(res.body.cases).toBeUndefined();
    expect(res.body.changes).toBeUndefined();
    expect(res.body.deletedTaskIds).toBeUndefined();
    expect(res.body.deletedCaseIds).toBeUndefined();
    expect(res.body.conflicts).toBeUndefined();
    expect(res.body.attachmentChanges).toBeUndefined();
    // explicitly NOT the Paginated<T> list envelope either
    expect(res.body.items).toBeUndefined();
    expect(res.body.total).toBeUndefined();
    expect(res.body.page).toBeUndefined();
  });

  it('computes revokedAssignmentIds only on the first page (offset 0)', async () => {
    const ctx = await seedCpvUnit('PGD');
    const fa1 = await createUser({ username: 'fa_pgd1', name: 'FA PGD1', role: 'FIELD_AGENT' });
    const fa2 = await createUser({ username: 'fa_pgd2', name: 'FA PGD2', role: 'FIELD_AGENT' });
    const t = await seedTask(ctx, { name: 'PGD APP', trigger: 'x' });
    expect((await assign(t.caseId, t.taskId, fa1)).status).toBe(200);
    // ADR-0055: reassign-away via bulk-assign (single /assign no longer re-points a live task).
    expect(
      (
        await request(app)
          .post('/api/v2/tasks/bulk-assign')
          .set(SA)
          .send({
            items: [{ id: t.taskId, version: 2 }],
            assignedTo: fa2,
            visitType: 'FIELD',
            fieldRateType: 'LOCAL',
            billCount: 1,
          })
      ).status,
    ).toBe(200);

    const page0 = await request(app).get('/api/v2/sync/download?offset=0').set(hdr('FIELD_AGENT', fa1));
    expect(page0.body.revokedAssignmentIds).toEqual([t.taskId]);
    const page1 = await request(app).get('/api/v2/sync/download?offset=1').set(hdr('FIELD_AGENT', fa1));
    expect(page1.body.revokedAssignmentIds).toEqual([]); // delta is page-0 only
  });
});
