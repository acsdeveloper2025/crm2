import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { createTestDb, clientFactory, authHeaderForRole } from '@crm2/test-utils';
import { createApp } from '../../../http/app.js';
import { setPool } from '../../../platform/db.js';
import { commissionRateRepository } from '../repository.js';

const RUN = !!process.env['DATABASE_URL'];
const db = RUN ? createTestDb() : null;
const app = createApp({ enableTestAuth: true });
const SA = authHeaderForRole('SUPER_ADMIN');
const FA = authHeaderForRole('FIELD_AGENT'); // holds neither masterdata perm
const MGR = authHeaderForRole('MANAGER'); // holds masterdata.view but NOT masterdata.manage
const TL = authHeaderForRole('TEAM_LEADER'); // holds data.export but NOT masterdata.manage

const newClient = async (code: string) =>
  (await request(app).post('/api/v2/clients').set(SA).send(clientFactory({ code }))).body.id as number;
const newUser = async (username: string): Promise<string> => {
  const res = await request(app)
    .post('/api/v2/users')
    .set(SA)
    .send({ username, name: username.toUpperCase(), role: 'FIELD_AGENT' });
  expect(res.status).toBe(201);
  return res.body.id as string;
};

describe.skipIf(!RUN)('commission-rates API (ADR-0036)', () => {
  beforeAll(async () => {
    await db!.migrate();
    setPool(db!.pool);
  });
  afterAll(async () => {
    await db!.end();
  });
  beforeEach(async () => {
    await db!.truncate('commission_rates', 'clients', 'users');
  });

  it('creates a universal commission rate (201), numeric amount, lists the joined view', async () => {
    const userId = await newUser('cr_u1');
    const created = await request(app)
      .post('/api/v2/commission-rates')
      .set(SA)
      .send({ userId, rateType: 'LOCAL', amount: 50 });
    expect(created.status).toBe(201);
    expect(created.body.amount).toBe(50);
    expect(typeof created.body.amount).toBe('number');
    expect(created.body.currency).toBe('INR');
    expect(created.body.clientId).toBeNull();
    expect(created.body.version).toBe(1);

    const list = await request(app).get('/api/v2/commission-rates').set(SA);
    expect(list.status).toBe(200);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0].userName).toBe('CR_U1');
    expect(list.body.items[0].clientName).toBeNull(); // universal
    expect(list.body.sort).toEqual({ sortBy: 'user', sortOrder: 'asc' });
  });

  it('rejects an overlapping active rate for the same user+rate_type+client (409)', async () => {
    const userId = await newUser('cr_dup');
    const first = await request(app)
      .post('/api/v2/commission-rates')
      .set(SA)
      .send({ userId, rateType: 'LOCAL', amount: 40 });
    expect(first.status).toBe(201);
    const dup = await request(app)
      .post('/api/v2/commission-rates')
      .set(SA)
      .send({ userId, rateType: 'LOCAL', amount: 60 });
    expect(dup.status).toBe(409);
    expect(dup.body.error).toBe('COMMISSION_RATE_EXISTS');
    // a DIFFERENT rate_type for the same user is allowed
    const other = await request(app)
      .post('/api/v2/commission-rates')
      .set(SA)
      .send({ userId, rateType: 'OGL', amount: 100 });
    expect(other.status).toBe(201);
  });

  it('revise end-dates the old row and creates a new version; stale version → 409', async () => {
    const userId = await newUser('cr_rev');
    const created = await request(app)
      .post('/api/v2/commission-rates')
      .set(SA)
      .send({ userId, rateType: 'LOCAL', amount: 50 });
    const id = created.body.id as number;

    const revised = await request(app)
      .post(`/api/v2/commission-rates/${id}/revise`)
      .set(SA)
      .send({ amount: 75, version: 1 });
    expect(revised.status).toBe(200);
    expect(revised.body.amount).toBe(75);
    expect(revised.body.id).not.toBe(id); // a NEW dated row

    // the original is now end-dated → current list shows only the new row
    const current = await request(app).get('/api/v2/commission-rates').set(SA);
    expect(current.body.items).toHaveLength(1);
    expect(current.body.items[0].amount).toBe(75);
    const withHistory = await request(app).get('/api/v2/commission-rates?history=true').set(SA);
    expect(withHistory.body.items.length).toBe(2);

    // revising the now-end-dated original again with a stale version → 409
    const stale = await request(app)
      .post(`/api/v2/commission-rates/${id}/revise`)
      .set(SA)
      .send({ amount: 80, version: 1 });
    expect(stale.status).toBe(409);
  });

  it('deactivate (OCC) removes a rate from the active resolver; reactivation allowed', async () => {
    const userId = await newUser('cr_act');
    const created = await request(app)
      .post('/api/v2/commission-rates')
      .set(SA)
      .send({ userId, rateType: 'LOCAL', amount: 50 });
    const id = created.body.id as number;
    const off = await request(app)
      .post(`/api/v2/commission-rates/${id}/deactivate`)
      .set(SA)
      .send({ version: 1 });
    expect(off.status).toBe(200);
    expect(off.body.isActive).toBe(false);
    const on = await request(app)
      .post(`/api/v2/commission-rates/${id}/activate`)
      .set(SA)
      .send({ version: 2 });
    expect(on.status).toBe(200);
    expect(on.body.isActive).toBe(true);
  });

  it('resolveAmount: most-specific-client-wins, temporal, active-only', async () => {
    const userId = await newUser('cr_res');
    const clientId = await newClient('C_RES');
    // universal ₹50 + client-scoped ₹80 for the same user+rate_type (different client scope → no overlap)
    await request(app)
      .post('/api/v2/commission-rates')
      .set(SA)
      .send({ userId, rateType: 'LOCAL', amount: 50 });
    const scoped = await request(app)
      .post('/api/v2/commission-rates')
      .set(SA)
      .send({ userId, rateType: 'LOCAL', clientId, amount: 80 });
    const scopedId = scoped.body.id as number;

    // client-scoped wins for that client
    expect(await commissionRateRepository.resolveAmount(userId, 'LOCAL', clientId)).toBe(80);
    // another client falls back to the universal row
    const otherClient = await newClient('C_OTHER');
    expect(await commissionRateRepository.resolveAmount(userId, 'LOCAL', otherClient)).toBe(50);
    // an unconfigured rate_type → null (assignee has no matching rate)
    expect(await commissionRateRepository.resolveAmount(userId, 'OGL', clientId)).toBeNull();

    // active-only: deactivating the client-scoped row → resolution falls back to the universal one
    expect(
      (
        await request(app)
          .post(`/api/v2/commission-rates/${scopedId}/deactivate`)
          .set(SA)
          .send({ version: 1 })
      ).status,
    ).toBe(200);
    expect(await commissionRateRepository.resolveAmount(userId, 'LOCAL', clientId)).toBe(50);

    // temporal: a future-dated rate is not yet effective → not resolved
    const future = new Date(Date.now() + 7 * 86_400_000).toISOString();
    expect(
      (
        await request(app)
          .post('/api/v2/commission-rates')
          .set(SA)
          .send({ userId, rateType: 'OGL', amount: 120, effectiveFrom: future })
      ).status,
    ).toBe(201);
    expect(await commissionRateRepository.resolveAmount(userId, 'OGL', clientId)).toBeNull();
  });

  it('both read and write require masterdata.manage (SA-only); a masterdata.view-only role is denied', async () => {
    const userId = await newUser('cr_perm');
    // FIELD_AGENT holds neither perm
    const denied = await request(app)
      .post('/api/v2/commission-rates')
      .set(FA)
      .send({ userId, rateType: 'LOCAL', amount: 50 });
    expect(denied.status).toBe(403);
    expect((await request(app).get('/api/v2/commission-rates').set(FA)).status).toBe(403);
    // MANAGER holds masterdata.VIEW but NOT masterdata.manage → commission amounts are hidden (read 403)
    expect((await request(app).get('/api/v2/commission-rates').set(MGR)).status).toBe(403);
  });

  it('validates input: bad userId → 400', async () => {
    const bad = await request(app)
      .post('/api/v2/commission-rates')
      .set(SA)
      .send({ userId: 'not-a-uuid', rateType: 'LOCAL', amount: 50 });
    expect(bad.status).toBe(400);
  });

  describe('import / export', () => {
    const HEADER = ['Username', 'Rate Type', 'Client Code', 'Amount'];
    const mkXlsx = async (rows: (string | number)[][]): Promise<Buffer> => {
      const ExcelJS = (await import('exceljs')).default;
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Sheet1');
      ws.addRow(HEADER);
      for (const r of rows) ws.addRow(r);
      return Buffer.from(await wb.xlsx.writeBuffer());
    };
    const upload = (mode: 'preview' | 'confirm', buf: Buffer, auth = SA) =>
      request(app)
        .post(`/api/v2/commission-rates/import?mode=${mode}`)
        .set(auth)
        .set('content-type', 'application/octet-stream')
        .set('x-filename', 'commission-rates.xlsx')
        .send(buf);

    it('downloads an XLSX template (200 + PK body); template gated masterdata.manage', async () => {
      const res = await request(app)
        .get('/api/v2/commission-rates/import-template')
        .set(SA)
        .buffer(true)
        .parse((r, cb) => {
          const chunks: Buffer[] = [];
          r.on('data', (c: Buffer) => chunks.push(c));
          r.on('end', () => cb(null, Buffer.concat(chunks)));
        });
      expect(res.status).toBe(200);
      expect((res.body as Buffer).subarray(0, 2).toString('latin1')).toBe('PK');
      expect((await request(app).get('/api/v2/commission-rates/import-template').set(MGR)).status).toBe(403);
    });

    it('preview resolves a known username (valid) and flags an unknown one (errorRows)', async () => {
      await newUser('imp_user');
      const res = await upload(
        'preview',
        await mkXlsx([
          ['imp_user', 'LOCAL', '', 70],
          ['nope_user', 'LOCAL', '', 80],
        ]),
      );
      expect(res.status).toBe(200);
      expect(res.body.validRows).toBe(1);
      expect(res.body.errorRows).toBe(1);
      expect(res.body.errors[0]).toMatchObject({ column: 'Username' });
      // preview is read-only — nothing written
      expect((await request(app).get('/api/v2/commission-rates').set(SA)).body.totalCount).toBe(0);
    });

    it('confirm imports the valid row and grows the list', async () => {
      await newUser('imp_user2');
      const res = await upload('confirm', await mkXlsx([['imp_user2', 'OGL', '', 90]]));
      expect(res.status).toBe(200);
      expect(res.body.successRows).toBe(1);
      const list = await request(app).get('/api/v2/commission-rates').set(SA);
      expect(list.body.totalCount).toBe(1);
      expect(list.body.items[0]).toMatchObject({ rateType: 'OGL', amount: 90, clientId: null });
    });

    it('export carries comp data → gated masterdata.manage (SA ok), NOT data.export (TEAM_LEADER 403)', async () => {
      const userId = await newUser('exp_user');
      await request(app)
        .post('/api/v2/commission-rates')
        .set(SA)
        .send({ userId, rateType: 'LOCAL', amount: 50 });
      expect(
        (await request(app).get('/api/v2/commission-rates/export?format=csv&mode=all').set(SA)).status,
      ).toBe(200);
      // TEAM_LEADER holds data.export but NOT masterdata.manage → must be 403 (no comp-data exfil)
      expect(
        (await request(app).get('/api/v2/commission-rates/export?format=csv&mode=all').set(TL)).status,
      ).toBe(403);
    });
  });
});
