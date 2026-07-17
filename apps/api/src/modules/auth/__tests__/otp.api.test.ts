import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createTestDb, userFactory, authHeaderForRole } from '@crm2/test-utils';
import { createApp } from '../../../http/app.js';
import { setPool } from '../../../platform/db.js';
import { setMailer } from '../../../platform/mail/index.js';
import { setSmsSender, normalizeIndianMobile } from '../../../platform/sms.js';
import { setWhatsappSender } from '../../../platform/whatsapp.js';
import { encryptSecret } from '../../../platform/encryption.js';
import { generateTotpSecret, totp } from '../../../platform/totp.js';

const RUN = !!process.env['DATABASE_URL'];
const db = RUN ? createTestDb() : null;
const app = createApp({ enableTestAuth: true });
const SA = authHeaderForRole('SUPER_ADMIN');
const PASSWORD = 'Sup3r-secret!';
const EMAIL = 'otp.user@crm2.test';
const PHONE = '+919876543210'; // E.164 (users schema); normalizes to 9876543210 for Fast2SMS
const DEVICE = 'web-device-aaaa';

/** Inject capture fakes on BOTH channels (their presence flips xxxConfigured() on — ADR-0088). */
function captureChannels() {
  const emails: Array<{ to: string; text: string; subject: string }> = [];
  const smses: Array<{ phone: string; code: string }> = [];
  const whatsapps: Array<{ phone: string; code: string }> = [];
  setMailer({
    send: (m) => {
      emails.push({ to: m.to, text: m.text, subject: m.subject });
      return Promise.resolve(true);
    },
  });
  setSmsSender({
    sendOtp: (phone, code) => {
      smses.push({ phone, code });
      return Promise.resolve(true);
    },
  });
  setWhatsappSender({
    sendOtp: (phone, code) => {
      whatsapps.push({ phone, code });
      return Promise.resolve(true);
    },
  });
  const lastCode = () => smses.at(-1)?.code ?? null;
  return { emails, smses, whatsapps, lastCode };
}

interface LoginExtras {
  otpCode?: string;
  deviceId?: string | undefined;
  mfaCode?: string;
}
const login = (username: string, extras: LoginExtras = {}, password = PASSWORD) =>
  request(app)
    .post('/api/v2/auth/login')
    .send({ username, password, ...extras });

/** Create a user via the dev seam and set a password; returns the id. */
async function makeUser(over = {}): Promise<string> {
  const res = await request(app).post('/api/v2/users').set(SA).send(userFactory(over));
  const id = res.body.id as string;
  await request(app).post(`/api/v2/users/${id}/password`).set(SA).send({ password: PASSWORD });
  return id;
}

/** Backdate the live challenge's last send so the resend cooldown has elapsed. */
async function elapseCooldown(userId: string): Promise<void> {
  await db!.pool.query(
    `UPDATE auth_otp_challenges SET last_sent_at = now() - interval '61 seconds'
     WHERE user_id = $1 AND consumed_at IS NULL`,
    [userId],
  );
}

describe.skipIf(!RUN)('OTP login verification (ADR-0088)', () => {
  beforeAll(async () => {
    await db!.migrate();
    setPool(db!.pool);
  });
  afterAll(async () => {
    await db!.end();
  });
  beforeEach(async () => {
    await db!.truncate(
      'auth_otp_challenges',
      'auth_trusted_devices',
      'auth_refresh_tokens',
      'user_mfa_secrets',
      'consents',
      'policies',
      'users',
    );
  });
  afterEach(() => {
    setMailer(null);
    setSmsSender(null);
    setWhatsappSender(null);
  });

  it('challenges a flagged role on an unknown device: 401 OTP_REQUIRED, same code on all channels, masked sentTo', async () => {
    const ch = captureChannels();
    const id = await makeUser({ username: 'otp1', role: 'MANAGER', email: EMAIL, phone: PHONE });
    const res = await login('otp1', { deviceId: DEVICE });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('OTP_REQUIRED');
    // all three channels, one code (ADR-0090: email + SMS + WhatsApp fire together)
    expect(ch.smses).toHaveLength(1);
    expect(ch.smses[0]!.phone).toBe('9876543210');
    expect(ch.whatsapps).toHaveLength(1);
    expect(ch.whatsapps[0]!.code).toBe(ch.lastCode()!);
    expect(ch.emails).toHaveLength(1);
    expect(ch.emails[0]!.to).toBe(EMAIL);
    expect(ch.emails[0]!.text).toContain(ch.lastCode()!);
    // masked destinations — never the raw contact
    expect(res.body.details.sentTo).toEqual({
      email: 'o***@crm2.test',
      sms: '******3210',
      whatsapp: '******3210',
    });
    // the WhatsApp delivery flag persisted on the challenge row
    const wa = await db!.pool.query(`SELECT sent_whatsapp FROM auth_otp_challenges WHERE user_id = $1`, [id]);
    expect(wa.rows[0].sent_whatsapp).toBe(true);
    // stored encrypted, never plaintext
    const row = await db!.pool.query(`SELECT code_encrypted FROM auth_otp_challenges WHERE user_id = $1`, [
      id,
    ]);
    expect(row.rows[0].code_encrypted).not.toContain(ch.lastCode()!);
  });

  it('an otp_exempt account skips the new-device OTP gate entirely (Play-review, mig 0122)', async () => {
    captureChannels(); // a deliverable channel must exist or the gate goes inert (warn-and-allow)
    const id = await makeUser({ username: 'otpx', role: 'MANAGER', email: EMAIL, phone: PHONE });
    // control: WITHOUT the flag, a flagged role on an unknown device is challenged.
    expect((await login('otpx', { deviceId: 'exempt-dev-a' })).status).toBe(401);
    // Flip the flag the ONLY way prod ever does — a direct DB update. No API/endpoint writes it.
    await db!.pool.query(`UPDATE users SET otp_exempt = true WHERE id = $1`, [id]);
    // Now the SAME account on a brand-new, untrusted device logs straight in with no code.
    const ok = await login('otpx', { deviceId: 'exempt-dev-b' });
    expect(ok.status).toBe(200);
    expect(ok.body.error).toBeUndefined();
    expect(typeof ok.body.tokens.accessToken).toBe('string');
  });

  it('verifies the code → tokens; the device becomes trusted and skips OTP next login', async () => {
    const ch = captureChannels();
    await makeUser({ username: 'otp2', role: 'MANAGER', email: EMAIL, phone: PHONE });
    await login('otp2', { deviceId: DEVICE });
    const ok = await login('otp2', { deviceId: DEVICE, otpCode: ch.lastCode()! });
    expect(ok.status).toBe(200);
    expect(typeof ok.body.tokens.accessToken).toBe('string');
    // trusted → no new challenge, no new send, straight 200
    const again = await login('otp2', { deviceId: DEVICE });
    expect(again.status).toBe(200);
    expect(ch.smses).toHaveLength(1);
    // ...but a DIFFERENT device is challenged afresh
    const other = await login('otp2', { deviceId: 'other-device' });
    expect(other.status).toBe(401);
    expect(other.body.error).toBe('OTP_REQUIRED');
  });

  it('a used code cannot be replayed (challenge consumed)', async () => {
    const ch = captureChannels();
    await makeUser({ username: 'otp3', role: 'MANAGER', email: EMAIL, phone: PHONE });
    await login('otp3', { deviceId: DEVICE });
    const code = ch.lastCode()!;
    expect((await login('otp3', { deviceId: DEVICE, otpCode: code })).status).toBe(200);
    // wipe the trust so the gate runs again; the consumed challenge must not verify
    await db!.truncate('auth_trusted_devices');
    const replay = await login('otp3', { deviceId: DEVICE, otpCode: code });
    expect(replay.status).not.toBe(200);
  });

  it('wrong codes burn attempts AND feed the account lockout (5 → ACCOUNT_LOCKED)', async () => {
    const ch = captureChannels();
    await makeUser({ username: 'otp4', role: 'MANAGER', email: EMAIL, phone: PHONE });
    await login('otp4', { deviceId: DEVICE });
    expect(ch.lastCode()).not.toBe('000000'); // randomInt(0,1e6) collision odds 1e-6; guards the test
    for (let i = 0; i < 4; i++) {
      const bad = await login('otp4', { deviceId: DEVICE, otpCode: '000000' });
      expect(bad.status).toBe(401);
      expect(bad.body.error).toBe('OTP_REQUIRED');
    }
    const fifth = await login('otp4', { deviceId: DEVICE, otpCode: '000000' });
    expect(fifth.status).toBe(423);
    expect(fifth.body.error).toBe('ACCOUNT_LOCKED');
    // even the right code is refused while locked (lockout precedes the password check)
    const locked = await login('otp4', { deviceId: DEVICE, otpCode: ch.lastCode()! });
    expect(locked.status).toBe(423);
  });

  it('re-login without a code inside the cooldown does NOT resend; after the cooldown it resends the SAME code', async () => {
    const ch = captureChannels();
    const id = await makeUser({ username: 'otp5', role: 'MANAGER', email: EMAIL, phone: PHONE });
    await login('otp5', { deviceId: DEVICE });
    expect(ch.smses).toHaveLength(1);
    const first = ch.lastCode()!;
    // inside the cooldown → silent, still challenged, nothing sent
    const quiet = await login('otp5', { deviceId: DEVICE });
    expect(quiet.status).toBe(401);
    expect(ch.smses).toHaveLength(1);
    // past the cooldown → the SAME code goes out again
    await elapseCooldown(id);
    await login('otp5', { deviceId: DEVICE });
    expect(ch.smses).toHaveLength(2);
    expect(ch.smses[1]!.code).toBe(first);
    // send cap: 3 deliveries max per challenge
    await elapseCooldown(id);
    await login('otp5', { deviceId: DEVICE });
    expect(ch.smses).toHaveLength(3);
    await elapseCooldown(id);
    const capped = await login('otp5', { deviceId: DEVICE });
    expect(capped.status).toBe(401); // still challenged...
    expect(ch.smses).toHaveLength(3); // ...but nothing more is sent
    // the still-valid code from send #1 verifies fine
    expect((await login('otp5', { deviceId: DEVICE, otpCode: first })).status).toBe(200);
  });

  it('trust is a FIXED per-role window: 25h after the last OTP an office device re-challenges (activity does not extend it)', async () => {
    const ch = captureChannels();
    await makeUser({ username: 'otp10', role: 'MANAGER', email: EMAIL, phone: PHONE });
    await login('otp10', { deviceId: DEVICE });
    expect((await login('otp10', { deviceId: DEVICE, otpCode: ch.lastCode()! })).status).toBe(200);
    // inside the window: no challenge
    expect((await login('otp10', { deviceId: DEVICE })).status).toBe(200);
    // 25h past the last OTP — the intervening login must NOT have slid the window
    await db!.pool.query(`UPDATE auth_trusted_devices SET trusted_at = now() - interval '25 hours'`);
    const again = await login('otp10', { deviceId: DEVICE });
    expect(again.status).toBe(401);
    expect(again.body.error).toBe('OTP_REQUIRED');
    // re-verifying resets the clock
    expect((await login('otp10', { deviceId: DEVICE, otpCode: ch.lastCode()! })).status).toBe(200);
    expect((await login('otp10', { deviceId: DEVICE })).status).toBe(200);
  });

  it('a TOTP-enrolled user is challenged for mfaCode, never OTP (no SMS spent)', async () => {
    const ch = captureChannels();
    const id = await makeUser({ username: 'otp6', role: 'MANAGER', email: EMAIL, phone: PHONE });
    const secret = generateTotpSecret();
    await db!.pool.query(
      `INSERT INTO user_mfa_secrets (user_id, secret_encrypted, recovery_code_hashes, recovery_code_used, enrolled_at)
       VALUES ($1, $2, '{}', '{}', now())`,
      [id, encryptSecret(secret)],
    );
    const challenged = await login('otp6', { deviceId: DEVICE });
    expect(challenged.status).toBe(401);
    expect(challenged.body.error).toBe('MFA_REQUIRED');
    const ok = await login('otp6', { deviceId: DEVICE, mfaCode: totp(secret, Date.now()) });
    expect(ok.status).toBe(200);
    expect(ch.smses).toHaveLength(0);
    expect(ch.emails).toHaveLength(0);
  });

  it('gate is inert (warn-and-allow) when the user has no deliverable contact', async () => {
    captureChannels(); // providers configured…
    await makeUser({ username: 'otp7', role: 'MANAGER' });
    // email is required at the API since ADR-0088/0089 — a contact-less user is now a LEGACY row
    // (created before the requirement), so simulate it below the API.
    await db!.pool.query(`UPDATE users SET email = NULL, phone = NULL WHERE username = 'otp7'`);
    const res = await login('otp7', { deviceId: DEVICE });
    expect(res.status).toBe(200);
  });

  it('without a deviceId the login is challenged every time and verify never trusts', async () => {
    const ch = captureChannels();
    await makeUser({ username: 'otp8', role: 'MANAGER', email: EMAIL, phone: PHONE });
    expect((await login('otp8')).status).toBe(401);
    expect((await login('otp8', { otpCode: ch.lastCode()! })).status).toBe(200);
    const trust = await db!.pool.query(`SELECT count(*)::int AS n FROM auth_trusted_devices`);
    expect(trust.rows[0].n).toBe(0);
    // next login: challenged again (a fresh challenge/send — the old one is consumed)
    const again = await login('otp8');
    expect(again.status).toBe(401);
    expect(ch.smses).toHaveLength(2);
  });

  it('FIELD_AGENT (seeded OFF — the mobile release gate) logs in without any OTP', async () => {
    const ch = captureChannels();
    await makeUser({ username: 'otp9', role: 'FIELD_AGENT', email: EMAIL, phone: PHONE });
    const res = await login('otp9', { deviceId: DEVICE });
    expect(res.status).toBe(200);
    expect(ch.smses).toHaveLength(0);
  });

  it('migrations 0113/0114 seed the office roles ON @24h and FIELD_AGENT OFF @720h', async () => {
    const rows = await db!.pool.query(
      `SELECT code, otp_login_required, otp_trust_hours FROM roles ORDER BY code`,
    );
    const map = Object.fromEntries(rows.rows.map((r) => [r.code, r]));
    expect(map['MANAGER']).toMatchObject({ otp_login_required: true, otp_trust_hours: 24 });
    expect(map['SUPER_ADMIN']).toMatchObject({ otp_login_required: true, otp_trust_hours: 24 });
    expect(map['FIELD_AGENT']).toMatchObject({ otp_login_required: false, otp_trust_hours: 720 });
  });
});

describe('normalizeIndianMobile', () => {
  it('accepts separators, +91 and leading 0; rejects short/foreign numbers', () => {
    expect(normalizeIndianMobile('+91 98765 43210')).toBe('9876543210');
    expect(normalizeIndianMobile('09876543210')).toBe('9876543210');
    expect(normalizeIndianMobile('98765-43210')).toBe('9876543210');
    expect(normalizeIndianMobile('12345')).toBeNull();
    expect(normalizeIndianMobile('1234567890')).toBeNull(); // Indian mobiles start 6-9
    expect(normalizeIndianMobile('+44 7700 900123')).toBeNull();
  });
});
