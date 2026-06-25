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
import { setPool, query } from '../../../platform/db.js';

/**
 * GET /api/v2/cases/rate-preview (ADR-0050 + ADR-0056) — the task-creation rate-type preview.
 *
 * The CLIENT rate type resolves by LOCATION (most-specific row > location-less default), a display
 * label (ADR-0050 §1). The FIELD rate type(s) come from Commission Management; per ADR-0056 they are
 * scoped to the CHOSEN EXECUTIVE when `assigneeId` is supplied — the preview then answers "which band(s)
 * is THIS executive priced for at this location" (one ⇒ that band; many ⇒ a pick). Without an assignee
 * it stays the location-wide union (back-compat for the assign-later create path).
 */
const RUN = !!process.env['DATABASE_URL'];
const db = RUN ? createTestDb() : null;
const app = createApp({ enableTestAuth: true });
const SA = authHeaderForRole('SUPER_ADMIN');
const PAST = new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString();

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

async function seedLocation(pincode: string, area: string): Promise<number> {
  return seeded<{ id: number }>(
    await request(app).post('/api/v2/locations').set(SA).send({ pincode, area, city: 'Mumbai', state: 'MH' }),
  ).id;
}

async function createUser(o: { username: string; name: string; role: string }): Promise<string> {
  const res = await request(app).post('/api/v2/users').set(SA).send(o);
  expect(res.status).toBe(201);
  return res.body.id as string;
}

/** Client `rates` row — clientRateType is a free-text label; locationId NULL ⇒ a location-less default. */
async function seedRate(o: {
  clientId: number;
  productId: number;
  unitId: number;
  locationId: number | null;
  clientRateType: string;
  amount: number;
}): Promise<void> {
  // ADR-0068: rate type is now a rate_types FK. Mirror mig 0094's auto-promotion of any legacy free-text
  // label (e.g. "STANDARD") into the catalog so an arbitrary fixture code resolves to an id.
  await query(
    `INSERT INTO rate_types (code, name, is_active) VALUES (UPPER($1), UPPER($1), true)
     ON CONFLICT (code) DO NOTHING`,
    [o.clientRateType],
  );
  await query(
    `INSERT INTO rates (client_id, product_id, verification_unit_id, location_id, rate_type_id, amount,
       currency, is_active, effective_from)
     VALUES ($1, $2, $3, $4, (SELECT id FROM rate_types WHERE code = UPPER($5)), $6, 'INR', true, now() - interval '2 days')`,
    [o.clientId, o.productId, o.unitId, o.locationId, o.clientRateType, o.amount],
  );
}

/** A per-executive commission tariff line at a location with a given field rate type (LOCAL/OGL). */
async function seedCommission(o: {
  userId: string;
  clientId: number;
  productId: number;
  unitId: number;
  locationId: number;
  fieldRateType: 'LOCAL' | 'OGL';
  amount: number;
  tatBand?: number | null;
}): Promise<void> {
  await query(
    `INSERT INTO commission_rates (user_id, client_id, product_id, verification_unit_id, location_id,
       rate_type_id, tat_band, amount, currency, effective_from)
     VALUES ($1, $2, $3, $4, $5, (SELECT id FROM rate_types WHERE code = UPPER($6)), $7, $8, 'INR', now() - interval '2 days')`,
    [o.userId, o.clientId, o.productId, o.unitId, o.locationId, o.fieldRateType, o.tatBand ?? null, o.amount],
  );
}

function previewUrl(o: {
  clientId: number;
  productId: number;
  unitId: number;
  locationId: number;
  assigneeId?: string;
}): string {
  const p = new URLSearchParams({
    clientId: String(o.clientId),
    productId: String(o.productId),
    verificationUnitId: String(o.unitId),
    locationId: String(o.locationId),
  });
  if (o.assigneeId) p.set('assigneeId', o.assigneeId);
  return `/api/v2/cases/rate-preview?${p.toString()}`;
}

beforeAll(async () => {
  if (db) {
    await db.migrate();
    setPool(db.pool);
  }
});
afterAll(async () => {
  if (db) await db.end();
});

describe.skipIf(!RUN)('GET /cases/rate-preview', () => {
  it('scopes FIELD rate types to the chosen executive (ADR-0056)', async () => {
    const ctx = await seedCpvUnit('EXEC');
    const l1 = await seedLocation('400001', 'Fort');
    const u1 = await createUser({ username: 'exec1_rp', name: 'Exec One', role: 'FIELD_AGENT' });
    const u2 = await createUser({ username: 'exec2_rp', name: 'Exec Two', role: 'FIELD_AGENT' });
    // U1 is priced LOCAL at L1; U2 is priced OGL at the SAME location.
    await seedCommission({ ...ctx, userId: u1, locationId: l1, fieldRateType: 'LOCAL', amount: 50 });
    await seedCommission({ ...ctx, userId: u2, locationId: l1, fieldRateType: 'OGL', amount: 90 });

    // No assignee → the location-wide union of both execs' bands (back-compat).
    const union = seeded<{ fieldRateTypes: string[] }>(
      await request(app)
        .get(previewUrl({ ...ctx, locationId: l1 }))
        .set(SA),
    );
    expect(union.fieldRateTypes.sort()).toEqual(['LOCAL', 'OGL']);

    // With assignee U1 → ONLY U1's band.
    const forU1 = seeded<{ fieldRateTypes: string[] }>(
      await request(app)
        .get(previewUrl({ ...ctx, locationId: l1, assigneeId: u1 }))
        .set(SA),
    );
    expect(forU1.fieldRateTypes).toEqual(['LOCAL']);

    const forU2 = seeded<{ fieldRateTypes: string[] }>(
      await request(app)
        .get(previewUrl({ ...ctx, locationId: l1, assigneeId: u2 }))
        .set(SA),
    );
    expect(forU2.fieldRateTypes).toEqual(['OGL']);
  });

  it('returns both bands when one executive is priced for both at a location', async () => {
    const ctx = await seedCpvUnit('BOTH');
    const l1 = await seedLocation('400002', 'Colaba');
    const u = await createUser({ username: 'exec_both_rp', name: 'Exec Both', role: 'FIELD_AGENT' });
    await seedCommission({ ...ctx, userId: u, locationId: l1, fieldRateType: 'LOCAL', amount: 40 });
    await seedCommission({ ...ctx, userId: u, locationId: l1, fieldRateType: 'OGL', amount: 70 });

    const res = seeded<{ fieldRateTypes: string[] }>(
      await request(app)
        .get(previewUrl({ ...ctx, locationId: l1, assigneeId: u }))
        .set(SA),
    );
    expect(res.fieldRateTypes.sort()).toEqual(['LOCAL', 'OGL']);
  });

  it('CLIENT rate type resolves the most-specific row over a location-less default', async () => {
    const ctx = await seedCpvUnit('CLIENT');
    const l1 = await seedLocation('400003', 'Worli');
    const l2 = await seedLocation('400004', 'Dadar');
    // A free-text location-less default ("STANDARD" legacy label) + a location-specific OGL row at L1.
    await seedRate({ ...ctx, locationId: null, clientRateType: 'STANDARD', amount: 100 });
    await seedRate({ ...ctx, locationId: l1, clientRateType: 'OGL', amount: 200 });

    // At L1 the specific OGL row wins — NOT the STANDARD default.
    const atL1 = seeded<{ clientRateType: string | null }>(
      await request(app)
        .get(previewUrl({ ...ctx, locationId: l1 }))
        .set(SA),
    );
    expect(atL1.clientRateType).toBe('OGL');

    // At L2 (no specific row) it falls back to the location-less default — this is how a "STANDARD"
    // label surfaces: it is the configured value, not a resolver bug.
    const atL2 = seeded<{ clientRateType: string | null }>(
      await request(app)
        .get(previewUrl({ ...ctx, locationId: l2 }))
        .set(SA),
    );
    expect(atL2.clientRateType).toBe('STANDARD');
  });
});

/** A FIELD agent covering a pincode + a located case with one PENDING FIELD task there. */
async function createLocatedTask(
  ctx: { clientId: number; productId: number; unitId: number },
  pincodeId: number,
): Promise<{ caseId: string; taskId: string }> {
  const caseId = seeded<{ id: string }>(
    await request(app)
      .post('/api/v2/cases')
      .set(SA)
      .send({
        clientId: ctx.clientId,
        productId: ctx.productId,
        backendContactNumber: '9876500000',
        applicants: [{ name: 'DRV APP' }],
        dedupeDecision: 'NO_DUPLICATES_FOUND',
        pincodeId,
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
          { verificationUnitId: ctx.unitId, applicantId, address: 'addr', pincodeId, areaId: pincodeId },
        ],
      }),
  );
  return { caseId, taskId: tasks[0]!.id };
}

async function scopeToPincode(userId: string, pincodeId: number): Promise<void> {
  seeded(
    await request(app)
      .post(`/api/v2/users/${userId}/scope-assignments`)
      .set(SA)
      .send({ dimension: 'PINCODE', entityIds: [pincodeId] }),
  );
}

describe.skipIf(!RUN)('FIELD assign derives + blocks field_rate_type (ADR-0056)', () => {
  it('derives field_rate_type from the assignee commission when none is supplied', async () => {
    const ctx = await seedCpvUnit('DERIVE');
    const pin = await seedLocation('560003', 'Malleswaram');
    const fa = await createUser({ username: 'fa_derive', name: 'Derive FA', role: 'FIELD_AGENT' });
    await scopeToPincode(fa, pin);
    // The agent is priced OGL here (NOT the old 'LOCAL' default) — proves the value is derived, not guessed.
    await seedCommission({ ...ctx, userId: fa, locationId: pin, fieldRateType: 'OGL', amount: 80 });
    const { caseId, taskId } = await createLocatedTask(ctx, pin);

    // Assign WITHOUT fieldRateType → the server derives 'OGL' from the agent's commission.
    const res = await request(app)
      .post(`/api/v2/cases/${caseId}/tasks/${taskId}/assign`)
      .set(SA)
      .send({ assignedTo: fa, visitType: 'FIELD', billCount: 1, version: 1 });
    expect(res.status).toBe(200);
    expect(res.body.fieldRateType).toBe('OGL');
  });

  it('blocks a FIELD assign (NO_FIELD_COMMISSION) when the assignee has no commission there', async () => {
    const ctx = await seedCpvUnit('BLOCK');
    const pin = await seedLocation('560004', 'Rajajinagar');
    const fa = await createUser({ username: 'fa_block', name: 'Block FA', role: 'FIELD_AGENT' });
    await scopeToPincode(fa, pin); // eligible by territory, but NO commission seeded
    const { caseId, taskId } = await createLocatedTask(ctx, pin);

    const res = await request(app)
      .post(`/api/v2/cases/${caseId}/tasks/${taskId}/assign`)
      .set(SA)
      .send({ assignedTo: fa, visitType: 'FIELD', billCount: 1, version: 1 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('NO_FIELD_COMMISSION');
  });

  it('prefers a tat_band-universal band so the derived band always resolves (B-1)', async () => {
    const ctx = await seedCpvUnit('TATBAND');
    const pin = await seedLocation('560005', 'Yeshwanthpur');
    const fa = await createUser({ username: 'fa_tat', name: 'Tat FA', role: 'FIELD_AGENT' });
    await scopeToPincode(fa, pin);
    // Same exec/location/specificity, two bands: LOCAL at tat_band NULL (resolves at ANY submit band)
    // seeded FIRST (lower id), then OGL only at tat_band=4 (resolves only in that band, higher id). Without
    // the tie-break, `id DESC` would pick OGL → ₹0 risk; the tie-break must pick the always-resolvable LOCAL.
    await seedCommission({
      ...ctx,
      userId: fa,
      locationId: pin,
      fieldRateType: 'LOCAL',
      tatBand: null,
      amount: 55,
    });
    await seedCommission({
      ...ctx,
      userId: fa,
      locationId: pin,
      fieldRateType: 'OGL',
      tatBand: 4,
      amount: 99,
    });
    const { caseId, taskId } = await createLocatedTask(ctx, pin);

    const res = await request(app)
      .post(`/api/v2/cases/${caseId}/tasks/${taskId}/assign`)
      .set(SA)
      .send({ assignedTo: fa, visitType: 'FIELD', billCount: 1, version: 1 });
    expect(res.status).toBe(200);
    expect(res.body.fieldRateType).toBe('LOCAL');
  });
});
