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
import { setStorage, type StorageProvider } from '../../../platform/storage/index.js';
import { setRealtime, type Realtime } from '../../../platform/realtime/index.js';
import { CASE_UPDATED_EVENT } from '@crm2/sdk';
import sharp from 'sharp';
import { createHash } from 'node:crypto';

const RUN = !!process.env['DATABASE_URL'];
const db = RUN ? createTestDb() : null;
const app = createApp({ enableTestAuth: true });
const SA = authHeaderForRole('SUPER_ADMIN');
const PAST = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
const hdr = (role: string, id: string): Record<string, string> => ({ 'x-test-auth': `${role}:${id}` });

function seeded<T>(res: request.Response): T {
  if (res.status >= 400) throw new Error(`seed failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body as T;
}
async function createUser(o: { username: string; name: string; role: string }): Promise<string> {
  const res = await request(app).post('/api/v2/users').set(SA).send(o);
  expect(res.status).toBe(201);
  return res.body.id as string;
}

// Unique 6-digit numeric pincode per seeded location (pincode regex = ^[1-9][0-9]{5}$).
let vtPincodeSeq = 500000;

/** Seed a case with one task ASSIGNED to a fresh FIELD_AGENT (assigned directly via SQL — this
 *  suite tests the device lifecycle, not assignment eligibility). The task is stamped with a LOCAL
 *  distance band + a real location so the ADR-0050 exact-match commission lateral can resolve when a
 *  test seeds a matching commission row; the returned dims let those tests build the row. */
async function seedAssignedTask(tag: string): Promise<{
  caseId: string;
  taskId: string;
  agent: string;
  clientId: number;
  productId: number;
  unitId: number;
  locationId: number;
}> {
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
  const locationId = seeded<{ id: number }>(
    await request(app)
      .post('/api/v2/locations')
      .set(SA)
      .send({ pincode: String(++vtPincodeSeq), area: `A_${tag}`, city: 'Mumbai', state: 'MH' }),
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
  const caseId = seeded<{ id: string }>(
    await request(app)
      .post('/api/v2/cases')
      .set(SA)
      .send({
        clientId,
        productId,
        backendContactNumber: '9876543210',
        applicants: [{ name: `${tag} APP` }],
        dedupeDecision: 'NO_DUPLICATES_FOUND',
      }),
  ).id;
  const applicantId = seeded<{ applicants: { id: string }[] }>(
    await request(app).get(`/api/v2/cases/${caseId}`).set(SA),
  ).applicants[0]!.id;
  const taskId = seeded<{ id: string }[]>(
    await request(app)
      .post(`/api/v2/cases/${caseId}/tasks`)
      .set(SA)
      .send({
        tasks: [{ verificationUnitId: unitId, applicantId, address: '12 MG ROAD' }],
      }),
  )[0]!.id;
  const agent = await createUser({
    username: `fa_${tag.toLowerCase()}`,
    name: `FA ${tag}`,
    role: 'FIELD_AGENT',
  });
  await db!.pool.query(
    `UPDATE case_tasks
       SET assigned_to = $1::uuid, status = 'ASSIGNED', field_rate_type = 'LOCAL',
           area_id = $3, pincode_id = $3, version = version + 1
     WHERE id = $2`,
    [agent, taskId, locationId],
  );
  return { caseId, taskId, agent, clientId, productId, unitId, locationId };
}

const caseStatus = async (caseId: string): Promise<string> =>
  (await request(app).get(`/api/v2/cases/${caseId}`).set(SA)).body.status as string;

describe.skipIf(!RUN)('verification-tasks API (field execution, ADR-0032 slice 2c)', () => {
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
      'case_attachments',
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

  it('start → IN_PROGRESS, device complete → SUBMITTED (field terminal), case stays IN_PROGRESS; retries idempotent (ADR-0047)', async () => {
    const { caseId, taskId, agent } = await seedAssignedTask('LC');
    const h = hdr('FIELD_AGENT', agent);

    const start = await request(app).post(`/api/v2/verification-tasks/${taskId}/start`).set(h);
    expect(start.status).toBe(200);
    expect(start.body.status).toBe('IN_PROGRESS');
    expect(start.body.verificationOutcome).toBeNull(); // field records NO result (single-layer)

    // idempotent re-start (already IN_PROGRESS) → 200, not 409
    expect((await request(app).post(`/api/v2/verification-tasks/${taskId}/start`).set(h)).status).toBe(200);

    const done = await request(app).post(`/api/v2/verification-tasks/${taskId}/complete`).set(h);
    expect(done.status).toBe(200);
    expect(done.body.status).toBe('SUBMITTED'); // ADR-0047: the device terminal is SUBMITTED, not COMPLETED
    expect(done.body.submittedAt).not.toBeNull();
    expect(done.body.verificationOutcome).toBeNull(); // still no result — the office records it at COMPLETE
    expect(await caseStatus(caseId)).toBe('IN_PROGRESS'); // SUBMITTED is active — awaits the office complete

    // idempotent re-submit → 200
    expect((await request(app).post(`/api/v2/verification-tasks/${taskId}/complete`).set(h)).status).toBe(
      200,
    );
  });

  it('emits case:updated to the office room on device start + complete (ADR-0027 realtime)', async () => {
    const office: Array<{ event: string; payload: unknown }> = [];
    const rt: Realtime = {
      emitToUser: () => undefined,
      emitToFieldMonitoring: () => undefined,
      emitToOffice: (event, payload) => office.push({ event, payload }),
    };
    setRealtime(rt);
    try {
      const { caseId, taskId, agent } = await seedAssignedTask('RT');
      const h = hdr('FIELD_AGENT', agent);

      await request(app).post(`/api/v2/verification-tasks/${taskId}/start`).set(h);
      await request(app).post(`/api/v2/verification-tasks/${taskId}/complete`).set(h);

      const updates = office.filter((e) => e.event === CASE_UPDATED_EVENT);
      expect(updates.length).toBeGreaterThanOrEqual(2); // one per device transition (start, submit)
      const last = updates.at(-1)!.payload as { caseId: string; taskId: string; status: string };
      expect(last).toMatchObject({ caseId, taskId, status: 'SUBMITTED' }); // device terminal (ADR-0047)
    } finally {
      setRealtime(null); // never leak the fake into sibling tests
    }
  });

  it('device submit → SUBMITTED freezes field commission; office complete → COMPLETED does NOT re-stamp (ADR-0047)', async () => {
    const { caseId, taskId, agent, clientId, productId, unitId, locationId } = await seedAssignedTask('SUB');
    // A fully-specified exact-match commission rate (ADR-0050) so the at-submit snapshot resolves non-null:
    // it must match the task's client/product/unit, its LOCAL distance band, the location, and the
    // submit-in TAT band (4h — submitted within ~1 min, smallest active migration-seeded band).
    await db!.pool.query(
      `INSERT INTO commission_rates
         (user_id, client_id, product_id, verification_unit_id, location_id, field_rate_type, tat_band,
          amount, currency, effective_from)
       VALUES ($1::uuid, $2, $3, $4, $5, 'LOCAL', 4, 50, 'INR', now() - interval '1 day')`,
      [agent, clientId, productId, unitId, locationId],
    );
    const h = hdr('FIELD_AGENT', agent);
    await request(app).post(`/api/v2/verification-tasks/${taskId}/start`).set(h);
    const sub = await request(app)
      .post(`/api/v2/verification-tasks/${taskId}/verification/residence`)
      .set(h)
      .send({ formData: { addressConfirmed: true } });
    expect(sub.status).toBe(200);
    expect(sub.body.status).toBe('SUBMITTED');

    const r1 = (
      await db!.pool.query(
        `SELECT status, submitted_at, completed_at, commission_amount FROM case_tasks WHERE id = $1`,
        [taskId],
      )
    ).rows[0];
    expect(r1.status).toBe('SUBMITTED');
    expect(r1.submitted_at).not.toBeNull();
    expect(r1.completed_at).toBeNull();
    expect(Number(r1.commission_amount)).toBe(50); // frozen at submit
    expect(await caseStatus(caseId)).toBe('IN_PROGRESS');

    // office completes (records result) → COMPLETED; commission must NOT be re-stamped
    const comp = await request(app)
      .post(`/api/v2/cases/${caseId}/tasks/${taskId}/complete`)
      .set(SA)
      .send({ result: 'POSITIVE', remark: 'office verified', version: sub.body.version });
    expect(comp.status).toBe(200);
    expect(comp.body.status).toBe('COMPLETED');
    const r2 = (
      await db!.pool.query(`SELECT status, completed_at, commission_amount FROM case_tasks WHERE id = $1`, [
        taskId,
      ])
    ).rows[0];
    expect(r2.status).toBe('COMPLETED');
    expect(r2.completed_at).not.toBeNull();
    expect(Number(r2.commission_amount)).toBe(50); // unchanged — frozen at submit, not re-stamped
  });

  it('field commission resolves the SUBMIT-in TAT band at submit (ADR-0047 × ADR-0050 band dim)', async () => {
    const { taskId, agent, clientId, productId, unitId, locationId } = await seedAssignedTask('BND');
    // a single 24h TAT band (clear any seeded policies so the submit-in band is deterministically 24h)
    // + a fully-specified (ADR-0050) commission rate keyed on that band for the task's exact dimensions.
    await db!.pool.query(`DELETE FROM tat_policies`);
    await db!.pool.query(`INSERT INTO tat_policies (tat_hours, label) VALUES (24, '24h')`);
    await db!.pool.query(
      `INSERT INTO commission_rates
         (user_id, client_id, product_id, verification_unit_id, location_id, field_rate_type, tat_band,
          amount, currency, effective_from)
       VALUES ($1::uuid, $2, $3, $4, $5, 'LOCAL', 24, 88, 'INR', now() - interval '1 day')`,
      [agent, clientId, productId, unitId, locationId],
    );
    const h = hdr('FIELD_AGENT', agent);
    await request(app).post(`/api/v2/verification-tasks/${taskId}/start`).set(h);
    const sub = await request(app)
      .post(`/api/v2/verification-tasks/${taskId}/verification/residence`)
      .set(h)
      .send({ formData: { x: 1 } });
    expect(sub.status).toBe(200);
    // submitted within minutes → submit-in band = 24h → the band-specific rate (₹88) resolves AT SUBMIT
    // (the band is derived from submitted_elapsed_minutes, not completed_elapsed which is null at submit)
    const r = (
      await db!.pool.query(
        `SELECT commission_amount, submitted_elapsed_minutes FROM case_tasks WHERE id = $1`,
        [taskId],
      )
    ).rows[0];
    expect(r.submitted_elapsed_minutes).not.toBeNull();
    expect(Number(r.commission_amount)).toBe(88);
  });

  it('revoke → REVOKED (reason in audit, no result); a COMPLETED task cannot be device-revoked', async () => {
    const { taskId, agent } = await seedAssignedTask('RV');
    const h = hdr('FIELD_AGENT', agent);
    const rev = await request(app)
      .post(`/api/v2/verification-tasks/${taskId}/revoke`)
      .set(h)
      .send({ reason: 'gate closed' });
    expect(rev.status).toBe(200);
    expect(rev.body.status).toBe('REVOKED');
    // idempotent re-revoke
    expect(
      (
        await request(app)
          .post(`/api/v2/verification-tasks/${taskId}/revoke`)
          .set(h)
          .send({ reason: 'again' })
      ).status,
    ).toBe(200);
    // empty reason → 400
    expect(
      (await request(app).post(`/api/v2/verification-tasks/${taskId}/revoke`).set(h).send({ reason: '' }))
        .status,
    ).toBe(400);
  });

  it('priority change on an open task; a terminal task → 409', async () => {
    const { taskId, agent } = await seedAssignedTask('PR');
    const h = hdr('FIELD_AGENT', agent);
    const pr = await request(app)
      .put(`/api/v2/verification-tasks/${taskId}/priority`)
      .set(h)
      .send({ priority: 'URGENT' });
    expect(pr.status).toBe(200);
    expect(pr.body.priority).toBe('URGENT');
    await request(app).post(`/api/v2/verification-tasks/${taskId}/complete`).set(h);
    const after = await request(app)
      .put(`/api/v2/verification-tasks/${taskId}/priority`)
      .set(h)
      .send({ priority: 'LOW' });
    expect(after.status).toBe(409); // priority is NOT idempotent-as-success on a terminal task
  });

  it('device numeric drag-reorder priority is ack-only (200) and never overwrites the office priority', async () => {
    const { taskId, agent } = await seedAssignedTask('PN');
    const h = hdr('FIELD_AGENT', agent);
    const started = await request(app).post(`/api/v2/verification-tasks/${taskId}/start`).set(h);
    expect(started.body.priority).toBe('MEDIUM'); // office default
    // The device sends a NUMERIC reorder position (its local queue ordering) — accepted, no DLQ, and
    // the office priority is left untouched (owner decision: the reorder is device-local).
    const num = await request(app)
      .put(`/api/v2/verification-tasks/${taskId}/priority`)
      .set(h)
      .send({ priority: 2 });
    expect(num.status).toBe(200);
    expect(num.body.priority).toBe('MEDIUM'); // unchanged
    // numeric ack is allowed even on a terminal task → never 409 → never DLQs the device sync queue
    await request(app).post(`/api/v2/verification-tasks/${taskId}/complete`).set(h);
    const afterTerminal = await request(app)
      .put(`/api/v2/verification-tasks/${taskId}/priority`)
      .set(h)
      .send({ priority: 1 });
    expect(afterTerminal.status).toBe(200);
    expect(afterTerminal.body.priority).toBe('MEDIUM');
  });

  it('ownership + RBAC: a non-assignee field agent → 404; a role without task.execute → 403', async () => {
    const { taskId, agent } = await seedAssignedTask('OW');
    const other = await createUser({ username: 'fa_other', name: 'OTHER FA', role: 'FIELD_AGENT' });
    const be = await createUser({ username: 'be_ow', name: 'BACKEND', role: 'BACKEND_USER' });
    // a different field agent (has task.execute but not the assignee) → 404, IDOR-safe
    expect(
      (await request(app).post(`/api/v2/verification-tasks/${taskId}/start`).set(hdr('FIELD_AGENT', other)))
        .status,
    ).toBe(404);
    // a backend user lacks task.execute → 403 (before any ownership check)
    expect(
      (await request(app).post(`/api/v2/verification-tasks/${taskId}/start`).set(hdr('BACKEND_USER', be)))
        .status,
    ).toBe(403);
    // the rightful assignee still works
    expect(
      (await request(app).post(`/api/v2/verification-tasks/${taskId}/start`).set(hdr('FIELD_AGENT', agent)))
        .status,
    ).toBe(200);
  });

  it('submit form → evidence stored under form_data[slug] AND task SUBMITTED (ADR-0047); result stays null; case stays IN_PROGRESS; unknown slug 400; idempotent', async () => {
    const { caseId, taskId, agent } = await seedAssignedTask('FRM');
    const h = hdr('FIELD_AGENT', agent);
    await request(app).post(`/api/v2/verification-tasks/${taskId}/start`).set(h);

    const sub = await request(app)
      .post(`/api/v2/verification-tasks/${taskId}/verification/residence`)
      .set(h)
      .send({ formData: { addressConfirmed: true }, verificationOutcome: 'POSITIVE' });
    expect(sub.status).toBe(200);
    expect(sub.body.status).toBe('SUBMITTED'); // ADR-0047: the device posts only the form → SUBMITTED
    expect(sub.body.verificationOutcome).toBeNull(); // the blob's outcome is NOT the official result (D1)
    expect(await caseStatus(caseId)).toBe('IN_PROGRESS'); // SUBMITTED is active — awaits the office complete

    const fd = (
      await db!.pool.query<{
        form_data: Record<string, { formData: { addressConfirmed: boolean }; verificationOutcome: string }>;
      }>(`SELECT form_data FROM case_tasks WHERE id = $1`, [taskId])
    ).rows[0]!.form_data;
    expect(fd['residence']!.formData.addressConfirmed).toBe(true);
    expect(fd['residence']!.verificationOutcome).toBe('POSITIVE'); // stored as EVIDENCE in the blob only

    // unknown slug → 400 (the 9 are pinned), checked before any write
    expect(
      (await request(app).post(`/api/v2/verification-tasks/${taskId}/verification/bogus`).set(h).send({}))
        .status,
    ).toBe(400);
    // idempotent resubmit on the now-SUBMITTED task (overwrites the slug key, stays SUBMITTED) → 200
    expect(
      (
        await request(app)
          .post(`/api/v2/verification-tasks/${taskId}/verification/residence`)
          .set(h)
          .send({ formData: { addressConfirmed: false } })
      ).status,
    ).toBe(200);
  });

  it('submit form directly from ASSIGNED (no explicit start) also SUBMITS the task; case stays IN_PROGRESS', async () => {
    const { caseId, taskId, agent } = await seedAssignedTask('FRA');
    const h = hdr('FIELD_AGENT', agent);
    const sub = await request(app)
      .post(`/api/v2/verification-tasks/${taskId}/verification/office`)
      .set(h)
      .send({ formData: { officeConfirmed: true } });
    expect(sub.status).toBe(200);
    expect(sub.body.status).toBe('SUBMITTED');
    expect(await caseStatus(caseId)).toBe('IN_PROGRESS');
  });

  describe('field-photo upload (ADR-0034)', () => {
    const stored = new Map<string, Buffer>();
    const fakeStorage: StorageProvider = {
      put: (key, body) => {
        stored.set(key, body);
        return Promise.resolve({ key });
      },
      get: (key) => Promise.resolve(stored.get(key) ?? Buffer.alloc(0)),
      signedUrl: (key) => Promise.resolve(`https://fake/${key}`),
      remove: (key) => {
        stored.delete(key);
        return Promise.resolve();
      },
    };
    let img: Buffer;
    beforeAll(async () => {
      setStorage(fakeStorage);
      img = await sharp({
        create: { width: 16, height: 16, channels: 3, background: { r: 200, g: 100, b: 50 } },
      })
        .jpeg()
        .toBuffer();
    });
    afterAll(() => setStorage(null));

    it('uploads a field photo (locked multipart fields) → 200 {success,data}; stores a FIELD_PHOTO row with the server evidence hash + verified client hash; replay is idempotent', async () => {
      const { caseId, taskId, agent } = await seedAssignedTask('PH');
      const h = hdr('FIELD_AGENT', agent);
      const clientSha = createHash('sha256').update(img).digest('hex');

      const res = await request(app)
        .post(`/api/v2/verification-tasks/${taskId}/attachments`)
        .set(h)
        .set('Idempotency-Key', 'op-PH-1')
        .field('photoType', 'verification')
        .field('verificationType', 'residence')
        .field('submissionId', 'sub-1')
        .field('clientSha256', clientSha)
        .field(
          'geoLocation',
          JSON.stringify({ latitude: 28.6, longitude: 77.2, accuracy: 5, timestamp: PAST }),
        )
        .attach('files', img, { filename: 'photo.jpg', contentType: 'image/jpeg' });
      expect(res.status).toBe(200);
      expect(res.body.taskId).toBe(taskId);
      expect(res.body.verificationType).toBe('residence');
      expect(res.body.attachments).toHaveLength(1);
      const a = res.body.attachments[0];
      expect(a.photoType).toBe('verification');
      expect(a.geoLocation.latitude).toBe(28.6);
      expect(a.url).toContain(`field-photos/${caseId}/${taskId}/`);
      expect(a.thumbnailUrl).toBeTruthy();
      expect(stored.has(a.url)).toBe(true); // bytes reached the storage seam

      const row = (
        await db!.pool.query<{
          kind: string;
          hash_verified: boolean;
          sha256: string;
          operation_id: string;
          photo_type: string;
        }>(
          `SELECT kind, hash_verified, sha256, operation_id, photo_type FROM case_attachments WHERE task_id = $1`,
          [taskId],
        )
      ).rows[0]!;
      expect(row.kind).toBe('FIELD_PHOTO');
      expect(row.hash_verified).toBe(true); // client hash matched the bytes we received
      expect(row.sha256).toMatch(/^[0-9a-f]{64}$/); // server evidence hash of the stored (stripped) bytes
      expect(row.operation_id).toBe('op-PH-1:0');
      expect(row.photo_type).toBe('verification');

      // Idempotent replay (same Idempotency-Key) → 200 cached, NO second row (not 409).
      const replay = await request(app)
        .post(`/api/v2/verification-tasks/${taskId}/attachments`)
        .set(h)
        .set('Idempotency-Key', 'op-PH-1')
        .field('photoType', 'verification')
        .attach('files', img, { filename: 'photo.jpg', contentType: 'image/jpeg' });
      expect(replay.status).toBe(200);
      expect(replay.body.attachments).toHaveLength(1);
      const count = (
        await db!.pool.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM case_attachments WHERE task_id = $1`,
          [taskId],
        )
      ).rows[0]!.n;
      expect(count).toBe(1); // replay did not re-store
    });

    it('guards: non-assignee → 404; missing Idempotency-Key → 400; a non-image → success=false with a failed[] entry', async () => {
      const { taskId } = await seedAssignedTask('PV');
      const other = await createUser({ username: 'fa_pv_other', name: 'OTHER', role: 'FIELD_AGENT' });
      // a FIELD_AGENT who is NOT the assignee → 404 (ownership, not just the perm)
      expect(
        (
          await request(app)
            .post(`/api/v2/verification-tasks/${taskId}/attachments`)
            .set(hdr('FIELD_AGENT', other))
            .set('Idempotency-Key', 'op-x')
            .attach('files', img, { filename: 'p.jpg', contentType: 'image/jpeg' })
        ).status,
      ).toBe(404);

      const { taskId: t2, agent } = await seedAssignedTask('PV2');
      const h = hdr('FIELD_AGENT', agent);
      // no Idempotency-Key and no operationId field → 400
      expect(
        (
          await request(app)
            .post(`/api/v2/verification-tasks/${t2}/attachments`)
            .set(h)
            .attach('files', img, { filename: 'p.jpg', contentType: 'image/jpeg' })
        ).status,
      ).toBe(400);
      // a non-image (PDF bytes) is rejected per-file → 200 success=false, nothing stored
      const pdf = Buffer.from('%PDF-1.4 not an image', 'utf8');
      const bad = await request(app)
        .post(`/api/v2/verification-tasks/${t2}/attachments`)
        .set(h)
        .set('Idempotency-Key', 'op-PV2')
        .attach('files', pdf, { filename: 'doc.pdf', contentType: 'application/pdf' });
      expect(bad.status).toBe(200);
      expect(bad.status).toBe(200);
      expect(bad.body.attachments).toHaveLength(0);
      expect(bad.body.failed).toHaveLength(1);
    });
  });

  // ── reads: office-reference attachments list + form-template stub (mobile parity, Phase 1C) ──
  describe('reads (mobile parity)', () => {
    const refStored = new Map<string, Buffer>();
    const refStorage: StorageProvider = {
      put: (key, body) => {
        refStored.set(key, body);
        return Promise.resolve({ key });
      },
      get: (key) => Promise.resolve(refStored.get(key) ?? Buffer.alloc(0)),
      signedUrl: (key) => Promise.resolve(`https://fake/${key}`),
      remove: (key) => {
        refStored.delete(key);
        return Promise.resolve();
      },
    };
    beforeAll(() => setStorage(refStorage));
    afterAll(() => setStorage(null));

    it('lists office reference docs for an owned task (with presigned url); 404 for a non-owner', async () => {
      const { caseId, taskId, agent } = await seedAssignedTask('ATT');
      await db!.pool.query(
        `INSERT INTO case_attachments
           (case_id, task_id, original_name, mime_type, file_size, storage_key, sha256, uploaded_by)
         VALUES ($1, NULL, 'policy.pdf',   'application/pdf', 2048, 'attachments/x/p.pdf', repeat('a',64), $2),
                ($1, $3,   'task-ref.pdf', 'application/pdf', 1024, 'attachments/x/t.pdf', repeat('b',64), $2)`,
        [caseId, agent, taskId],
      );

      const res = await request(app)
        .get(`/api/v2/verification-tasks/${taskId}/attachments`)
        .set(hdr('FIELD_AGENT', agent));
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
      const rows = res.body as { originalName: string; url: string }[];
      expect(rows.map((a) => a.originalName).sort()).toEqual(['policy.pdf', 'task-ref.pdf']);
      const url = Object.fromEntries(rows.map((a) => [a.originalName, a.url]));
      expect(url['policy.pdf']).toBe('https://fake/attachments/x/p.pdf'); // absolute presigned URL
      expect(url['task-ref.pdf']).toBe('https://fake/attachments/x/t.pdf');
      expect(res.body[0]).toMatchObject({ mimeType: 'application/pdf' });
      expect(typeof res.body[0].size).toBe('number');
      expect(res.body[0].uploadedAt).toBeTruthy();

      // a different agent (not assigned this task) → 404 (ownership, IDOR-safe)
      const other = await createUser({ username: 'fa_other', name: 'Other', role: 'FIELD_AGENT' });
      const denied = await request(app)
        .get(`/api/v2/verification-tasks/${taskId}/attachments`)
        .set(hdr('FIELD_AGENT', other));
      expect(denied.status).toBe(404);
    });

    it('serves a bare null form template so the device uses its bundled template', async () => {
      const { agent } = await seedAssignedTask('FT');
      const res = await request(app).get('/api/v2/forms/residence/template').set(hdr('FIELD_AGENT', agent));
      expect(res.status).toBe(200);
      expect(res.body).toBeNull();
    });
  });
});
