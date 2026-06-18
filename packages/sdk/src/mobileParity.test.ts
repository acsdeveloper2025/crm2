import { describe, it, expect } from 'vitest';
import { AcceptConsentSchema } from './consents.js';
import { TelemetryIngestSchema } from './telemetry.js';
import { VersionCheckSchema } from './version.js';
import { MuteNotificationSchema, UpdateNotificationPreferencesSchema } from './notifications.js';

/** Exercises the mobile-parity input schemas (the device-facing contracts). */
describe('mobile parity input schemas', () => {
  it('AcceptConsentSchema requires a positive integer policyVersion', () => {
    expect(AcceptConsentSchema.parse({ policyVersion: 3 })).toEqual({ policyVersion: 3 });
    expect(() => AcceptConsentSchema.parse({ policyVersion: 0 })).toThrow();
    expect(() => AcceptConsentSchema.parse({})).toThrow();
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

  it('UpdateNotificationPreferencesSchema takes an opaque preferences map', () => {
    expect(
      UpdateNotificationPreferencesSchema.parse({ preferences: { push: false, x: 1 } }).preferences,
    ).toEqual({ push: false, x: 1 });
    expect(() => UpdateNotificationPreferencesSchema.parse({})).toThrow();
  });
});
