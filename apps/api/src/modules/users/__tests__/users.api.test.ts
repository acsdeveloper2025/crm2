import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createTestDb, userFactory, authHeaderForRole } from '@crm2/test-utils';
import { createApp } from '../../../http/app.js';
import { setPool } from '../../../platform/db.js';
import { setStorage, type StorageProvider } from '../../../platform/storage/index.js';
import { setMailer } from '../../../platform/mail/index.js';

const RUN = !!process.env['DATABASE_URL'];
const db = RUN ? createTestDb() : null;
const app = createApp({ enableTestAuth: true });
const SA = authHeaderForRole('SUPER_ADMIN');
const BE = authHeaderForRole('BACKEND_USER');
const RANDOM_UUID = '11111111-1111-1111-1111-111111111111';

const newUser = async (over = {}) =>
  (await request(app).post('/api/v2/users').set(SA).send(userFactory(over))).body;

describe.skipIf(!RUN)('users API', () => {
  beforeAll(async () => {
    await db!.migrate();
    setPool(db!.pool);
  });
  afterAll(async () => {
    await db!.end();
  });
  beforeEach(async () => {
    await db!.truncate('users', 'designations', 'departments', 'import_log');
  });

  it('creates a user (201) and lists it with the joined manager name', async () => {
    const mgr = await newUser({ username: 'mgr_a', name: 'Manager A', role: 'MANAGER' });
    const created = await request(app)
      .post('/api/v2/users')
      .set(SA)
      .send(userFactory({ username: 'fa_a', name: 'Agent A', role: 'FIELD_AGENT', reportsTo: mgr.id }));
    expect(created.status).toBe(201);
    expect(created.body.username).toBe('fa_a');
    expect(created.body.role).toBe('FIELD_AGENT');
    expect(created.body.isActive).toBe(true);

    const list = await request(app).get('/api/v2/users').set(SA);
    expect(list.status).toBe(200);
    // §4 pagination envelope (PAGINATION_AND_LOADING_STANDARDS).
    expect(list.body.totalCount).toBe(2);
    expect(list.body.page).toBe(1);
    expect(list.body.pageSize).toBe(25); // default
    expect(list.body.sort).toEqual({ sortBy: 'name', sortOrder: 'asc' });
    const agent = list.body.items.find((u: { username: string }) => u.username === 'fa_a');
    expect(agent.reportsToName).toBe('Manager A');
    expect(agent.effectiveFrom).toBeTruthy(); // list must return effective_from (column render)
  });

  it('rejects an invalid username (400 VALIDATION)', async () => {
    const res = await request(app)
      .post('/api/v2/users')
      .set(SA)
      .send({ username: 'AB', name: 'X', role: 'FIELD_AGENT' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION');
  });

  it('rejects a bad role: malformed shape → 400 VALIDATION; unknown code → 400 INVALID_REFERENCE (FK)', async () => {
    // open role catalog (ADR-0022): zod checks the SHAPE, the users.role FK checks EXISTENCE
    const malformed = await request(app)
      .post('/api/v2/users')
      .set(SA)
      .send({ username: 'role_x', name: 'X', role: 'admin' });
    expect(malformed.status).toBe(400);
    expect(malformed.body.error).toBe('VALIDATION');
    const unknown = await request(app)
      .post('/api/v2/users')
      .set(SA)
      .send({ username: 'role_x', name: 'X', role: 'GHOST_ROLE' });
    expect(unknown.status).toBe(400);
    expect(unknown.body.error).toBe('INVALID_REFERENCE');
  });

  it('duplicate username → 409 USER_EXISTS', async () => {
    await newUser({ username: 'dup_user' });
    const dup = await request(app)
      .post('/api/v2/users')
      .set(SA)
      .send(userFactory({ username: 'dup_user' }));
    expect(dup.status).toBe(409);
    expect(dup.body.error).toBe('USER_EXISTS');
  });

  it('unknown manager reference → 400 INVALID_REFERENCE', async () => {
    const res = await request(app)
      .post('/api/v2/users')
      .set(SA)
      .send(userFactory({ username: 'orphan', reportsTo: RANDOM_UUID }));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_REFERENCE');
  });

  it('update changes role/name/manager; username unchanged when omitted + bumps version', async () => {
    const u = await newUser({ username: 'edit_me', name: 'Before', role: 'FIELD_AGENT' });
    expect(u.version).toBe(1);
    const upd = await request(app)
      .put(`/api/v2/users/${u.id}`)
      .set(SA)
      .send({ name: 'After', role: 'TEAM_LEADER', version: u.version });
    expect(upd.status).toBe(200);
    expect(upd.body.username).toBe('edit_me');
    expect(upd.body.name).toBe('After');
    expect(upd.body.role).toBe('TEAM_LEADER');
    expect(upd.body.version).toBe(2); // OCC token bumped by exactly 1
  });

  it('a user cannot be their own manager → 400 INVALID_MANAGER', async () => {
    const u = await newUser({ username: 'self_mgr' });
    const upd = await request(app)
      .put(`/api/v2/users/${u.id}`)
      .set(SA)
      .send({ name: u.name, role: u.role, reportsTo: u.id, version: u.version });
    expect(upd.status).toBe(400);
    expect(upd.body.error).toBe('INVALID_MANAGER');
  });

  it('a malformed id is rejected (400 BAD_REQUEST)', async () => {
    const res = await request(app)
      .put('/api/v2/users/not-a-uuid')
      .set(SA)
      .send({ name: 'X', role: 'FIELD_AGENT' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('BAD_REQUEST');
  });

  it('BACKEND_USER cannot read or write users (403)', async () => {
    expect((await request(app).get('/api/v2/users').set(BE)).status).toBe(403);
    const create = await request(app)
      .post('/api/v2/users')
      .set(BE)
      .send(userFactory({ username: 'denied' }));
    expect(create.status).toBe(403);
  });

  it('unauthenticated request is 401', async () => {
    expect((await request(app).get('/api/v2/users')).status).toBe(401);
  });

  // ── ADR-0020: username is a login rename (no FK deps); uniqueness-checked ──
  it('renames the username on edit; a duplicate → 409 USER_EXISTS', async () => {
    const u = await newUser({ username: 'tyop_name', name: 'Typo', role: 'FIELD_AGENT' });
    const fix = await request(app)
      .put(`/api/v2/users/${u.id}`)
      .set(SA)
      .send({ username: 'typo_name', name: 'Typo', role: 'FIELD_AGENT', version: u.version });
    expect(fix.status).toBe(200);
    expect(fix.body.username).toBe('typo_name');
    expect(fix.body.version).toBe(2);

    const other = await newUser({ username: 'other_one', name: 'Other', role: 'FIELD_AGENT' });
    const dup = await request(app)
      .put(`/api/v2/users/${other.id}`)
      .set(SA)
      .send({ username: 'typo_name', name: 'Other', role: 'FIELD_AGENT', version: other.version });
    expect(dup.status).toBe(409);
    expect(dup.body.error).toBe('USER_EXISTS');
  });

  // ── B-22 options endpoint (unpaginated USABLE feed for the reports-to picker) ──
  it('GET /options returns USABLE users only as a flat {id,username,name,role} array (B-22)', async () => {
    await newUser({ username: 'usable_one', name: 'Usable One', role: 'MANAGER' });
    const off = await newUser({ username: 'inactive_one', name: 'Inactive One', role: 'FIELD_AGENT' });
    await request(app).post(`/api/v2/users/${off.id}/deactivate`).set(SA).send({ version: off.version });
    const future = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
    await newUser({ username: 'future_one', name: 'Future One', role: 'FIELD_AGENT', effectiveFrom: future });

    const res = await request(app).get('/api/v2/users/options').set(SA);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true); // flat array, NOT a pagination envelope
    const names = res.body.map((o: { username: string }) => o.username);
    expect(names).toContain('usable_one');
    expect(names).not.toContain('inactive_one'); // inactive excluded
    expect(names).not.toContain('future_one'); // future-dated excluded (ADR-0017)
    expect(Object.keys(res.body[0]).sort()).toEqual(['id', 'name', 'role', 'username']); // trimmed shape
  });

  it('GET /options requires auth (401); BACKEND_USER is denied (403)', async () => {
    expect((await request(app).get('/api/v2/users/options')).status).toBe(401);
    expect((await request(app).get('/api/v2/users/options').set(BE)).status).toBe(403);
  });

  // ── column filters (DATAGRID_STANDARD §6/§7) ──
  it('f_name (text) and f_role (enum, multi) filter the list and combine with AND', async () => {
    await newUser({ username: 'mgr_x', name: 'Xavier Manager', role: 'MANAGER' });
    await newUser({ username: 'fa_x', name: 'Xavier Agent', role: 'FIELD_AGENT' });
    await newUser({ username: 'tl_y', name: 'Yusuf Lead', role: 'TEAM_LEADER' });

    const byName = await request(app).get('/api/v2/users?f_name=xavier').set(SA);
    expect(byName.body.items.map((u: { username: string }) => u.username).sort()).toEqual(['fa_x', 'mgr_x']);
    expect(byName.body.filters.f_name).toBe('xavier');

    // enum multi-select → IN
    const byRoles = await request(app).get('/api/v2/users?f_role=MANAGER,TEAM_LEADER').set(SA);
    expect(byRoles.body.items.map((u: { username: string }) => u.username).sort()).toEqual(['mgr_x', 'tl_y']);

    // AND: name~xavier AND role=MANAGER → only mgr_x
    const combined = await request(app).get('/api/v2/users?f_name=xavier&f_role=MANAGER').set(SA);
    expect(combined.body.items.map((u: { username: string }) => u.username)).toEqual(['mgr_x']);
  });

  it('activate / deactivate toggles is_active (version-guarded, each bumps version)', async () => {
    const u = await newUser({ username: 'toggle_me' });
    const off = await request(app)
      .post(`/api/v2/users/${u.id}/deactivate`)
      .set(SA)
      .send({ version: u.version });
    expect(off.body.isActive).toBe(false);
    expect(off.body.version).toBe(2);
    const on = await request(app)
      .post(`/api/v2/users/${u.id}/activate`)
      .set(SA)
      .send({ version: off.body.version });
    expect(on.body.isActive).toBe(true);
    expect(on.body.version).toBe(3);
  });

  // ── OCC contract (ADR-0019 / CONCURRENCY_AND_EDITING_STANDARD §6) ──
  it('update without a version → 400 VERSION_REQUIRED', async () => {
    const u = await newUser({ username: 'needs_ver' });
    const res = await request(app)
      .put(`/api/v2/users/${u.id}`)
      .set(SA)
      .send({ name: 'X', role: 'FIELD_AGENT' }); // no version
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VERSION_REQUIRED');
  });

  it('update a non-existent id (valid uuid) with a version → 404 USER_NOT_FOUND', async () => {
    const res = await request(app)
      .put(`/api/v2/users/${RANDOM_UUID}`)
      .set(SA)
      .send({ name: 'X', role: 'FIELD_AGENT', version: 1 });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('USER_NOT_FOUND');
  });

  it('concurrent edit: second writer at a stale version → 409 STALE_UPDATE with current; re-read succeeds', async () => {
    const u = await newUser({ username: 'race_me', name: 'V1', role: 'FIELD_AGENT' });
    // writer A saves first (v1 → v2)
    const a = await request(app)
      .put(`/api/v2/users/${u.id}`)
      .set(SA)
      .send({ name: 'A-edit', role: 'FIELD_AGENT', version: 1 });
    expect(a.status).toBe(200);
    expect(a.body.version).toBe(2);
    // writer B still holds v1 → conflict
    const b = await request(app)
      .put(`/api/v2/users/${u.id}`)
      .set(SA)
      .send({ name: 'B-edit', role: 'FIELD_AGENT', version: 1 });
    expect(b.status).toBe(409);
    expect(b.body.error).toBe('STALE_UPDATE');
    expect(b.body.current.version).toBe(2); // fresh row returned so the client can reconcile
    expect(b.body.current.name).toBe('A-edit');
    // B reloads to v2 and re-applies → succeeds
    const b2 = await request(app)
      .put(`/api/v2/users/${u.id}`)
      .set(SA)
      .send({ name: 'B-edit', role: 'FIELD_AGENT', version: b.body.current.version });
    expect(b2.status).toBe(200);
    expect(b2.body.version).toBe(3);
    expect(b2.body.name).toBe('B-edit');
  });

  it('every create/update appends exactly one immutable audit_log row (actor + action)', async () => {
    const u = await newUser({ username: 'audited' });
    await request(app)
      .put(`/api/v2/users/${u.id}`)
      .set(SA)
      .send({ name: 'Changed', role: u.role, version: u.version });
    const { rows } = await db!.pool.query(
      `SELECT action, version_after FROM audit_log
       WHERE entity_type = 'users' AND entity_id = $1 ORDER BY id`,
      [u.id],
    );
    expect(rows.map((r) => r.action)).toEqual(['CREATE', 'UPDATE']);
    expect(rows[1].version_after).toBe(2);
    // audit_log is append-only — a direct UPDATE is rejected at the DB
    await expect(
      db!.pool.query(`UPDATE audit_log SET action = 'X' WHERE entity_id = $1`, [u.id]),
    ).rejects.toThrow();
  });

  // ── Pagination contract (PAGINATION_AND_LOADING_STANDARDS §1/§4) ──
  it('paginates: page/limit slice the result set and totals are correct', async () => {
    for (const username of ['pa_x', 'pb_x', 'pc_x']) {
      await newUser({ username, name: username });
    }
    const p1 = await request(app).get('/api/v2/users?limit=2&page=1&sortBy=name&sortOrder=asc').set(SA);
    expect(p1.body.items.map((u: { username: string }) => u.username)).toEqual(['pa_x', 'pb_x']);
    expect(p1.body.totalCount).toBe(3);
    expect(p1.body.pageSize).toBe(2);
    expect(p1.body.totalPages).toBe(2);
    const p2 = await request(app).get('/api/v2/users?limit=2&page=2&sortBy=name&sortOrder=asc').set(SA);
    expect(p2.body.items.map((u: { username: string }) => u.username)).toEqual(['pc_x']);
    expect(p2.body.page).toBe(2);
  });

  it('server sorting: sortBy=username desc orders by the whitelisted column', async () => {
    await newUser({ username: 'aaa_user', name: 'AAA' });
    await newUser({ username: 'zzz_user', name: 'ZZZ' });
    const res = await request(app).get('/api/v2/users?sortBy=username&sortOrder=desc').set(SA);
    expect(res.body.items[0].username).toBe('zzz_user');
    expect(res.body.sort).toEqual({ sortBy: 'username', sortOrder: 'desc' });
  });

  it('global search filters by username/name and echoes the filter', async () => {
    await newUser({ username: 'kotak_user', name: 'Kotak Person' });
    await newUser({ username: 'yes_user', name: 'Yes Person' });
    const res = await request(app).get('/api/v2/users?search=kotak').set(SA);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].username).toBe('kotak_user');
    expect(res.body.filters.search).toBe('kotak');
  });

  it('rejects limit > 500 with 400 LIMIT_TOO_LARGE (gate 41)', async () => {
    const res = await request(app).get('/api/v2/users?limit=501').set(SA);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('LIMIT_TOO_LARGE');
  });

  it('unknown sortBy falls back to the default sort (no SQL injection surface)', async () => {
    await newUser({ username: 'safe_user' });
    const res = await request(app).get('/api/v2/users?sortBy=name;DROP TABLE users').set(SA);
    expect(res.status).toBe(200);
    expect(res.body.sort.sortBy).toBe('name'); // default, not the injection string
  });

  // ── B-13 DataGrid export (IMPORT_EXPORT_STANDARD) ──
  describe('export', () => {
    const FA = authHeaderForRole('FIELD_AGENT');

    it('exports the current view as CSV (200 + headers + rows)', async () => {
      const mgr = await newUser({ username: 'exp_mgr', name: 'Export Manager', role: 'MANAGER' });
      await newUser({ username: 'exp_fa', name: 'Export Agent', role: 'FIELD_AGENT', reportsTo: mgr.id });
      const res = await request(app).get('/api/v2/users/export?format=csv&mode=current').set(SA);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.headers['content-disposition']).toMatch(/attachment; filename="users-\d{8}\.csv"/);
      expect(res.text.split('\r\n')[0]).toBe(
        'Employee ID,Username,Name,Phone,Role,Department,Designation,Reports To,Effective From,Created,Updated,Status',
      );
      expect(res.text).toContain('exp_fa,Export Agent,');
      expect(res.text).toContain('FIELD AGENT');
      expect(res.text).toContain('Export Manager');
    });

    it('exports all matching as XLSX (200 + PK-zip body)', async () => {
      await newUser({ username: 'exp_all' });
      const res = await request(app)
        .get('/api/v2/users/export?format=xlsx&mode=all')
        .set(SA)
        .buffer(true)
        .parse((r, cb) => {
          const chunks: Buffer[] = [];
          r.on('data', (c: Buffer) => chunks.push(c));
          r.on('end', () => cb(null, Buffer.concat(chunks)));
        });
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('spreadsheetml');
      expect((res.body as Buffer).subarray(0, 2).toString('latin1')).toBe('PK');
    });

    it('respects the visible columns (cols) selection', async () => {
      await newUser({ username: 'exp_cols', name: 'Cols User' });
      const res = await request(app)
        .get('/api/v2/users/export?format=csv&mode=all&cols=username,status')
        .set(SA);
      expect(res.text.split('\r\n')[0]).toBe('Username,Status');
    });

    it('mode=selected exports only the ticked ids (not the whole list)', async () => {
      const a = (await newUser({ username: 'sel_a', name: 'Sel A' })) as { id: string };
      await newUser({ username: 'sel_b', name: 'Sel B' });
      const res = await request(app).get(`/api/v2/users/export?format=csv&mode=selected&ids=${a.id}`).set(SA);
      expect(res.status).toBe(200);
      const rows = res.text.split('\r\n');
      expect(rows[0]).toBe(
        'Employee ID,Username,Name,Phone,Role,Department,Designation,Reports To,Effective From,Created,Updated,Status',
      );
      expect(res.text).toContain('sel_a');
      expect(res.text).not.toContain('sel_b'); // the unticked row is excluded
    });

    it('mode=selected with no ids exports nothing (never falls through to all)', async () => {
      await newUser({ username: 'no_ids', name: 'No Ids' });
      const res = await request(app).get('/api/v2/users/export?format=csv&mode=selected').set(SA);
      expect(res.status).toBe(200);
      expect(res.text.split('\r\n')).toHaveLength(1); // header only, zero data rows
    });

    it('rejects an unknown format with 400', async () => {
      const res = await request(app).get('/api/v2/users/export?format=pdf').set(SA);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('BAD_EXPORT_FORMAT');
    });

    it('a role without data.export cannot export (403)', async () => {
      expect((await request(app).get('/api/v2/users/export').set(FA)).status).toBe(403);
    });

    it('unauthenticated export is 401', async () => {
      expect((await request(app).get('/api/v2/users/export')).status).toBe(401);
    });

    it('BACKEND_USER (has data.export) can export (200)', async () => {
      expect((await request(app).get('/api/v2/users/export?format=csv').set(BE)).status).toBe(200);
    });
  });

  // ── bulk activate/deactivate (per-row OCC, CONCURRENCY_AND_EDITING_STANDARD §1) — uuid ids ──
  describe('bulk', () => {
    const FA = authHeaderForRole('FIELD_AGENT');
    const BOGUS_UUID = '00000000-0000-0000-0000-0000000000ff';
    const mk = async (username: string) => (await newUser({ username })) as { id: string; version: number };

    it('bulk-deactivate applies per-row and reports all OK', async () => {
      const a = await mk('bulk_a');
      const b = await mk('bulk_b');
      const res = await request(app)
        .post('/api/v2/users/bulk-deactivate')
        .set(SA)
        .send({
          items: [
            { id: a.id, version: a.version },
            { id: b.id, version: b.version },
          ],
        });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ okCount: 2, conflictCount: 0, notFoundCount: 0 });
      const list = await request(app).get('/api/v2/users?active=false').set(SA);
      const names = list.body.items.map((u: { username: string }) => u.username).sort();
      expect(names).toEqual(['bulk_a', 'bulk_b']);
    });

    it('mixed batch → per-row OK / CONFLICT (stale version) / NOT_FOUND, no silent overwrite', async () => {
      const ok = await mk('bulk_ok');
      const stale = await mk('bulk_stale');
      // bump `stale` so the version the batch carries is now behind
      await request(app)
        .post(`/api/v2/users/${stale.id}/deactivate`)
        .set(SA)
        .send({ version: stale.version });
      const res = await request(app)
        .post('/api/v2/users/bulk-deactivate')
        .set(SA)
        .send({
          items: [
            { id: ok.id, version: ok.version },
            { id: stale.id, version: stale.version }, // stale → CONFLICT
            { id: BOGUS_UUID, version: 1 }, // missing → NOT_FOUND
          ],
        });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ okCount: 1, conflictCount: 1, notFoundCount: 1 });
      const byId = Object.fromEntries(
        (res.body.results as { id: string; status: string }[]).map((r) => [r.id, r.status]),
      );
      expect(byId[ok.id]).toBe('OK');
      expect(byId[stale.id]).toBe('CONFLICT');
      expect(byId[BOGUS_UUID]).toBe('NOT_FOUND');
    });

    it('empty items → 400 BULK_ITEMS_REQUIRED', async () => {
      const res = await request(app).post('/api/v2/users/bulk-activate').set(SA).send({ items: [] });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('BULK_ITEMS_REQUIRED');
    });

    it('a role without user.manage cannot bulk-mutate (403); unauth is 401', async () => {
      expect(
        (await request(app).post('/api/v2/users/bulk-deactivate').set(FA).send({ items: [] })).status,
      ).toBe(403);
      expect((await request(app).post('/api/v2/users/bulk-deactivate').send({ items: [] })).status).toBe(401);
    });
  });

  // ── B-14 universal import engine (IMPORT_EXPORT_STANDARD §5/§6/§7/§8) ──
  describe('import', () => {
    const FA = authHeaderForRole('FIELD_AGENT'); // lacks user.manage
    const HEADER = ['Username', 'Name', 'Email', 'Role', 'Effective From'];

    // Build an .xlsx upload in-memory (header row + the given data rows).
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
        .post(`/api/v2/users/import?mode=${mode}`)
        .set(auth)
        .set('content-type', 'application/octet-stream')
        .set('x-filename', 'users.xlsx')
        .send(buf);

    it('downloads an XLSX template (200 + PK body + filename)', async () => {
      const res = await request(app)
        .get('/api/v2/users/import-template')
        .set(SA)
        .buffer(true)
        .parse((r, cb) => {
          const chunks: Buffer[] = [];
          r.on('data', (c: Buffer) => chunks.push(c));
          r.on('end', () => cb(null, Buffer.concat(chunks)));
        });
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('spreadsheetml');
      expect(res.headers['content-disposition']).toContain('users-import-template.xlsx');
      expect((res.body as Buffer).subarray(0, 2).toString('latin1')).toBe('PK');
    });

    it('preview flags an invalid row against its column, keeps the valid one (no writes)', async () => {
      const res = await upload(
        'preview',
        await mkXlsx([
          ['jdoe', 'John Doe', 'jdoe@crm2.local', 'FIELD_AGENT'],
          ['bsmith', 'Bob Smith', 'bob@crm2.local', 'nope'], // malformed role shape (open catalog: existence is caught at confirm by the FK)
        ]),
      );
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ totalRows: 2, validRows: 1, errorRows: 1 });
      expect(res.body.errors[0]).toMatchObject({ rowNumber: 3, column: 'Role' });
      // preview is read-only — only the two seeded-by-other-tests-free list stays empty
      expect((await request(app).get('/api/v2/users').set(SA)).body.totalCount).toBe(0);
    });

    it('confirm imports valid rows, grows the list, and writes the import_log audit record', async () => {
      const res = await upload(
        'confirm',
        await mkXlsx([
          ['jdoe', 'John Doe', 'jdoe@crm2.local', 'FIELD_AGENT'],
          ['mjones', 'Mary Jones', '', 'KYC_VERIFIER'],
        ]),
      );
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ totalRows: 2, successRows: 2, failedRows: 0 });
      expect(typeof res.body.durationMs).toBe('number');
      // rows persisted
      expect((await request(app).get('/api/v2/users').set(SA)).body.totalCount).toBe(2);
      // import_log batch record (§7)
      const log = await db!.pool.query(
        `SELECT resource, file_name, total_rows, success_rows, failed_rows FROM import_log`,
      );
      expect(log.rows).toHaveLength(1);
      expect(log.rows[0]).toMatchObject({
        resource: 'users',
        file_name: 'users.xlsx',
        total_rows: 2,
        success_rows: 2,
        failed_rows: 0,
      });
    });

    it('a role without user.manage cannot import or get the template (403); unauth is 401', async () => {
      const buf = await mkXlsx([['jdoe', 'John Doe', '', 'FIELD_AGENT']]);
      expect((await upload('preview', buf, FA)).status).toBe(403);
      expect((await request(app).get('/api/v2/users/import-template').set(FA)).status).toBe(403);
      expect((await request(app).get('/api/v2/users/import-template')).status).toBe(401);
    });
  });

  // ── profile fields (User-Management parity epic, slice 3) ──
  describe('profile fields', () => {
    const mkDept = async (name = 'Operations'): Promise<number> =>
      (await request(app).post('/api/v2/departments').set(SA).send({ name })).body.id;
    const mkDesig = async (name = 'Field Executive'): Promise<number> =>
      (await request(app).post('/api/v2/designations').set(SA).send({ name })).body.id;

    it('mints a sequential, unique employee_id (CRM-#####) on every create', async () => {
      const a = await newUser({ username: 'emp_a' });
      const b = await newUser({ username: 'emp_b' });
      expect(a.employeeId).toMatch(/^CRM-\d{5}$/);
      expect(b.employeeId).toMatch(/^CRM-\d{5}$/);
      expect(a.employeeId).not.toBe(b.employeeId);
    });

    it('stores phone + department + designation and joins their names in the list', async () => {
      const deptId = await mkDept();
      const desigId = await mkDesig();
      const created = await request(app)
        .post('/api/v2/users')
        .set(SA)
        .send(
          userFactory({
            username: 'prof_a',
            phone: '+919876543210',
            departmentId: deptId,
            designationId: desigId,
          }),
        );
      expect(created.status).toBe(201);
      expect(created.body.phone).toBe('+919876543210');
      expect(created.body.departmentId).toBe(deptId);

      const row = (await request(app).get('/api/v2/users?search=prof_a').set(SA)).body.items[0];
      expect(row.departmentName).toBe('Operations');
      expect(row.designationName).toBe('Field Executive');
    });

    it('rejects a bad phone (400 VALIDATION) and a non-existent department (400 INVALID_REFERENCE)', async () => {
      const bad = await request(app)
        .post('/api/v2/users')
        .set(SA)
        .send(userFactory({ username: 'badph', phone: 'not-a-phone' }));
      expect(bad.status).toBe(400);
      expect(bad.body.error).toBe('VALIDATION');

      const badFk = await request(app)
        .post('/api/v2/users')
        .set(SA)
        .send(userFactory({ username: 'badfk', departmentId: 999999 }));
      expect(badFk.status).toBe(400);
      expect(badFk.body.error).toBe('INVALID_REFERENCE');
    });

    it('an optional initial password (strong) is set on create and lets the user log in', async () => {
      const created = await request(app)
        .post('/api/v2/users')
        .set(SA)
        .send(userFactory({ username: 'pw_user', role: 'MANAGER', password: 'Str0ng!pass' }));
      expect(created.status).toBe(201);
      const login = await request(app)
        .post('/api/v2/auth/login')
        .send({ username: 'pw_user', password: 'Str0ng!pass' });
      expect(login.status).toBe(200);
      expect(typeof login.body.tokens.accessToken).toBe('string');
    });

    it('rejects a weak initial password (400 VALIDATION)', async () => {
      const res = await request(app)
        .post('/api/v2/users')
        .set(SA)
        .send(userFactory({ username: 'weakpw', password: 'alllowercase' }));
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('VALIDATION');
    });

    it('update changes phone/department/designation (version bumps)', async () => {
      const deptId = await mkDept();
      const u = await newUser({ username: 'upd_prof' });
      const upd = await request(app).put(`/api/v2/users/${u.id}`).set(SA).send({
        name: u.name,
        role: u.role,
        phone: '+919000000000',
        departmentId: deptId,
        version: u.version,
      });
      expect(upd.status).toBe(200);
      expect(upd.body.phone).toBe('+919000000000');
      expect(upd.body.departmentId).toBe(deptId);
      expect(upd.body.version).toBe(2);
    });
  });

  // ── Profile photo + one-time-password email (slice 7, ADR-0021) ──
  describe('profile photo', () => {
    const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);
    /** A recording fake storage so tests run with no live S3. */
    function fakeStorage() {
      const puts = new Map<string, Buffer>();
      const removed: string[] = [];
      const provider: StorageProvider = {
        put: (key, body) => {
          puts.set(key, body);
          return Promise.resolve({ key });
        },
        get: () => Promise.resolve(Buffer.from('')),
        signedUrl: (key) => Promise.resolve(`https://signed.test/${key}`),
        remove: (key) => {
          removed.push(key);
          return Promise.resolve();
        },
      };
      return { provider, puts, removed };
    }
    afterEach(() => {
      setStorage(null);
      setMailer(null);
    });

    it('uploads a PNG → 200 signed URL; photo-url returns it; replace removes the old object', async () => {
      const fake = fakeStorage();
      setStorage(fake.provider);
      const u = await newUser({ username: 'photo_a', role: 'FIELD_AGENT' });
      const up = await request(app).post(`/api/v2/users/${u.id}/photo`).set(SA).send(PNG);
      expect(up.status).toBe(200);
      expect(up.body.url).toContain('https://signed.test/users/');
      expect(fake.puts.size).toBe(1);

      const url = await request(app).get(`/api/v2/users/${u.id}/photo-url`).set(SA);
      expect(url.status).toBe(200);
      expect(url.body.url).toContain('https://signed.test/users/');

      const firstKey = [...fake.puts.keys()][0]!;
      const up2 = await request(app).post(`/api/v2/users/${u.id}/photo`).set(SA).send(PNG);
      expect(up2.status).toBe(200);
      expect(fake.removed).toContain(firstKey); // the previous object was cleaned up
    });

    it('rejects a non-image (400 INVALID_IMAGE) and never stores it', async () => {
      const fake = fakeStorage();
      setStorage(fake.provider);
      const u = await newUser({ username: 'photo_bad', role: 'FIELD_AGENT' });
      const up = await request(app).post(`/api/v2/users/${u.id}/photo`).set(SA).send(Buffer.from('hello'));
      expect(up.status).toBe(400);
      expect(up.body.error).toBe('INVALID_IMAGE');
      expect(fake.puts.size).toBe(0);
    });

    it('returns 503 STORAGE_NOT_CONFIGURED when no object store is provisioned', async () => {
      setStorage(null); // fall through to the real factory → disabled (local backend in tests)
      const u = await newUser({ username: 'photo_503', role: 'FIELD_AGENT' });
      const up = await request(app).post(`/api/v2/users/${u.id}/photo`).set(SA).send(PNG);
      expect(up.status).toBe(503);
      expect(up.body.error).toBe('STORAGE_NOT_CONFIGURED');
    });

    it('photo-url is 404 when the user has none', async () => {
      const u = await newUser({ username: 'photo_none', role: 'FIELD_AGENT' });
      const res = await request(app).get(`/api/v2/users/${u.id}/photo-url`).set(SA);
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('NO_PHOTO');
    });

    it('photo routes require USER_MANAGE (a BACKEND_USER is forbidden)', async () => {
      const u = await newUser({ username: 'photo_perm', role: 'FIELD_AGENT' });
      expect((await request(app).post(`/api/v2/users/${u.id}/photo`).set(BE).send(PNG)).status).toBe(403);
      expect((await request(app).get(`/api/v2/users/${u.id}/photo-url`).set(BE)).status).toBe(403);
    });

    it('reset deliver=email sends the one-time password and omits the plaintext from the response', async () => {
      const sent: { to: string; text: string }[] = [];
      setMailer({
        send: (msg) => {
          sent.push({ to: msg.to, text: msg.text });
          return Promise.resolve(true);
        },
      });
      const withEmail = await newUser({ username: 'mail_yes', role: 'FIELD_AGENT', email: 'a@crm2.test' });
      const r1 = await request(app)
        .post(`/api/v2/users/${withEmail.id}/generate-temp-password`)
        .set(SA)
        .send({ deliver: 'email' });
      expect(r1.status).toBe(200);
      expect(r1.body.emailed).toBe(true);
      expect(r1.body.temporaryPassword).toBeUndefined(); // a sent password travels only by email
      expect(sent).toHaveLength(1);
      expect(sent[0]!.to).toBe('a@crm2.test');
      expect(sent[0]!.text).toMatch(/one-time password/i);

      // email mode with no address falls back to returning the plaintext (never strands the account).
      const noEmail = await newUser({ username: 'mail_no', role: 'FIELD_AGENT' });
      const r2 = await request(app)
        .post(`/api/v2/users/${noEmail.id}/generate-temp-password`)
        .set(SA)
        .send({ deliver: 'email' });
      expect(r2.body.emailed).toBe(false);
      expect(typeof r2.body.temporaryPassword).toBe('string');
      expect(sent).toHaveLength(1);
    });

    it('reset deliver=view (default) returns the plaintext and never emails', async () => {
      const sent: unknown[] = [];
      setMailer({
        send: (m) => {
          sent.push(m);
          return Promise.resolve(true);
        },
      });
      const u = await newUser({ username: 'view_reset', role: 'FIELD_AGENT', email: 'v@crm2.test' });
      const res = await request(app).post(`/api/v2/users/${u.id}/generate-temp-password`).set(SA);
      expect(res.status).toBe(200);
      expect(typeof res.body.temporaryPassword).toBe('string');
      expect(res.body.emailed).toBe(false);
      expect(sent).toHaveLength(0); // view never emails, even when the user has an address
    });

    it('every reset mode issues a must-change password → the user is forced to change at login', async () => {
      // (a) random view-mode reset
      const a = await newUser({ username: 'force_view', role: 'MANAGER' });
      const otp = (await request(app).post(`/api/v2/users/${a.id}/generate-temp-password`).set(SA)).body
        .temporaryPassword as string;
      const la = await request(app)
        .post('/api/v2/auth/login')
        .send({ username: 'force_view', password: otp });
      expect(la.status).toBe(200);
      expect(la.body.mustChangePassword).toBe(true);

      // (b) admin-typed password with mustChange=true (the "Set a password" reset mode)
      const b = await newUser({ username: 'force_set', role: 'MANAGER' });
      await request(app)
        .post(`/api/v2/users/${b.id}/password`)
        .set(SA)
        .send({ password: 'Typed-pass1!', mustChange: true });
      const lb = await request(app)
        .post('/api/v2/auth/login')
        .send({ username: 'force_set', password: 'Typed-pass1!' });
      expect(lb.body.mustChangePassword).toBe(true);

      // a plain admin set (no mustChange) does NOT force a change
      const c = await newUser({ username: 'no_force', role: 'MANAGER' });
      await request(app).post(`/api/v2/users/${c.id}/password`).set(SA).send({ password: 'Plain-pass1!' });
      const lc = await request(app)
        .post('/api/v2/auth/login')
        .send({ username: 'no_force', password: 'Plain-pass1!' });
      expect(lc.body.mustChangePassword).toBe(false);
    });
  });

  // ── Self-service "my account" (/me) — a user reads/edits only their OWN profile (no USER_MANAGE) ──
  describe('self profile (/me)', () => {
    const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);
    // The session id IS the acting user — auth as the seeded row so /me reads their real record.
    const asSelf = (id: string) => authHeaderForRole('FIELD_AGENT', id);
    const fakeStorage = (): StorageProvider => ({
      put: (key) => Promise.resolve({ key }),
      get: () => Promise.resolve(Buffer.from('')),
      signedUrl: (key) => Promise.resolve(`https://signed.test/${key}`),
      remove: () => Promise.resolve(),
    });
    afterEach(() => setStorage(null));

    it('GET /me/profile returns the callers own joined view (employee id, role, manager/dept names)', async () => {
      const deptId = (await request(app).post('/api/v2/departments').set(SA).send({ name: 'Ops' })).body.id;
      const mgr = await newUser({ username: 'me_mgr', name: 'My Manager', role: 'MANAGER' });
      const me = await newUser({
        username: 'me_self',
        name: 'Me Self',
        role: 'FIELD_AGENT',
        reportsTo: mgr.id,
        departmentId: deptId,
      });
      const res = await request(app).get('/api/v2/users/me/profile').set(asSelf(me.id));
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(me.id);
      expect(res.body.employeeId).toMatch(/^CRM-\d{5}$/);
      expect(res.body.role).toBe('FIELD_AGENT');
      expect(res.body.reportsToName).toBe('My Manager');
      expect(res.body.departmentName).toBe('Ops');
    });

    it('GET /me/profile is 401 unauthenticated', async () => {
      expect((await request(app).get('/api/v2/users/me/profile')).status).toBe(401);
    });

    it('PATCH /me/profile updates the callers own email + phone, bumps version, and persists', async () => {
      const me = await newUser({ username: 'me_edit', role: 'FIELD_AGENT' });
      expect(me.version).toBe(1);
      const upd = await request(app)
        .patch('/api/v2/users/me/profile')
        .set(asSelf(me.id))
        .send({ email: 'me@crm2.test', phone: '+919876500000' });
      expect(upd.status).toBe(200);
      expect(upd.body.email).toBe('me@crm2.test');
      expect(upd.body.phone).toBe('+919876500000');
      expect(upd.body.version).toBe(2);
      const reread = await request(app).get('/api/v2/users/me/profile').set(asSelf(me.id));
      expect(reread.body.email).toBe('me@crm2.test');
    });

    it('PATCH /me/profile rejects a bad phone (400 VALIDATION)', async () => {
      const me = await newUser({ username: 'me_badph', role: 'FIELD_AGENT' });
      const res = await request(app)
        .patch('/api/v2/users/me/profile')
        .set(asSelf(me.id))
        .send({ phone: 'not-a-phone' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('VALIDATION');
    });

    it('PATCH /me/profile can clear email + phone (both nullable)', async () => {
      const me = await newUser({ username: 'me_clear', role: 'FIELD_AGENT', email: 'has@crm2.test' });
      const res = await request(app)
        .patch('/api/v2/users/me/profile')
        .set(asSelf(me.id))
        .send({ email: null, phone: null });
      expect(res.status).toBe(200);
      expect(res.body.email).toBeNull();
      expect(res.body.phone).toBeNull();
    });

    it('self photo upload + read needs no USER_MANAGE (a FIELD_AGENT manages their own avatar)', async () => {
      setStorage(fakeStorage());
      const me = await newUser({ username: 'me_photo', role: 'FIELD_AGENT' });
      const up = await request(app).post('/api/v2/users/me/photo').set(asSelf(me.id)).send(PNG);
      expect(up.status).toBe(200);
      expect(up.body.url).toContain('https://signed.test/users/');
      const url = await request(app).get('/api/v2/users/me/photo-url').set(asSelf(me.id));
      expect(url.status).toBe(200);
      expect(url.body.url).toContain('https://signed.test/users/');
    });

    it('self photo-url is 404 when the caller has none; the routes still require a session (401)', async () => {
      setStorage(fakeStorage());
      const me = await newUser({ username: 'me_nophoto', role: 'FIELD_AGENT' });
      expect((await request(app).get('/api/v2/users/me/photo-url').set(asSelf(me.id))).status).toBe(404);
      expect((await request(app).get('/api/v2/users/me/photo-url')).status).toBe(401);
      expect((await request(app).post('/api/v2/users/me/photo').send(PNG)).status).toBe(401);
    });

    it('"me" never collides with the /:id param routes (FA has no USER_MANAGE, yet /me works)', async () => {
      const me = await newUser({ username: 'me_route', role: 'FIELD_AGENT' });
      // the same agent is forbidden from the admin list (proves FA lacks USER_MANAGE)…
      expect((await request(app).get('/api/v2/users').set(asSelf(me.id))).status).toBe(403);
      // …but the self route resolves to meProfile, not /:id with id="me".
      expect((await request(app).get('/api/v2/users/me/profile').set(asSelf(me.id))).status).toBe(200);
    });
  });
});
