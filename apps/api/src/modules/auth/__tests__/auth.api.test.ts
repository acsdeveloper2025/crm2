import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { createTestDb, userFactory, authHeaderForRole } from '@crm2/test-utils';
import { createApp } from '../../../http/app.js';
import { setPool } from '../../../platform/db.js';
import { setRealtime, type Realtime } from '../../../platform/realtime/index.js';
import { totp } from '../../../platform/totp.js';

/** Capture realtime emits (for the auth:session_revoked forced-logout assertions). */
function spyRealtime(): { events: Array<{ userId: string; event: string; payload: unknown }> } {
  const events: Array<{ userId: string; event: string; payload: unknown }> = [];
  const rt: Realtime = {
    emitToUser: (userId, event, payload) => {
      events.push({ userId, event, payload });
    },
    emitToFieldMonitoring: () => undefined,
  };
  setRealtime(rt);
  return { events };
}

const RUN = !!process.env['DATABASE_URL'];
const db = RUN ? createTestDb() : null;
const app = createApp({ enableTestAuth: true });
const SA = authHeaderForRole('SUPER_ADMIN');
const PASSWORD = 'Sup3r-secret!'; // strong policy (upper+lower+digit+symbol)

/** Create a user (dev seam) and set its password; returns the user id. */
async function makeUser(over = {}): Promise<string> {
  const id = (await request(app).post('/api/v2/users').set(SA).send(userFactory(over))).body.id as string;
  await request(app).post(`/api/v2/users/${id}/password`).set(SA).send({ password: PASSWORD });
  return id;
}
const login = (username: string, password = PASSWORD, mfaCode?: string) =>
  request(app)
    .post('/api/v2/auth/login')
    .send({ username, password, ...(mfaCode ? { mfaCode } : {}) });

describe.skipIf(!RUN)('auth API', () => {
  beforeAll(async () => {
    await db!.migrate();
    setPool(db!.pool);
  });
  afterAll(async () => {
    await db!.end();
  });
  beforeEach(async () => {
    // Truncate the seeded active policy too: it would otherwise gate every test user's refresh
    // (the ADR-0043 login-policy gate). These tests predate policies and don't accept them.
    // Acceptances live in the shared `consents` store.
    await db!.truncate('auth_refresh_tokens', 'consents', 'policies', 'users');
  });

  it('logs in with a valid password → user + JWT pair', async () => {
    await makeUser({ username: 'alice', role: 'MANAGER' });
    const res = await login('alice');
    expect(res.status).toBe(200);
    expect(res.body.user.username).toBe('alice');
    expect(res.body.user.role).toBe('MANAGER');
    expect(typeof res.body.tokens.accessToken).toBe('string');
    expect(typeof res.body.tokens.refreshToken).toBe('string');
    expect(res.body.tokens.expiresIn).toBeGreaterThan(0);
  });

  it('migration 0074 seeds idle + session-cap policy (DESK set, FIELD_AGENT exempt)', async () => {
    const desk = await db!.pool.query(
      `SELECT idle_logout_minutes, max_session_minutes FROM roles WHERE code = 'MANAGER'`,
    );
    expect(desk.rows[0]).toEqual({ idle_logout_minutes: 10, max_session_minutes: 720 });
    const field = await db!.pool.query(
      `SELECT idle_logout_minutes, max_session_minutes FROM roles WHERE code = 'FIELD_AGENT'`,
    );
    expect(field.rows[0]).toEqual({ idle_logout_minutes: null, max_session_minutes: null });
  });

  it('login response carries the role idle + session-cap policy (DESK)', async () => {
    await makeUser({ username: 'mgr', role: 'MANAGER' });
    const res = await login('mgr');
    expect(res.body.user.idleLogoutMinutes).toBe(10);
    expect(res.body.user.maxSessionMinutes).toBe(720);
  });

  it('login response marks FIELD_AGENT exempt (null idle policy)', async () => {
    await makeUser({ username: 'fieldex', role: 'FIELD_AGENT' });
    const res = await login('fieldex');
    expect(res.body.user.idleLogoutMinutes).toBeNull();
    expect(res.body.user.maxSessionMinutes).toBeNull();
  });

  it('accepts deviceInfo as the field app device OBJECT (mobile compat, not just a string)', async () => {
    await makeUser({ username: 'devobj', role: 'FIELD_AGENT' });
    const res = await request(app)
      .post('/api/v2/auth/login')
      .send({
        username: 'devobj',
        password: PASSWORD,
        deviceId: 'dev-1',
        deviceInfo: { brand: 'Samsung', model: 'SM-G991B', os: 'Android 14' }, // RN sends an object
      });
    expect(res.status).toBe(200);
    expect(typeof res.body.tokens.accessToken).toBe('string');
  });

  it('rejects a wrong password (401 INVALID_CREDENTIALS)', async () => {
    await makeUser({ username: 'bob' });
    const res = await login('bob', 'nope');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('INVALID_CREDENTIALS');
  });

  it('rejects an unknown user and an inactive user (401)', async () => {
    expect((await login('ghost')).status).toBe(401);
    const id = await makeUser({ username: 'gone' });
    // OCC: (de)activation is version-guarded (ADR-0019); a freshly created user is at version 1.
    await request(app).post(`/api/v2/users/${id}/deactivate`).set(SA).send({ version: 1 });
    expect((await login('gone')).status).toBe(401);
  });

  it('rejects a future-dated (scheduled) user even with the right password (ADR-0017)', async () => {
    const future = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
    await makeUser({ username: 'scheduled', effectiveFrom: future });
    const res = await login('scheduled');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('INVALID_CREDENTIALS');
  });

  it('the access token authorizes /auth/me; no token → 401', async () => {
    await makeUser({ username: 'carol' });
    const { accessToken } = (await login('carol')).body.tokens;
    const me = await request(app).get('/api/v2/auth/me').set('authorization', `Bearer ${accessToken}`);
    expect(me.status).toBe(200);
    expect(me.body.username).toBe('carol');
    expect((await request(app).get('/api/v2/auth/me')).status).toBe(401);
  });

  it('login + /me carry the role resolved permissions (ADR-0022 - FE gates on permissions, not names)', async () => {
    await makeUser({ username: 'perm_fa', role: 'FIELD_AGENT' });
    const res = await login('perm_fa');
    expect(res.body.user.grantsAll).toBe(false);
    expect(res.body.user.permissions).toEqual(['case.view', 'location.capture', 'task.execute']);
    const me = await request(app)
      .get('/api/v2/auth/me')
      .set('authorization', `Bearer ${res.body.tokens.accessToken}`);
    expect(me.body.permissions).toEqual(['case.view', 'location.capture', 'task.execute']);
    expect(me.body.grantsAll).toBe(false);
  });

  it('refresh rotates the pair and single-uses the old refresh token', async () => {
    await makeUser({ username: 'dave' });
    const first = (await login('dave')).body.tokens;
    const rotated = await request(app)
      .post('/api/v2/auth/refresh')
      .send({ refreshToken: first.refreshToken });
    expect(rotated.status).toBe(200);
    expect(rotated.body.tokens.refreshToken).not.toBe(first.refreshToken);
    // the original refresh token is now revoked
    const reuse = await request(app).post('/api/v2/auth/refresh').send({ refreshToken: first.refreshToken });
    expect(reuse.status).toBe(401);
    expect(reuse.body.error).toBe('INVALID_REFRESH');
  });

  it('logout revokes the user’s refresh tokens', async () => {
    await makeUser({ username: 'erin' });
    const { accessToken, refreshToken } = (await login('erin')).body.tokens;
    const out = await request(app).post('/api/v2/auth/logout').set('authorization', `Bearer ${accessToken}`);
    expect(out.status).toBe(200);
    const after = await request(app).post('/api/v2/auth/refresh').send({ refreshToken });
    expect(after.status).toBe(401);
  });

  // ── auth:session_revoked realtime forced-logout (ADR-0014/0027, mobile parity) ──
  it('logout emits auth:session_revoked to the device (immediate forced-logout)', async () => {
    await makeUser({ username: 'sock', role: 'FIELD_AGENT' });
    const { events } = spyRealtime();
    try {
      const login1 = await request(app)
        .post('/api/v2/auth/login')
        .send({ username: 'sock', password: PASSWORD, deviceId: 'device-xyz' });
      const accessToken = login1.body.tokens.accessToken as string;
      const out = await request(app)
        .post('/api/v2/auth/logout')
        .set('authorization', `Bearer ${accessToken}`);
      expect(out.status).toBe(200);
      const revoked = events.filter((e) => e.event === 'auth:session_revoked');
      expect(revoked).toHaveLength(1);
      expect(revoked[0]!.payload).toEqual({ deviceId: 'device-xyz' });
    } finally {
      setRealtime(null);
    }
  });

  it('revoking ONE session emits auth:session_revoked for that device only', async () => {
    await makeUser({ username: 'sock2', role: 'FIELD_AGENT' });
    const { events } = spyRealtime();
    try {
      const login1 = await request(app)
        .post('/api/v2/auth/login')
        .send({ username: 'sock2', password: PASSWORD, deviceId: 'dev-A' });
      const accessToken = login1.body.tokens.accessToken as string;
      const sessions = await request(app)
        .get('/api/v2/auth/sessions')
        .set('authorization', `Bearer ${accessToken}`);
      const jti = sessions.body[0].id as string;
      const rev = await request(app)
        .post(`/api/v2/auth/sessions/${jti}/revoke`)
        .set('authorization', `Bearer ${accessToken}`);
      expect(rev.status).toBeLessThan(300);
      const revoked = events.filter((e) => e.event === 'auth:session_revoked');
      expect(revoked).toHaveLength(1);
      expect(revoked[0]!.payload).toEqual({ deviceId: 'dev-A' });
    } finally {
      setRealtime(null);
    }
  });

  it('rejects a garbage refresh token (401)', async () => {
    const res = await request(app).post('/api/v2/auth/refresh').send({ refreshToken: 'not.a.jwt' });
    expect(res.status).toBe(401);
  });

  // ── version-check force-update gate (mobile parity); public, seeded ANDROID latest=1.0.56 min=1.0.0 ──
  describe('version-check gate', () => {
    const check = (currentVersion: string, platform: string) =>
      request(app).post('/api/v2/auth/version-check').send({ currentVersion, platform });

    it('no update when the device is at the latest version', async () => {
      const r = await check('1.0.56', 'ANDROID');
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({
        success: true,
        forceUpdate: false,
        updateRequired: false,
        latestVersion: '1.0.56',
      });
    });

    it('force-updates a version below the minimum supported', async () => {
      const r = await check('0.9.0', 'ANDROID');
      expect(r.body).toMatchObject({ forceUpdate: true, updateRequired: true });
    });

    it('flags an optional update using NUMERIC compare (1.0.9 < 1.0.56) and accepts lowercase platform', async () => {
      const r = await check('1.0.9', 'android');
      expect(r.body).toMatchObject({ forceUpdate: false, updateRequired: true, latestVersion: '1.0.56' });
    });

    it('never gates a platform with no policy row', async () => {
      const r = await check('0.0.1', 'WEB');
      expect(r.body).toMatchObject({ forceUpdate: false, updateRequired: false });
    });

    it('rejects a malformed body (400)', async () => {
      const r = await request(app).post('/api/v2/auth/version-check').send({ platform: 'ANDROID' });
      expect(r.status).toBe(400);
    });
  });

  it('the seeded admin can log in with the migration-seeded password', async () => {
    // 0007 seeds admin; 0009 sets password 'admin123'. (beforeEach truncated users, so re-seed.)
    await db!.pool.query(
      `INSERT INTO users (id, username, name, role, password_hash, password_set_at)
       VALUES ('00000000-0000-0000-0000-000000000001','admin','System Administrator','SUPER_ADMIN',
         'scrypt$16384$8$1$J3hE0MvXk7dDKqKGoSAk1w$kFNxLixr0LaM1AOmQYOai9Y9YHTzZAhKH8UwGKKyZAI', now())
       ON CONFLICT (id) DO NOTHING`,
    );
    expect((await login('admin', 'admin123')).status).toBe(200);
  });

  // ── account lockout (User-Management parity epic, slice 4) ──
  describe('lockout', () => {
    it('locks the account after 5 failed logins (423 ACCOUNT_LOCKED); admin unlock restores access', async () => {
      const id = await makeUser({ username: 'lockme', role: 'FIELD_AGENT' });
      for (let i = 0; i < 5; i++) await login('lockme', 'wrong-pass');
      // now locked — even the CORRECT password is refused with 423
      const locked = await login('lockme');
      expect(locked.status).toBe(423);
      expect(locked.body.error).toBe('ACCOUNT_LOCKED');
      // admin clears the lockout → login works again, and the counter is reset
      const unlock = await request(app).post(`/api/v2/users/${id}/unlock`).set(SA);
      expect(unlock.status).toBe(200);
      expect((await login('lockme')).status).toBe(200);
    });

    it('a successful login resets the failed-attempt counter', async () => {
      await makeUser({ username: 'resetme', role: 'FIELD_AGENT' });
      for (let i = 0; i < 4; i++) await login('resetme', 'wrong-pass'); // 4 < 5, not locked
      expect((await login('resetme')).status).toBe(200); // success resets the counter
      for (let i = 0; i < 4; i++) await login('resetme', 'wrong-pass'); // 4 again, still not locked
      expect((await login('resetme')).status).toBe(200);
    });
  });

  // ── force-change + self-service change-password ──
  describe('change password', () => {
    it('a generated temp password logs in with mustChangePassword=true; changing it clears the flag', async () => {
      const id = await makeUser({ username: 'tmp_user', role: 'MANAGER' });
      const gen = await request(app).post(`/api/v2/users/${id}/generate-temp-password`).set(SA);
      expect(gen.status).toBe(200);
      const temp = gen.body.temporaryPassword as string;
      expect(temp).toMatch(/[a-z]/);
      expect(temp).toMatch(/[A-Z]/);
      expect(temp).toMatch(/[0-9]/);
      expect(temp).toMatch(/[^A-Za-z0-9]/);

      const first = await login('tmp_user', temp);
      expect(first.status).toBe(200);
      expect(first.body.mustChangePassword).toBe(true);

      const access = first.body.tokens.accessToken as string;
      const chg = await request(app)
        .post('/api/v2/auth/change-password')
        .set('authorization', `Bearer ${access}`)
        .send({ currentPassword: temp, newPassword: 'Newp@ss12' });
      expect(chg.status).toBe(200);

      const after = await login('tmp_user', 'Newp@ss12');
      expect(after.status).toBe(200);
      expect(after.body.mustChangePassword).toBe(false);
    });

    it('change-password rejects a wrong current (401) and a weak new password (400)', async () => {
      await makeUser({ username: 'chg_user', role: 'MANAGER' });
      const access = (await login('chg_user')).body.tokens.accessToken as string;
      const wrong = await request(app)
        .post('/api/v2/auth/change-password')
        .set('authorization', `Bearer ${access}`)
        .send({ currentPassword: 'not-it', newPassword: 'Newp@ss12' });
      expect(wrong.status).toBe(401);
      const weak = await request(app)
        .post('/api/v2/auth/change-password')
        .set('authorization', `Bearer ${access}`)
        .send({ currentPassword: PASSWORD, newPassword: 'tooweak' });
      expect(weak.status).toBe(400);
      expect(weak.body.error).toBe('VALIDATION');
    });

    it('change-password requires authentication (401)', async () => {
      const res = await request(app)
        .post('/api/v2/auth/change-password')
        .send({ currentPassword: 'x', newPassword: 'Newp@ss12' });
      expect(res.status).toBe(401);
    });
  });

  it('a normal login reports mustChangePassword=false + mustEnrollMfa=false', async () => {
    await makeUser({ username: 'normal_user', role: 'MANAGER' });
    const res = await login('normal_user');
    expect(res.body.mustChangePassword).toBe(false);
    expect(res.body.mustEnrollMfa).toBe(false);
  });

  // ── MFA / TOTP (User-Management parity epic, slice 5) ──
  describe('mfa', () => {
    /** Enrol `username` in TOTP and return { secret, recoveryCodes }. */
    async function enrol(username: string): Promise<{ secret: string; recoveryCodes: string[] }> {
      const access = (await login(username)).body.tokens.accessToken as string;
      const bearer = { authorization: `Bearer ${access}` };
      const start = await request(app).post('/api/v2/auth/mfa/enroll/start').set(bearer);
      expect(start.status).toBe(200);
      const secret = start.body.secret as string;
      expect(start.body.otpauthUri).toContain('otpauth://totp/');
      const verify = await request(app)
        .post('/api/v2/auth/mfa/enroll/verify')
        .set(bearer)
        .send({ code: totp(secret, Date.now()) });
      expect(verify.status).toBe(200);
      expect(verify.body.recoveryCodes).toHaveLength(10);
      return { secret, recoveryCodes: verify.body.recoveryCodes };
    }

    it('enrols, then login needs a TOTP code: no code → 401 MFA_REQUIRED, valid code → 200', async () => {
      await makeUser({ username: 'mfa_user', role: 'MANAGER' });
      const { secret } = await enrol('mfa_user');
      const status = await request(app)
        .get('/api/v2/auth/mfa/status')
        .set(
          'authorization',
          `Bearer ${(await login('mfa_user', PASSWORD, totp(secret, Date.now())).then((r) => r.body.tokens.accessToken)) as string}`,
        );
      expect(status.body.enrolled).toBe(true);

      const noCode = await login('mfa_user');
      expect(noCode.status).toBe(401);
      expect(noCode.body.error).toBe('MFA_REQUIRED');

      const withCode = await login('mfa_user', PASSWORD, totp(secret, Date.now()));
      expect(withCode.status).toBe(200);
      expect(typeof withCode.body.tokens.accessToken).toBe('string');
    });

    it('a recovery code logs in once, then is burned (reuse → MFA_REQUIRED)', async () => {
      await makeUser({ username: 'rec_user', role: 'MANAGER' });
      const { recoveryCodes } = await enrol('rec_user');
      const code = recoveryCodes[0]!;
      const first = await login('rec_user', PASSWORD, code);
      expect(first.status).toBe(200);
      const reuse = await login('rec_user', PASSWORD, code);
      expect(reuse.status).toBe(401);
      expect(reuse.body.error).toBe('MFA_REQUIRED');
    });

    it('enroll/verify rejects a wrong TOTP code (400 INVALID_MFA_CODE)', async () => {
      await makeUser({ username: 'badcode', role: 'MANAGER' });
      const access = (await login('badcode')).body.tokens.accessToken as string;
      await request(app).post('/api/v2/auth/mfa/enroll/start').set('authorization', `Bearer ${access}`);
      const res = await request(app)
        .post('/api/v2/auth/mfa/enroll/verify')
        .set('authorization', `Bearer ${access}`)
        .send({ code: '000000' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('INVALID_MFA_CODE');
    });

    it('admin can disable a user’s MFA (then login no longer needs a code)', async () => {
      const id = await makeUser({ username: 'admin_disable', role: 'MANAGER' });
      await enrol('admin_disable');
      expect((await login('admin_disable')).status).toBe(401); // enrolled → needs code
      const disable = await request(app).post(`/api/v2/auth/mfa/admin/${id}/disable`).set(SA);
      expect(disable.status).toBe(200);
      expect((await login('admin_disable')).status).toBe(200); // no longer enrolled
    });

    it('an admin-required-but-not-enrolled user gets mustEnrollMfa=true on login', async () => {
      const id = await makeUser({ username: 'must_enrol', role: 'MANAGER' });
      await request(app)
        .put(`/api/v2/users/${id}`)
        .set(SA)
        .send({ name: 'Must Enrol', role: 'MANAGER', mfaRequired: true, version: 1 });
      const res = await login('must_enrol');
      expect(res.status).toBe(200);
      expect(res.body.mustEnrollMfa).toBe(true);
    });

    it('mfa endpoints require authentication (401)', async () => {
      expect((await request(app).get('/api/v2/auth/mfa/status')).status).toBe(401);
      expect((await request(app).post('/api/v2/auth/mfa/enroll/start')).status).toBe(401);
    });
  });

  // ── Sessions (User-Management parity epic, slice 6) ──
  describe('sessions', () => {
    /** A self-auth header standing in for a logged-in `userId` (the self routes scope to req.auth). */
    const selfHeader = (userId: string) => ({ 'x-test-auth': `FIELD_AGENT:${userId}` });
    /** Log in `username` once with a device label → creates one session row. */
    const loginDevice = (username: string, deviceInfo: string) =>
      request(app).post('/api/v2/auth/login').send({ username, password: PASSWORD, deviceInfo });

    it('lists active sessions (per device + ip), excludes a revoked one', async () => {
      const id = await makeUser({ username: 'sess_a', role: 'MANAGER' });
      await loginDevice('sess_a', 'Pixel 8');
      await loginDevice('sess_a', 'MacBook');
      const list = await request(app).get('/api/v2/auth/sessions').set(selfHeader(id));
      expect(list.status).toBe(200);
      expect(list.body).toHaveLength(2);
      expect(list.body.map((s: { deviceInfo: string }) => s.deviceInfo).sort()).toEqual([
        'MacBook',
        'Pixel 8',
      ]);
      // ip is captured (supertest connects over loopback) and lastUsedAt/createdAt are present.
      expect(list.body[0].ip).toBeTruthy();
      expect(typeof list.body[0].lastUsedAt).toBe('string');

      const revoke = await request(app)
        .post(`/api/v2/auth/sessions/${list.body[0].id}/revoke`)
        .set(selfHeader(id));
      expect(revoke.status).toBe(200);
      const after = await request(app).get('/api/v2/auth/sessions').set(selfHeader(id));
      expect(after.body).toHaveLength(1);
      expect(after.body[0].id).not.toBe(list.body[0].id);
    });

    it('flags the caller’s own session as current via ?currentJti', async () => {
      const id = await makeUser({ username: 'sess_cur', role: 'MANAGER' });
      await loginDevice('sess_cur', 'Phone');
      await loginDevice('sess_cur', 'Laptop');
      const plain = await request(app).get('/api/v2/auth/sessions').set(selfHeader(id));
      expect(plain.body.every((s: { current: boolean }) => s.current === false)).toBe(true);
      const mine = plain.body[0].id as string;
      const marked = await request(app).get(`/api/v2/auth/sessions?currentJti=${mine}`).set(selfHeader(id));
      expect(
        marked.body.filter((s: { current: boolean }) => s.current).map((s: { id: string }) => s.id),
      ).toEqual([mine]);
    });

    it('revoking an unknown / already-revoked session → 404 SESSION_NOT_FOUND', async () => {
      const id = await makeUser({ username: 'sess_404', role: 'MANAGER' });
      await loginDevice('sess_404', 'Phone');
      const list = await request(app).get('/api/v2/auth/sessions').set(selfHeader(id));
      const jti = list.body[0].id as string;
      const first = await request(app).post(`/api/v2/auth/sessions/${jti}/revoke`).set(selfHeader(id));
      expect(first.status).toBe(200);
      const again = await request(app).post(`/api/v2/auth/sessions/${jti}/revoke`).set(selfHeader(id));
      expect(again.status).toBe(404);
      expect(again.body.error).toBe('SESSION_NOT_FOUND');
    });

    it('a user cannot list-or-revoke another user’s session (IDOR-safe)', async () => {
      const alice = await makeUser({ username: 'sess_alice', role: 'MANAGER' });
      const bob = await makeUser({ username: 'sess_bob', role: 'MANAGER' });
      await loginDevice('sess_bob', 'Bob phone');
      const bobSessions = await request(app).get('/api/v2/auth/sessions').set(selfHeader(bob));
      const bobJti = bobSessions.body[0].id as string;
      // Alice lists her own (none) and cannot revoke bob's jti.
      const aliceList = await request(app).get('/api/v2/auth/sessions').set(selfHeader(alice));
      expect(aliceList.body).toHaveLength(0);
      const steal = await request(app).post(`/api/v2/auth/sessions/${bobJti}/revoke`).set(selfHeader(alice));
      expect(steal.status).toBe(404);
      // bob's session is untouched.
      const stillThere = await request(app).get('/api/v2/auth/sessions').set(selfHeader(bob));
      expect(stillThere.body).toHaveLength(1);
    });

    it('an admin lists + revokes another user’s session (USER_MANAGE)', async () => {
      const id = await makeUser({ username: 'sess_adm', role: 'MANAGER' });
      await loginDevice('sess_adm', 'Tablet');
      const list = await request(app).get(`/api/v2/users/${id}/sessions`).set(SA);
      expect(list.status).toBe(200);
      expect(list.body).toHaveLength(1);
      const jti = list.body[0].id as string;
      const revoke = await request(app).post(`/api/v2/users/${id}/sessions/${jti}/revoke`).set(SA);
      expect(revoke.status).toBe(200);
      const after = await request(app).get(`/api/v2/users/${id}/sessions`).set(SA);
      expect(after.body).toHaveLength(0);
    });

    it('admin session routes require USER_MANAGE (a MANAGER is forbidden)', async () => {
      const id = await makeUser({ username: 'sess_perm', role: 'MANAGER' });
      const mgr = authHeaderForRole('MANAGER');
      expect((await request(app).get(`/api/v2/users/${id}/sessions`).set(mgr)).status).toBe(403);
    });

    it('self session routes require authentication (401)', async () => {
      expect((await request(app).get('/api/v2/auth/sessions')).status).toBe(401);
      expect((await request(app).post('/api/v2/auth/sessions/whatever/revoke')).status).toBe(401);
    });

    it('a malformed (non-uuid) jti/id is a clean 400, never a 500 (uuid-param 500 class)', async () => {
      const id = await makeUser({ username: 'sess_badid', role: 'MANAGER' });
      // self revoke with a non-uuid jti → 400, not a pg 22P02 → 500
      const selfBad = await request(app).post('/api/v2/auth/sessions/not-a-uuid/revoke').set(selfHeader(id));
      expect(selfBad.status).toBe(400);
      // admin list/revoke for a non-uuid user id → 400
      expect((await request(app).get('/api/v2/users/not-a-uuid/sessions').set(SA)).status).toBe(400);
      expect((await request(app).post(`/api/v2/users/${id}/sessions/not-a-uuid/revoke`).set(SA)).status).toBe(
        400,
      );
      // a non-uuid currentJti query param is ignored (200), not a 500
      expect(
        (await request(app).get('/api/v2/auth/sessions?currentJti=garbage').set(selfHeader(id))).status,
      ).toBe(200);
    });
  });

  // ── Per-role password rotation policy (ADR-0022): force change every N days; null = exempt ──
  describe('password rotation policy', () => {
    /** Backdate when the password was set so it crosses the role's expiry window. */
    const ageDays = (id: string, days: number) =>
      db!.pool.query(`UPDATE users SET password_set_at = now() - ($2 || ' days')::interval WHERE id = $1`, [
        id,
        days,
      ]);

    it('a MANAGER (90-day policy) past the window is forced to change at login', async () => {
      const id = await makeUser({ username: 'rot_mgr', role: 'MANAGER' });
      await ageDays(id, 100);
      const res = await login('rot_mgr');
      expect(res.status).toBe(200);
      expect(res.body.mustChangePassword).toBe(true);
    });

    it('a MANAGER with a recent password is NOT forced (within the window)', async () => {
      await makeUser({ username: 'rot_fresh', role: 'MANAGER' });
      const res = await login('rot_fresh');
      expect(res.body.mustChangePassword).toBe(false);
    });

    it('a FIELD_AGENT (null policy = exempt) is never forced, even when very old', async () => {
      const id = await makeUser({ username: 'rot_field', role: 'FIELD_AGENT' });
      await ageDays(id, 500);
      const res = await login('rot_field');
      expect(res.status).toBe(200);
      expect(res.body.mustChangePassword).toBe(false);
    });

    it('an over-age session cannot be refreshed (forces re-login → change)', async () => {
      const id = await makeUser({ username: 'rot_refresh', role: 'MANAGER' });
      const first = await login('rot_refresh');
      const refreshToken = first.body.tokens.refreshToken as string;
      // a normal refresh works while the password is fresh
      expect((await request(app).post('/api/v2/auth/refresh').send({ refreshToken })).status).toBe(200);
      // age the password past the window → the next refresh is refused
      await ageDays(id, 100);
      const stale = await login('rot_refresh'); // re-login to get a token minted AFTER backdating
      const expiredRefresh = await request(app)
        .post('/api/v2/auth/refresh')
        .send({ refreshToken: stale.body.tokens.refreshToken });
      expect(expiredRefresh.status).toBe(401);
      expect(expiredRefresh.body.error).toBe('INVALID_REFRESH');
    });

    it('changing the password clears the force (a fresh password is within any window)', async () => {
      const id = await makeUser({ username: 'rot_fix', role: 'MANAGER' });
      await ageDays(id, 100);
      expect((await login('rot_fix')).body.mustChangePassword).toBe(true);
      // self-service change resets password_set_at = now()
      await request(app)
        .post('/api/v2/auth/change-password')
        .set(authHeaderForRole('MANAGER', id))
        .send({ currentPassword: PASSWORD, newPassword: 'N3w-str0ng!pass' });
      const after = await login('rot_fix', 'N3w-str0ng!pass');
      expect(after.body.mustChangePassword).toBe(false);
    });
  });

  // ── Self-service: GET /api/v2/auth/my-consents (ADR-0043) — own acceptance log, joined.
  describe('GET /auth/my-consents', () => {
    interface MyAcceptance {
      id: string;
      policyCode: string | null;
      policyName: string | null;
      policyVersion: number;
      acceptedAt: string;
      ip: string | null;
      userAgent: string | null;
    }
    const selfHeader = (userId: string) => ({ 'x-test-auth': `FIELD_AGENT:${userId}` });

    it('returns this caller’s own acceptance log (joined for policy name)', async () => {
      const id = await makeUser({ username: 'mc_self', role: 'FIELD_AGENT' });
      // seed a policy at content_version=1 and a matching consents row for this user.
      await db!.pool.query(
        `INSERT INTO policies (code, name, content, content_version, is_active) VALUES ('PRIVACY','Privacy','body',1,true)`,
      );
      await db!.pool.query(
        `INSERT INTO consents (user_id, policy_version, user_agent) VALUES ($1, 1, 'CRM-Mobile/1.0.69')`,
        [id],
      );
      const r = await request(app).get('/api/v2/auth/my-consents').set(selfHeader(id));
      expect(r.status).toBe(200);
      const rows = r.body as MyAcceptance[];
      expect(rows).toHaveLength(1);
      expect(rows[0]!.policyCode).toBe('PRIVACY');
      expect(rows[0]!.policyName).toBe('Privacy');
      expect(rows[0]!.policyVersion).toBe(1);
      expect(rows[0]!.userAgent).toBe('CRM-Mobile/1.0.69');
      expect(typeof rows[0]!.id).toBe('string');
      expect(typeof rows[0]!.acceptedAt).toBe('string');
    });

    it('returns an empty array for a user who has accepted no policy yet', async () => {
      const id = await makeUser({ username: 'mc_empty', role: 'FIELD_AGENT' });
      const r = await request(app).get('/api/v2/auth/my-consents').set(selfHeader(id));
      expect(r.status).toBe(200);
      expect(r.body).toEqual([]);
    });

    it('a user only ever sees their own acceptances (scoped to req.auth)', async () => {
      const alice = await makeUser({ username: 'mc_alice', role: 'FIELD_AGENT' });
      const bob = await makeUser({ username: 'mc_bob', role: 'FIELD_AGENT' });
      await db!.pool.query(`INSERT INTO consents (user_id, policy_version) VALUES ($1, 1)`, [bob]);
      // alice asks for hers and gets nothing — bob's row is NOT exposed across users.
      const aList = await request(app).get('/api/v2/auth/my-consents').set(selfHeader(alice));
      expect(aList.body).toEqual([]);
      const bList = await request(app).get('/api/v2/auth/my-consents').set(selfHeader(bob));
      expect(bList.body as MyAcceptance[]).toHaveLength(1);
    });

    it('unauthenticated request is 401', async () => {
      expect((await request(app).get('/api/v2/auth/my-consents')).status).toBe(401);
    });
  });
});
