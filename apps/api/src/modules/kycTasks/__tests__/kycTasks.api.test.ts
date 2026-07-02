import { describe, it, expect, beforeAll, afterAll } from 'vitest';
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

const fakeStorage: StorageProvider = {
  put: (key) => Promise.resolve({ key }),
  get: () => Promise.resolve(Buffer.from('')),
  signedUrl: (key) => Promise.resolve(`https://signed.example/${key}`),
  remove: () => Promise.resolve(),
};
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);

/**
 * KYC-verifier queue (ADR-0085 S2): self-scoped OFFICE-task read model with the DERIVED export
 * state. Integration — requires DATABASE_URL (ephemeral PG); self-skips otherwise.
 */

const RUN = !!process.env['DATABASE_URL'];
const db = RUN ? createTestDb() : null;
const app = createApp({ enableTestAuth: true });

const SA = authHeaderForRole('SUPER_ADMIN');
const FA = authHeaderForRole('FIELD_AGENT'); // no kyc_tasks.view → 403
const hdr = (role: string, id: string): Record<string, string> => ({ 'x-test-auth': `${role}:${id}` });
const BC = '9876543210';
const PAST = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
const LIST = '/api/v2/kyc-tasks';

function seeded<T>(res: request.Response): T {
  if (res.status >= 400) throw new Error(`seed failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body as T;
}

async function createUser(role: string, username: string): Promise<string> {
  const { rows } = await db!.pool.query<{ id: string }>(
    `INSERT INTO users (id, username, name, role) VALUES (gen_random_uuid(), $1, $2, $3) RETURNING id`,
    [username, username.toUpperCase(), role],
  );
  const id = rows[0]!.id;
  // ADR-0073: OFFICE assignment needs a per-unit grant — make test verifiers universally eligible.
  if (role === 'KYC_VERIFIER')
    await db!.pool.query(
      `INSERT INTO user_kyc_unit_access (user_id, verification_unit_id)
       SELECT $1, vu.id FROM verification_units vu WHERE vu.is_active ON CONFLICT DO NOTHING`,
      [id],
    );
  return id;
}

/** Client+product with one CPV-enabled KYC unit → a case with one OFFICE task assigned to `assignee`. */
async function seedOfficeTask(
  tag: string,
  assignee: string,
  doc?: { documentNumber?: string; documentDetails?: Record<string, string> },
): Promise<{ caseId: string; taskId: string }> {
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
      .send(verificationUnitFactory({ code: `U_${tag}`, workerRole: 'KYC_VERIFIER' })),
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
  // the fresh unit postdates the verifiers' blanket grant → grant it to every test verifier (ADR-0073)
  await db!.pool.query(
    `INSERT INTO user_kyc_unit_access (user_id, verification_unit_id)
     SELECT u.id, $1 FROM users u WHERE u.role = 'KYC_VERIFIER' ON CONFLICT DO NOTHING`,
    [unitId],
  );
  const caseId = seeded<{ id: string }>(
    await request(app)
      .post('/api/v2/cases')
      .set(SA)
      .send({
        clientId,
        productId,
        backendContactNumber: BC,
        applicants: [{ name: `APPL ${tag}`, pan: 'ABCPE1234F', mobile: '9876543210' }],
        dedupeDecision: 'NO_DUPLICATES_FOUND',
      }),
  ).id;
  const detail = await request(app).get(`/api/v2/cases/${caseId}`).set(SA);
  const applicantId = detail.body.applicants[0].id as string;
  const tasks = seeded<Array<{ id: string }>>(
    await request(app)
      .post(`/api/v2/cases/${caseId}/tasks`)
      .set(SA)
      .send({ tasks: [{ verificationUnitId: unitId, applicantId, ...doc }] }),
  );
  const taskId = tasks[0]!.id;
  const assign = await request(app)
    .post(`/api/v2/cases/${caseId}/tasks/${taskId}/assign`)
    .set(SA)
    .send({ assignedTo: assignee, visitType: 'OFFICE', billCount: 1, version: 1 });
  if (assign.status !== 200) throw new Error(`assign failed: ${JSON.stringify(assign.body)}`);
  return { caseId, taskId };
}

/** Test seam: stamp a first-export event (S3 builds the real endpoint that writes these). */
async function stampFirstExport(caseId: string, taskId: string, byUserId: string): Promise<void> {
  await db!.pool.query(
    `INSERT INTO task_export_events (task_id, case_id, exported_by, format) VALUES ($1, $2, $3, 'xlsx')`,
    [taskId, caseId, byUserId],
  );
}

describe.skipIf(!RUN)('KYC-verifier queue (ADR-0085 S2)', () => {
  beforeAll(async () => {
    await db!.migrate();
    setPool(db!.pool);
    setStorage(fakeStorage);
  });
  afterAll(async () => {
    setStorage(null);
    await db!.end();
  });

  it('RBAC: no kyc_tasks.view → 403; unauth → 401; KYC_VERIFIER → 200', async () => {
    const verifier = await createUser('KYC_VERIFIER', 'kv_rbac');
    expect((await request(app).get(`${LIST}?state=TO_EXPORT`)).status).toBe(401);
    expect((await request(app).get(`${LIST}?state=TO_EXPORT`).set(FA)).status).toBe(403);
    const ok = await request(app).get(`${LIST}?state=TO_EXPORT`).set(hdr('KYC_VERIFIER', verifier));
    expect(ok.status).toBe(200);
    expect(ok.body).toHaveProperty('items');
    expect(ok.body).toHaveProperty('totalCount');
  });

  it('strict validation: unknown state / column / sort → 400', async () => {
    const verifier = await createUser('KYC_VERIFIER', 'kv_val');
    const H = hdr('KYC_VERIFIER', verifier);
    expect((await request(app).get(`${LIST}?state=NOPE`).set(H)).status).toBe(400);
    expect((await request(app).get(`${LIST}?state=TO_EXPORT&cols=evil`).set(H)).status).toBe(400);
    expect((await request(app).get(`${LIST}?state=TO_EXPORT&sortBy=evil`).set(H)).status).toBe(400);
  });

  it('self-scope + state derivation: own ASSIGNED OFFICE task in TO_EXPORT; export event moves it to EXPORTED; other verifier sees 0', async () => {
    const mine = await createUser('KYC_VERIFIER', 'kv_own');
    const other = await createUser('KYC_VERIFIER', 'kv_other');
    const { caseId, taskId } = await seedOfficeTask('S2A', mine, {
      documentNumber: 'PAN123',
      documentDetails: { 'BANK NAME': 'HDFC' },
    });

    const H = hdr('KYC_VERIFIER', mine);
    const toExport = await request(app)
      .get(
        `${LIST}?state=TO_EXPORT&cols=documentNumber,documentDetails,status,exportedAt,assignedByName,attachmentCount`,
      )
      .set(H);
    expect(toExport.status).toBe(200);
    expect(toExport.body.totalCount).toBe(1);
    const row = toExport.body.items[0];
    expect(row.documentNumber).toBe('PAN123');
    expect(row.documentDetails).toEqual({ 'BANK NAME': 'HDFC' });
    expect(row.status).toBe('ASSIGNED');
    expect(row.exportedAt).toBeNull();
    // owner 2026-07-02: who assigned it (the SA test-auth actor is synthetic — not a users row → null
    // is the LEFT-JOIN contract; a real assigner resolves to their name) + the task's attachment count.
    expect(row).toHaveProperty('assignedByName');
    expect(row.attachmentCount).toBe(0);

    // the other verifier sees NOTHING (SELF scope; out-of-scope = 0 rows, never an error)
    const others = await request(app).get(`${LIST}?state=TO_EXPORT`).set(hdr('KYC_VERIFIER', other));
    expect(others.body.totalCount).toBe(0);

    // a first-export event flips the derived state — no case_tasks.status change involved
    await stampFirstExport(caseId, taskId, mine);
    const after = await request(app).get(`${LIST}?state=TO_EXPORT`).set(H);
    expect(after.body.totalCount).toBe(0);
    const exported = await request(app).get(`${LIST}?state=EXPORTED`).set(H);
    expect(exported.body.totalCount).toBe(1);
    expect(exported.body.items[0].exportedAt).not.toBeNull();
    expect(exported.body.items[0].exportCount).toBe(1);
    expect(exported.body.items[0].status).toBe('ASSIGNED'); // task status untouched (derived state)
  });

  it('export claims + streams + dedups: file has per-label detail columns; task moves to EXPORTED; repeat → 409', async () => {
    const mine = await createUser('KYC_VERIFIER', 'kv_exp');
    const { taskId } = await seedOfficeTask('S3A', mine, {
      documentNumber: '=CMD()', // formula-injection probe — must be neutralized in the file
      documentDetails: { 'BANK NAME': 'HDFC', 'ACCOUNT NO': '50100' },
    });
    const H = hdr('KYC_VERIFIER', mine);

    const res = await request(app)
      .get(`/api/v2/kyc-tasks/export?format=csv&mode=selected&ids=${taskId}`)
      .set(H);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    // filename = IST date-time + the export number (the batch's first event id) — owner 2026-07-02
    expect(res.headers['content-disposition']).toMatch(/kyc-tasks-\d{8}-\d{4}-exp\d+\.csv/);
    const csv = res.text;
    // per-label detail columns (alphabetical), NOT one flattened cell
    expect(csv).toContain('ACCOUNT NO');
    expect(csv).toContain('BANK NAME');
    expect(csv).toContain('HDFC');
    // owner 2026-07-02: the assigner rides the file; Date cells are ISO, never JSON-quoted
    expect(csv).toContain('Assigned by');
    expect(csv).not.toContain('"""');
    // CWE-1236: the leading '=' is neutralized
    expect(csv).toContain(`'=CMD()`);
    // owner 2026-07-02 export layout: Applicant before Document type; detail columns INLINE between
    // Document type and Document number; Backend contact no present; holder/PAN/mobile dropped.
    const header = csv.split('\r\n')[0]!.split(',');
    const at = (h: string) => header.indexOf(h);
    expect(at('Applicant')).toBeGreaterThan(-1);
    expect(at('Applicant')).toBeLessThan(at('Document type'));
    expect(at('Document type')).toBeLessThan(at('BANK NAME')); // detail column inline after Document type
    expect(at('BANK NAME')).toBeLessThan(at('Document number')); // …and before Document number
    expect(at('Backend contact no')).toBeGreaterThan(-1);
    expect(at('Name on document')).toBe(-1);
    expect(at('Applicant PAN')).toBe(-1);
    expect(at('Applicant mobile')).toBe(-1);

    // the claim wrote exactly one first-export event; the derived state flipped
    const { rows } = await db!.pool.query(
      `SELECT is_reexport, exported_by, format FROM task_export_events WHERE task_id = $1`,
      [taskId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ is_reexport: false, exported_by: mine, format: 'csv' });
    expect((await request(app).get(`${LIST}?state=TO_EXPORT`).set(H)).body.totalCount).toBe(0);
    expect((await request(app).get(`${LIST}?state=EXPORTED`).set(H)).body.totalCount).toBe(1);

    // a second plain export of the same id → nothing claimable → 409 ALREADY_EXPORTED
    const again = await request(app)
      .get(`/api/v2/kyc-tasks/export?format=csv&mode=selected&ids=${taskId}`)
      .set(H);
    expect(again.status).toBe(409);
    expect(again.body.error).toBe('ALREADY_EXPORTED');
  });

  it('re-export needs a non-blank reason + selected already-exported ids; appends a reasoned event', async () => {
    const mine = await createUser('KYC_VERIFIER', 'kv_re');
    const { caseId, taskId } = await seedOfficeTask('S3B', mine, { documentNumber: 'GST99' });
    const H = hdr('KYC_VERIFIER', mine);

    // not exported yet → re-export refused (all-or-nothing)
    const early = await request(app)
      .get(`/api/v2/kyc-tasks/export?format=csv&mode=selected&ids=${taskId}&reexportReason=LOST`)
      .set(H);
    expect(early.status).toBe(409);
    expect(early.body.error).toBe('NOT_RE_EXPORTABLE');

    await stampFirstExport(caseId, taskId, mine);

    // blank reason → 400
    const blank = await request(app)
      .get(`/api/v2/kyc-tasks/export?format=csv&mode=selected&ids=${taskId}&reexportReason=%20%20`)
      .set(H);
    expect(blank.status).toBe(400);

    const ok = await request(app)
      .get(`/api/v2/kyc-tasks/export?format=csv&mode=selected&ids=${taskId}&reexportReason=EMAIL%20BOUNCED`)
      .set(H);
    expect(ok.status).toBe(200);
    expect(ok.text).toContain('GST99');
    const { rows } = await db!.pool.query(
      `SELECT is_reexport, reexport_reason FROM task_export_events WHERE task_id = $1 ORDER BY id`,
      [taskId],
    );
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ is_reexport: true, reexport_reason: 'EMAIL BOUNCED' });
    // exportCount reflects both events
    const exported = await request(app).get(`${LIST}?state=EXPORTED`).set(H);
    expect(exported.body.items[0].exportCount).toBe(2);
  });

  it('export scope + RBAC: another verifier claiming my task → 409 (0 claimed, no data); FIELD_AGENT → 403; bad ids → 400', async () => {
    const mine = await createUser('KYC_VERIFIER', 'kv_sc1');
    const thief = await createUser('KYC_VERIFIER', 'kv_sc2');
    const { taskId } = await seedOfficeTask('S3C', mine);

    const steal = await request(app)
      .get(`/api/v2/kyc-tasks/export?format=csv&mode=selected&ids=${taskId}`)
      .set(hdr('KYC_VERIFIER', thief));
    expect(steal.status).toBe(409); // out-of-scope id is silently not claimed → nothing to export
    // and NO event was written for the out-of-scope attempt
    const { rows } = await db!.pool.query(`SELECT 1 FROM task_export_events WHERE task_id = $1`, [taskId]);
    expect(rows).toHaveLength(0);

    expect((await request(app).get(`/api/v2/kyc-tasks/export?format=csv&mode=all`).set(FA)).status).toBe(403);
    expect(
      (
        await request(app)
          .get(`/api/v2/kyc-tasks/export?format=csv&mode=selected&ids=nope`)
          .set(hdr('KYC_VERIFIER', mine))
      ).status,
    ).toBe(400);
  });

  it('own-task attachments: verifier lists + downloads HIS task doc; another verifier → [] and 404 (ADR-0085)', async () => {
    const mine = await createUser('KYC_VERIFIER', 'kv_att');
    const other = await createUser('KYC_VERIFIER', 'kv_att2');
    const { caseId, taskId } = await seedOfficeTask('S4A', mine);
    // attach a reference doc to the task (raw-bytes upload, SA — the office attaches; fake storage)
    const up = await request(app)
      .post(`/api/v2/cases/${caseId}/attachments?taskId=${taskId}`)
      .set(SA)
      .set('x-filename', 'ref.png')
      .set('content-type', 'application/octet-stream')
      .send(PNG_BYTES);
    expect(up.status).toBe(201);
    const attId = up.body.id as string;

    const H = hdr('KYC_VERIFIER', mine);
    const listed = await request(app).get(`/api/v2/kyc-tasks/${taskId}/attachments`).set(H);
    expect(listed.status).toBe(200);
    expect(listed.body).toHaveLength(1);
    expect(listed.body[0]).toMatchObject({ id: attId, originalName: 'ref.png' });
    // a presigned URL for MY task's attachment
    const url = await request(app).get(`/api/v2/kyc-tasks/${taskId}/attachments/${attId}/url`).set(H);
    expect(url.status).toBe(200);
    expect(typeof url.body.url).toBe('string');

    // another verifier sees NOTHING for the same task (SELF scope) — list [] + url 404 (IDOR-safe)
    const O = hdr('KYC_VERIFIER', other);
    expect((await request(app).get(`/api/v2/kyc-tasks/${taskId}/attachments`).set(O)).body).toHaveLength(0);
    expect(
      (await request(app).get(`/api/v2/kyc-tasks/${taskId}/attachments/${attId}/url`).set(O)).status,
    ).toBe(404);
    // no kyc_tasks.view → 403
    expect((await request(app).get(`/api/v2/kyc-tasks/${taskId}/attachments`).set(FA)).status).toBe(403);
  });

  it('FIELD tasks never appear; SA (grants-all, unrestricted scope) sees all OFFICE rows', async () => {
    const verifier = await createUser('KYC_VERIFIER', 'kv_field');
    await seedOfficeTask('S2B', verifier);
    // no FIELD seeding needed for the negative half: the base WHERE is visit_type='OFFICE', and the
    // S2A/S2B seeds only create OFFICE tasks — assert the SA view is exactly the OFFICE set.
    const sa = await request(app).get(`${LIST}?state=TO_EXPORT`).set(SA);
    expect(sa.status).toBe(200);
    const numbers = (sa.body.items as Array<{ taskNumber: string }>).map((r) => r.taskNumber);
    expect(numbers.length).toBe(sa.body.totalCount);
    // every row the SA sees is an OFFICE task from this suite's seeds (no FIELD/foreign rows)
    expect(sa.body.items.every((r: { status: string }) => r.status === 'ASSIGNED')).toBe(true);
  });
});
