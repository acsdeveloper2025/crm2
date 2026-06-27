import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestDb } from '@crm2/test-utils';
import { setPool } from '../../db.js';
import { signAccessToken } from '../../jwt.js';
import { resolveSocketIdentity, getRealtime, setRealtime } from '../index.js';

const RUN = !!process.env['DATABASE_URL'];
const db = RUN ? createTestDb() : null;
const TTL = 900;
const UID = '00000000-0000-0000-0000-0000000000aa';

describe.skipIf(!RUN)('realtime handshake identity (ADR-0027)', () => {
  beforeAll(async () => {
    await db!.migrate();
    setPool(db!.pool);
  });
  afterAll(async () => {
    await db!.end();
  });

  it('rejects a missing token', async () => {
    expect(await resolveSocketIdentity(null)).toBeNull();
  });

  it('rejects an invalid token', async () => {
    expect(await resolveSocketIdentity('not.a.jwt')).toBeNull();
  });

  it('SUPER_ADMIN resolves and may join the field-monitoring + office rooms (grants_all)', async () => {
    const token = await signAccessToken({ userId: UID, role: 'SUPER_ADMIN' }, TTL);
    const id = await resolveSocketIdentity(token);
    expect(id).toMatchObject({ userId: UID, canFieldMonitoring: true, canOffice: true });
  });

  it('MANAGER may join the field-monitoring + office rooms (holds page.field_monitoring + page.dashboard)', async () => {
    const token = await signAccessToken({ userId: UID, role: 'MANAGER' }, TTL);
    const id = await resolveSocketIdentity(token);
    expect(id?.canFieldMonitoring).toBe(true);
    expect(id?.canOffice).toBe(true);
  });

  it('FIELD_AGENT resolves but may NOT join the field-monitoring or office rooms', async () => {
    const token = await signAccessToken({ userId: UID, role: 'FIELD_AGENT' }, TTL);
    const id = await resolveSocketIdentity(token);
    // page.dashboard is granted to every web role EXCEPT FIELD_AGENT (migration 0047) → no office room.
    expect(id).toMatchObject({ userId: UID, canFieldMonitoring: false, canOffice: false });
  });
});

describe('realtime emit seam (no server)', () => {
  it('getRealtime is a no-op before init and honors a test override', () => {
    // No throw when no socket server is running (tests, worker role).
    expect(() => getRealtime().emitToUser(UID, 'notification', { x: 1 })).not.toThrow();

    const calls: string[] = [];
    setRealtime({
      emitToUser: (userId, event) => calls.push(`user:${userId}:${event}`),
      emitToFieldMonitoring: (event) => calls.push(`fm:${event}`),
      emitToOffice: (event) => calls.push(`office:${event}`),
      disconnectUser: (userId) => calls.push(`disconnect:${userId}`),
    });
    getRealtime().emitToUser(UID, 'notification', {});
    getRealtime().emitToFieldMonitoring('field-monitoring:location-updated', {});
    getRealtime().emitToOffice('case:updated', {});
    setRealtime(null);
    expect(calls).toEqual([
      `user:${UID}:notification`,
      'fm:field-monitoring:location-updated',
      'office:case:updated',
    ]);
  });
});
