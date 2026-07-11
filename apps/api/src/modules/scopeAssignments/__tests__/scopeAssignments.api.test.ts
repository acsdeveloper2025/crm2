import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { createTestDb, authHeaderForRole, clientFactory, verificationUnitFactory } from '@crm2/test-utils';
import { createApp } from '../../../http/app.js';
import { setPool } from '../../../platform/db.js';

const RUN = !!process.env['DATABASE_URL'];
const db = RUN ? createTestDb() : null;
const app = createApp({ enableTestAuth: true });
const SA = authHeaderForRole('SUPER_ADMIN');
const FA = authHeaderForRole('FIELD_AGENT');

const FIELD_USER = '00000000-0000-0000-0000-0000000000e1';
const BACKEND = '00000000-0000-0000-0000-0000000000e2';

async function mkUser(id: string, username: string, role: string): Promise<string> {
  await db!.pool.query(`INSERT INTO users (id, username, name, role) VALUES ($1, $2, $2, $3)`, [
    id,
    username,
    role,
  ]);
  return id;
}

/** Seed one field user + one backend user + two locations + one client. */
async function seed(): Promise<{ p1: number; p2: number; clientId: number }> {
  await mkUser(FIELD_USER, 'scope_fa', 'FIELD_AGENT');
  await mkUser(BACKEND, 'scope_be', 'BACKEND_USER');
  const loc = async (pincode: string, area: string): Promise<number> =>
    (
      await db!.pool.query<{ id: number }>(
        `INSERT INTO locations (pincode, area, city, state, country)
         VALUES ($1, $2, 'Mumbai', 'Maharashtra', 'India') RETURNING id`,
        [pincode, area],
      )
    ).rows[0]!.id;
  const clientId = (
    await request(app)
      .post('/api/v2/clients')
      .set(SA)
      .send(clientFactory({ code: 'SC1' }))
  ).body.id as number;
  return { p1: await loc('400001', 'Fort'), p2: await loc('400002', 'Kalbadevi'), clientId };
}

describe.skipIf(!RUN)('scope assignments API (ADR-0022 slice 3 — generic, role-wired)', () => {
  beforeAll(async () => {
    await db!.migrate();
    setPool(db!.pool);
  });
  afterAll(async () => {
    await db!.end();
  });
  beforeEach(async () => {
    await db!.truncate('user_scope_assignments', 'users', 'locations', 'clients');
  });

  it('assigns PINCODEs to a field user (labels joined), idempotent, bad ref → 400, remove, GET grouped', async () => {
    const { p1, p2 } = await seed();

    const add = await request(app)
      .post(`/api/v2/users/${FIELD_USER}/scope-assignments`)
      .set(SA)
      .send({ dimension: 'PINCODE', entityIds: [p1, p2] });
    expect(add.status).toBe(200);
    expect(add.body.PINCODE).toHaveLength(2);
    expect(add.body.PINCODE[0].label).toContain('400001');
    expect(add.body.PINCODE[0].label).toContain('Mumbai');

    // idempotent re-add (still 2, no 409)
    const again = await request(app)
      .post(`/api/v2/users/${FIELD_USER}/scope-assignments`)
      .set(SA)
      .send({ dimension: 'PINCODE', entityIds: [p1] });
    expect(again.body.PINCODE).toHaveLength(2);

    // a non-existent catalog id → 400 INVALID_REFERENCE, nothing stored
    const bad = await request(app)
      .post(`/api/v2/users/${FIELD_USER}/scope-assignments`)
      .set(SA)
      .send({ dimension: 'PINCODE', entityIds: [999999] });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe('INVALID_REFERENCE');

    // remove one assignment by its row id
    const rowId = add.body.PINCODE.find((x: { entityId: number }) => x.entityId === p1).id as number;
    const rm = await request(app).delete(`/api/v2/users/${FIELD_USER}/scope-assignments/${rowId}`).set(SA);
    expect(rm.body.PINCODE.map((x: { entityId: number }) => x.entityId)).toEqual([p2]);

    const get = await request(app).get(`/api/v2/users/${FIELD_USER}/scope-assignments`).set(SA);
    expect(get.status).toBe(200);
    expect(get.body.PINCODE).toHaveLength(1);
  });

  it('the role wiring governs assignability: CLIENT→field user 400, PINCODE→backend user 400, unknown dim 400, missing user 404', async () => {
    const { p1, clientId } = await seed();

    const denied = await request(app)
      .post(`/api/v2/users/${FIELD_USER}/scope-assignments`)
      .set(SA)
      .send({ dimension: 'CLIENT', entityIds: [clientId] });
    expect(denied.status).toBe(400);
    expect(denied.body.error).toBe('DIMENSION_NOT_ALLOWED_FOR_ROLE');

    const denied2 = await request(app)
      .post(`/api/v2/users/${BACKEND}/scope-assignments`)
      .set(SA)
      .send({ dimension: 'PINCODE', entityIds: [p1] });
    expect(denied2.status).toBe(400);
    expect(denied2.body.error).toBe('DIMENSION_NOT_ALLOWED_FOR_ROLE');

    // the backend user CAN hold CLIENT (their role's wiring)
    const ok = await request(app)
      .post(`/api/v2/users/${BACKEND}/scope-assignments`)
      .set(SA)
      .send({ dimension: 'CLIENT', entityIds: [clientId] });
    expect(ok.status).toBe(200);
    expect(ok.body.CLIENT).toHaveLength(1);

    expect(
      (
        await request(app)
          .post(`/api/v2/users/${FIELD_USER}/scope-assignments`)
          .set(SA)
          .send({ dimension: 'GALAXY', entityIds: [1] })
      ).body.error,
    ).toBe('UNKNOWN_DIMENSION');

    const missing = await request(app)
      .post(`/api/v2/users/00000000-0000-0000-0000-0000000000ff/scope-assignments`)
      .set(SA)
      .send({ dimension: 'PINCODE', entityIds: [p1] });
    expect(missing.status).toBe(404);
    expect(missing.body.error).toBe('USER_NOT_FOUND');
  });

  it('bulk import (template → preview → confirm) + all-assignments export (ADR-0022 slice 8)', async () => {
    const { clientId } = await seed();
    // a second area row for the SAME pincode — a pincode import must assign ALL its rows
    await db!.pool.query(
      `INSERT INTO locations (pincode, area, city, state, country)
       VALUES ('400001', 'Ballard Estate', 'Mumbai', 'Maharashtra', 'India')`,
    );
    const mkXlsx = async (rows: string[][]): Promise<Buffer> => {
      const ExcelJS = (await import('exceljs')).default;
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Sheet1');
      ws.addRow(['Username', 'Dimension', 'Entity']);
      for (const r of rows) ws.addRow(r);
      return Buffer.from(await wb.xlsx.writeBuffer());
    };
    const upload = (mode: string, buf: Buffer) =>
      request(app)
        .post(`/api/v2/users/scope/import?mode=${mode}`)
        .set(SA)
        .set('content-type', 'application/octet-stream')
        .send(buf);

    // template downloads
    const tpl = await request(app)
      .get('/api/v2/users/scope/import-template')
      .set(SA)
      .buffer(true)
      .parse((res2, cb) => {
        const chunks: Buffer[] = [];
        res2.on('data', (c: Buffer) => chunks.push(c));
        res2.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(tpl.status).toBe(200);
    expect((tpl.body as Buffer).subarray(0, 2).toString('latin1')).toBe('PK');

    // preview: a good pincode row, a wrong-role dimension row, an unknown user, an unknown entity
    const file = await mkXlsx([
      ['scope_fa', 'PINCODE', '400001'],
      ['scope_fa', 'CLIENT', 'SC1'], // CLIENT not wired to FIELD_AGENT → row error at PREVIEW
      ['nobody', 'PINCODE', '400001'],
      ['scope_be', 'CLIENT', 'NOPE'],
      ['scope_be', 'CLIENT', 'SC1'], // good (code-resolved)
    ]);
    const preview = await upload('preview', file);
    expect(preview.status).toBe(200);
    expect(preview.body).toMatchObject({ totalRows: 5, validRows: 2, errorRows: 3 });

    // confirm writes only the good rows; the 400001 pincode resolves to BOTH its area rows
    const confirm = await upload('confirm', file);
    expect(confirm.body).toMatchObject({ totalRows: 5, successRows: 2, failedRows: 3 });
    const fa = await request(app).get(`/api/v2/users/${FIELD_USER}/scope-assignments`).set(SA);
    expect(fa.body.PINCODE).toHaveLength(2);
    const be = await request(app).get(`/api/v2/users/${BACKEND}/scope-assignments`).set(SA);
    expect(be.body.CLIENT).toHaveLength(1);
    expect(clientId).toBe(be.body.CLIENT[0].entityId);

    // export streams every assignment as xlsx
    const exp = await request(app)
      .get('/api/v2/users/scope/export?mode=all&format=xlsx')
      .set(SA)
      .buffer(true)
      .parse((res2, cb) => {
        const chunks: Buffer[] = [];
        res2.on('data', (c: Buffer) => chunks.push(c));
        res2.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(exp.status).toBe(200);
    expect((exp.body as Buffer).subarray(0, 2).toString('latin1')).toBe('PK');

    // import AND export are gated by access_scope.assign — the export dumps the whole access
    // topology, so a MANAGER (who holds data.export) must still be refused
    expect(
      (
        await request(app)
          .post('/api/v2/users/scope/import?mode=preview')
          .set({ 'x-test-auth': 'MANAGER:00000000-0000-0000-0000-0000000000cc' })
          .send(file)
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .get('/api/v2/users/scope/export?mode=all&format=xlsx')
          .set({ 'x-test-auth': 'MANAGER:00000000-0000-0000-0000-0000000000cc' })
      ).status,
    ).toBe(403);
  });

  it('template teaches every dimension: 4 sample rows + a Notes sheet with the LIVE role wiring (owner 2026-07-11)', async () => {
    const tpl = await request(app)
      .get('/api/v2/users/scope/import-template')
      .set(SA)
      .buffer(true)
      .parse((res2, cb) => {
        const chunks: Buffer[] = [];
        res2.on('data', (c: Buffer) => chunks.push(c));
        res2.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(tpl.status).toBe(200);
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(tpl.body as Buffer as unknown as Parameters<typeof wb.xlsx.load>[0]);

    // Sheet 1 "Template": bold header + one sample row PER dimension, each showing its Entity form.
    const ws = wb.worksheets[0]!;
    const cell = (r: number, c: number) => {
      const v = ws.getRow(r).getCell(c).value;
      return v == null ? '' : String(v);
    };
    expect([cell(1, 1), cell(1, 2), cell(1, 3)]).toEqual(['Username', 'Dimension', 'Entity']);
    const samples = [2, 3, 4, 5].map((r) => [cell(r, 1), cell(r, 2), cell(r, 3)]);
    expect(samples).toEqual([
      ['jdoe', 'PINCODE', '400001'],
      ['jdoe', 'AREA', '400001:FORT'],
      ['asmith', 'CLIENT', 'HDFC'],
      ['asmith', 'PRODUCT', 'HOME_LOAN'],
    ]);

    // Sheet 2 "Notes": generated from the LIVE role wiring + entity-format hints + the KYC pointer.
    const notes = wb.worksheets.find((w) => w.name === 'Notes');
    expect(notes).toBeDefined();
    const text: string[] = [];
    notes!.eachRow((row) => text.push(String(row.getCell(1).value ?? '')));
    const all = text.join('\n');
    expect(all).toContain('FIELD_AGENT: AREA, PINCODE'); // live wiring, not a hardcoded list
    expect(all).toContain('BACKEND_USER: CLIENT, PRODUCT');
    expect(all).toContain('KYC verifiers are scoped by verification unit');
    expect(all).toContain('PINCODE:AREA'); // the AREA entity form is spelled out
    expect(all).toContain('CSV works too');

    // The template itself re-imports cleanly through the parser (Notes sheet ignored): the sample
    // usernames don't exist so every row errors, but they are ROW errors — not a parse failure.
    const again = await request(app)
      .post('/api/v2/users/scope/import?mode=preview')
      .set(SA)
      .set('content-type', 'application/octet-stream')
      .send(tpl.body as Buffer);
    expect(again.status).toBe(200);
    expect(again.body.totalRows).toBe(4);
    expect(again.body.errorRows).toBe(4); // unknown sample usernames — per-row, never a crash
  });

  describe('role-shaped scope workbook (owner 2026-07-11)', () => {
    const KYC = '00000000-0000-0000-0000-0000000000e3';
    const wbUpload = (mode: string, buf: Buffer) =>
      request(app)
        .post(`/api/v2/users/scope/workbook-import?mode=${mode}`)
        .set(SA)
        .set('content-type', 'application/octet-stream')
        .send(buf);
    /** Build a workbook with the 3 named sheets (any subset). */
    const mkWorkbook = async (sheets: Record<string, string[][]>): Promise<Buffer> => {
      const ExcelJS = (await import('exceljs')).default;
      const wb = new ExcelJS.Workbook();
      const HEADERS: Record<string, string[]> = {
        'Field Agents': ['Username', 'Pincode', 'Area'],
        'Backend Users': ['Username', 'Client Code', 'Product Code'],
        'KYC Users': ['Username', 'Unit Code'],
      };
      for (const [name, rows] of Object.entries(sheets)) {
        const ws = wb.addWorksheet(name);
        ws.addRow(HEADERS[name]!);
        for (const r of rows) ws.addRow(r);
      }
      return Buffer.from(await wb.xlsx.writeBuffer());
    };
    const seedUnit = async (code: string): Promise<number> => {
      const res = await request(app)
        .post('/api/v2/verification-units')
        .set(SA)
        .send(verificationUnitFactory({ code }));
      expect(res.status).toBe(201);
      return res.body.id as number;
    };

    it('template = 3 role sheets with per-shape samples + a Notes sheet from live wiring', async () => {
      const tpl = await request(app)
        .get('/api/v2/users/scope/workbook-template')
        .set(SA)
        .buffer(true)
        .parse((res2, cb) => {
          const chunks: Buffer[] = [];
          res2.on('data', (c: Buffer) => chunks.push(c));
          res2.on('end', () => cb(null, Buffer.concat(chunks)));
        });
      expect(tpl.status).toBe(200);
      const ExcelJS = (await import('exceljs')).default;
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(tpl.body as Buffer as unknown as Parameters<typeof wb.xlsx.load>[0]);
      expect(wb.worksheets.map((w) => w.name)).toEqual([
        'Field Agents',
        'Backend Users',
        'KYC Users',
        'Notes',
      ]);
      const cell = (ws: (typeof wb.worksheets)[0], r: number, c: number) => {
        const v = ws.getRow(r).getCell(c).value;
        return v == null ? '' : String(v);
      };
      // Every sheet carries a trailing guidance column the importer ignores (owner 2026-07-11:
      // the meaning must be ON the sheet, not only the Notes tab).
      const GUIDE = 'How this sheet works (leave this column as-is)';
      const field = wb.worksheets[0]!;
      expect([cell(field, 1, 1), cell(field, 1, 2), cell(field, 1, 3), cell(field, 1, 4)]).toEqual([
        'Username',
        'Pincode',
        'Area',
        GUIDE,
      ]);
      expect([cell(field, 2, 2), cell(field, 2, 3)]).toEqual(['400001', '']); // whole-pincode sample
      expect(cell(field, 2, 4)).toContain('ALL areas'); // the blank-Area meaning, on the row itself
      expect([cell(field, 3, 2), cell(field, 3, 3)]).toEqual(['400001', 'FORT']); // one-area sample
      expect(cell(field, 3, 4)).toContain('only that one area');
      const backend = wb.worksheets[1]!;
      expect([cell(backend, 1, 1), cell(backend, 1, 2), cell(backend, 1, 3), cell(backend, 1, 4)]).toEqual([
        'Username',
        'Client Code',
        'Product Code',
        GUIDE,
      ]);
      expect(cell(backend, 2, 4)).toContain('one assignment');
      const kyc = wb.worksheets[2]!;
      expect([cell(kyc, 1, 1), cell(kyc, 1, 2), cell(kyc, 1, 3)]).toEqual(['Username', 'Unit Code', GUIDE]);
      expect(cell(kyc, 2, 3)).toContain('ADDS to existing grants');
      const notes: string[] = [];
      wb.worksheets[3]!.eachRow((row) => notes.push(String(row.getCell(1).value ?? '')));
      const all = notes.join('\n');
      expect(all).toContain('For roles: FIELD_AGENT'); // live wiring, not hardcoded
      expect(all).toContain('For roles: BACKEND_USER');
      expect(all).toContain('For role: KYC_VERIFIER'); // office-pool role, data-driven

      // The guidance column + Notes sheet never break a re-upload: previewing the template itself
      // parses fine (sample usernames are unknown → row errors, never a parse failure).
      const again = await wbUpload('preview', tpl.body as Buffer);
      expect(again.status).toBe(200);
      const total = (again.body.sheets as { totalRows: number; errorRows: number }[]).reduce(
        (n, s) => n + s.totalRows,
        0,
      );
      expect(total).toBe(5); // 2 field + 2 backend + 1 kyc sample rows
    });

    it('imports all three sheets in one upload; role-mismatched rows fail per-row; KYC grant lands additively', async () => {
      await seed();
      await mkUser(KYC, 'scope_kyc', 'KYC_VERIFIER');
      const unitId = await seedUnit('WBUNIT');
      // pre-existing grant that a partial import must NOT revoke (add ≠ replace semantics)
      const otherUnit = await seedUnit('WBKEEP');
      await request(app)
        .put(`/api/v2/users/${KYC}/kyc-units`)
        .set(SA)
        .send({ unitIds: [otherUnit] });

      const wb = await mkWorkbook({
        'Field Agents': [
          ['scope_fa', '400001', ''], // whole pincode
          ['scope_fa', '400002', 'Kalbadevi'], // one area
          ['scope_be', '400001', ''], // backend user on the field sheet → row error
        ],
        'Backend Users': [
          ['scope_be', 'SC1', ''], // client only
          ['scope_kyc', 'SC1', ''], // kyc user on the backend sheet → row error
        ],
        'KYC Users': [
          ['scope_kyc', 'WBUNIT'],
          ['scope_fa', 'WBUNIT'], // field agent on the kyc sheet → row error
        ],
      });

      const preview = await wbUpload('preview', wb);
      expect(preview.status).toBe(200);
      const byName = Object.fromEntries(
        (preview.body.sheets as { name: string; validRows: number; errorRows: number }[]).map((s) => [
          s.name,
          s,
        ]),
      );
      expect(byName['Field Agents']).toMatchObject({ validRows: 2, errorRows: 1 });
      expect(byName['Backend Users']).toMatchObject({ validRows: 1, errorRows: 1 });
      expect(byName['KYC Users']).toMatchObject({ validRows: 1, errorRows: 1 });

      const confirm = await wbUpload('confirm', wb);
      expect(confirm.status).toBe(200);
      const cByName = Object.fromEntries(
        (confirm.body.sheets as { name: string; successRows: number; failedRows: number }[]).map((s) => [
          s.name,
          s,
        ]),
      );
      expect(cByName['Field Agents']).toMatchObject({ successRows: 2, failedRows: 1 });
      expect(cByName['Backend Users']).toMatchObject({ successRows: 1, failedRows: 1 });
      expect(cByName['KYC Users']).toMatchObject({ successRows: 1, failedRows: 1 });

      // landed: field agent has the pincode (all areas) + the one area; backend has the client
      const fa = await request(app).get(`/api/v2/users/${FIELD_USER}/scope-assignments`).set(SA);
      expect(fa.body.PINCODE).toHaveLength(1);
      expect(fa.body.AREA).toHaveLength(1);
      const be = await request(app).get(`/api/v2/users/${BACKEND}/scope-assignments`).set(SA);
      expect(be.body.CLIENT).toHaveLength(1);
      // KYC grant ADDED — the pre-existing grant survives (additive, not replace)
      const ku = await request(app).get(`/api/v2/users/${KYC}/kyc-units`).set(SA);
      expect(ku.body.grantedUnitIds.sort()).toEqual([unitId, otherUnit].sort());
    });

    it('a CSV carrying ONE sheet’s headers routes to that sheet; unknown headers → 400', async () => {
      await seed();
      const csv = ['Username,Pincode,Area', 'scope_fa,400002,Kalbadevi'].join('\n');
      const res = await wbUpload('confirm', Buffer.from(csv, 'utf8'));
      expect(res.status).toBe(200);
      expect(res.body.sheets).toHaveLength(1);
      expect(res.body.sheets[0]).toMatchObject({ name: 'Field Agents', successRows: 1 });
      const bad = await wbUpload('preview', Buffer.from('Foo,Bar\n1,2', 'utf8'));
      expect(bad.status).toBe(400);
      expect(bad.body.error).toBe('UNKNOWN_SCOPE_SHEET');
    });
  });

  it('export round-trips through import (IE-DEFER-6): exported file re-imports with 0 errors', async () => {
    const { p1, p2, clientId } = await seed();
    // a second area row for 400001 — so a PINCODE assignment spans >1 location id
    await db!.pool.query(
      `INSERT INTO locations (pincode, area, city, state, country)
       VALUES ('400001', 'Ballard Estate', 'Mumbai', 'Maharashtra', 'India')`,
    );

    // Assign every code-path the importer parses back: PINCODE (bare pincode) + AREA (pincode:area)
    // to the field user, CLIENT (catalog code) to the backend user.
    await request(app)
      .post(`/api/v2/users/${FIELD_USER}/scope-assignments`)
      .set(SA)
      .send({ dimension: 'PINCODE', entityIds: [p1] });
    await request(app)
      .post(`/api/v2/users/${FIELD_USER}/scope-assignments`)
      .set(SA)
      .send({ dimension: 'AREA', entityIds: [p2] });
    await request(app)
      .post(`/api/v2/users/${BACKEND}/scope-assignments`)
      .set(SA)
      .send({ dimension: 'CLIENT', entityIds: [clientId] });

    // 1) export the whole topology as xlsx
    const exported = await request(app)
      .get('/api/v2/users/scope/export?mode=all&format=xlsx')
      .set(SA)
      .buffer(true)
      .parse((res2, cb) => {
        const chunks: Buffer[] = [];
        res2.on('data', (c: Buffer) => chunks.push(c));
        res2.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(exported.status).toBe(200);

    // 2) parse the exported workbook back into header + rows
    const ExcelJS = (await import('exceljs')).default;
    const wbIn = new ExcelJS.Workbook();
    // exceljs ships an older @types/node Buffer; the value IS a valid Node Buffer — bridge the skew.
    await wbIn.xlsx.load(exported.body as unknown as Parameters<typeof wbIn.xlsx.load>[0]);
    const ws = wbIn.worksheets[0]!;
    const header = (ws.getRow(1).values as unknown[]).slice(1).map((v) => String(v));
    const grid: string[][] = [];
    for (let r = 2; r <= ws.rowCount; r++) {
      grid.push((ws.getRow(r).values as unknown[]).slice(1).map((v) => (v == null ? '' : String(v))));
    }
    // every code path is represented, exactly the rows we assigned
    expect(grid).toHaveLength(3);
    const entityCol = header.indexOf('Entity');
    const dimCol = header.indexOf('Dimension');
    const cellsByDim = new Map(grid.map((row) => [row[dimCol], row[entityCol]]));
    expect(cellsByDim.get('PINCODE')).toBe('400001'); // bare pincode, NOT "400001 — Fort, Mumbai"
    expect(cellsByDim.get('AREA')).toBe('400002:Kalbadevi'); // pincode:area form
    expect(cellsByDim.get('CLIENT')).toBe('SC1'); // catalog code, NOT the client display name

    // 3) rebuild a workbook from the exported header+rows and feed it back to the import PREVIEW
    const wbOut = new ExcelJS.Workbook();
    const wsOut = wbOut.addWorksheet('Sheet1');
    wsOut.addRow(header);
    for (const row of grid) wsOut.addRow(row);
    const reimport = Buffer.from(await wbOut.xlsx.writeBuffer());

    const preview = await request(app)
      .post('/api/v2/users/scope/import?mode=preview')
      .set(SA)
      .set('content-type', 'application/octet-stream')
      .send(reimport);
    expect(preview.status).toBe(200);
    // the exported file is a valid import: every row resolves, zero errors
    expect(preview.body).toMatchObject({ totalRows: 3, validRows: 3, errorRows: 0 });
    expect(preview.body.errors).toHaveLength(0);
  });

  it('only SUPER_ADMIN may assign (MANAGER/TEAM_LEADER/FIELD_AGENT → 403, unauth → 401); non-uuid id → 400', async () => {
    await seed();
    const path = `/api/v2/users/${FIELD_USER}/scope-assignments`;
    for (const role of ['MANAGER', 'TEAM_LEADER'] as const) {
      expect(
        (
          await request(app)
            .get(path)
            .set({ 'x-test-auth': `${role}:00000000-0000-0000-0000-0000000000cc` })
        ).status,
      ).toBe(403);
    }
    expect((await request(app).get(path).set(FA)).status).toBe(403);
    expect((await request(app).get(path)).status).toBe(401);
    expect((await request(app).get('/api/v2/users/not-a-uuid/scope-assignments').set(SA)).status).toBe(400);
    expect((await request(app).get(path).set(SA)).status).toBe(200);
  });
});
