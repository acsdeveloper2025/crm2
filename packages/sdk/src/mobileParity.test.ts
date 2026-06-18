import { describe, it, expect } from 'vitest';
import { AcceptConsentSchema } from './consents.js';
import { TelemetryIngestSchema } from './telemetry.js';
import { VersionCheckSchema } from './version.js';
import { MuteNotificationSchema, UpdateNotificationPreferencesSchema } from './notifications.js';
import { LoginSchema } from './auth.js';
import { LocationCaptureSchema } from './location.js';

/** Exercises the mobile-parity input schemas (the device-facing contracts). */
describe('mobile parity input schemas', () => {
  it('AcceptConsentSchema coerces policyVersion (device number OR numeric string)', () => {
    expect(AcceptConsentSchema.parse({ policyVersion: 3 })).toEqual({ policyVersion: 3 });
    expect(AcceptConsentSchema.parse({ policyVersion: '5' })).toEqual({ policyVersion: 5 }); // mobile string
    expect(() => AcceptConsentSchema.parse({ policyVersion: 0 })).toThrow();
    expect(() => AcceptConsentSchema.parse({})).toThrow();
  });

  it('LocationCaptureSchema accepts the device task-capture source GPS (+ TRACKING/ADMIN_PING)', () => {
    const base = { latitude: 28.6, longitude: 77.2, timestamp: '2026-06-18T08:00:00.000Z', accuracy: 5 };
    expect(LocationCaptureSchema.parse({ ...base, source: 'GPS' }).source).toBe('GPS');
    expect(LocationCaptureSchema.parse({ ...base, source: 'NETWORK' }).source).toBe('NETWORK');
    expect(LocationCaptureSchema.parse({ ...base, source: 'TRACKING' }).source).toBe('TRACKING');
    expect(() => LocationCaptureSchema.parse({ ...base, source: 'BOGUS' })).toThrow();
  });

  it('TelemetryIngestSchema accepts an optional events array (or empty body)', () => {
    expect(TelemetryIngestSchema.parse({ events: [{ a: 1 }, { b: 2 }] }).events).toHaveLength(2);
    expect(TelemetryIngestSchema.parse({})).toEqual({});
  });

  it('VersionCheckSchema normalizes the device lowercase platform to UPPERCASE', () => {
    expect(VersionCheckSchema.parse({ currentVersion: '1.0.56', platform: 'android' })).toEqual({
      currentVersion: '1.0.56',
      platform: 'ANDROID',
    });
    expect(VersionCheckSchema.parse({ currentVersion: '1.0', platform: 'IOS' }).platform).toBe('IOS');
    expect(() => VersionCheckSchema.parse({ currentVersion: '1.0', platform: 'symbian' })).toThrow();
    expect(() => VersionCheckSchema.parse({ platform: 'ANDROID' })).toThrow();
  });

  it('MuteNotificationSchema requires a uuid taskId; expiresAt optional/nullable', () => {
    const TASK = '11111111-1111-4111-8111-111111111111';
    expect(MuteNotificationSchema.parse({ taskId: TASK }).taskId).toBe(TASK);
    expect(
      MuteNotificationSchema.parse({ taskId: TASK, expiresAt: '2099-01-01T00:00:00.000Z' }).expiresAt,
    ).toBe('2099-01-01T00:00:00.000Z');
    expect(MuteNotificationSchema.parse({ taskId: TASK, expiresAt: null }).expiresAt).toBeNull();
    expect(() => MuteNotificationSchema.parse({ taskId: 'nope' })).toThrow();
  });

  it('UpdateNotificationPreferencesSchema accepts {preferences} OR a flat toggle body (mobile)', () => {
    expect(
      UpdateNotificationPreferencesSchema.parse({ preferences: { push: false, x: 1 } }).preferences,
    ).toEqual({ push: false, x: 1 });
    // the field app sends a FLAT body → wrapped into { preferences }
    expect(
      UpdateNotificationPreferencesSchema.parse({ push: false, taskAssigned: true }).preferences,
    ).toEqual({ push: false, taskAssigned: true });
  });

  it('LoginSchema accepts deviceInfo as a string OR the device object (stringified)', () => {
    expect(LoginSchema.parse({ username: 'u', password: 'p', deviceInfo: 'Pixel 8' }).deviceInfo).toBe(
      'Pixel 8',
    );
    const parsed = LoginSchema.parse({
      username: 'u',
      password: 'p',
      deviceInfo: { brand: 'Samsung', model: 'SM-G991B', os: 'Android 14' }, // the RN device object
    });
    expect(typeof parsed.deviceInfo).toBe('string');
    expect(parsed.deviceInfo).toContain('Samsung');
    expect(LoginSchema.parse({ username: 'u', password: 'p' }).deviceInfo).toBeUndefined();
  });
});
