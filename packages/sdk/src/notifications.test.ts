import { describe, it, expect } from 'vitest';
import { NOTIFICATION_TYPES, NOTIFICATION_ACTION_TYPES, RegisterPushTokenSchema } from './notifications.js';

describe('notification contract (ADR-0027)', () => {
  it('exposes the notification types the DB CHECK whitelists', () => {
    expect([...NOTIFICATION_TYPES]).toEqual([
      'CASE_TASK_ASSIGNED',
      'CASE_TASK_REASSIGNED',
      'TASK_COMPLETED',
      'TASK_SUBMITTED_FOR_REVIEW',
      'TASK_REVOKED',
      'CASE_ASSIGNED',
      'SYSTEM',
      'JOB_COMPLETED', // ADR-0030 background jobs
      'JOB_FAILED',
    ]);
  });
  it('exposes the navigation action types', () => {
    expect([...NOTIFICATION_ACTION_TYPES]).toEqual(['OPEN_CASE', 'OPEN_TASK', 'NAVIGATE', 'DOWNLOAD']);
  });

  it('push-register normalizes the device lowercase platform + strips extra keys (mobile compat)', () => {
    const parsed = RegisterPushTokenSchema.parse({
      pushToken: 'tok',
      platform: 'android', // device sends Platform.OS lowercase
      deviceId: 'dev-1',
      enabled: true, // v1 extra key — ignored
    });
    expect(parsed).toEqual({ pushToken: 'tok', platform: 'ANDROID', deviceId: 'dev-1' });
    expect(RegisterPushTokenSchema.parse({ pushToken: 't', platform: 'iOS' }).platform).toBe('IOS');
    expect(() => RegisterPushTokenSchema.parse({ pushToken: 't', platform: 'symbian' })).toThrow();
  });
});
