import { describe, it, expect, beforeEach } from 'vitest';
import { loadEnv, __resetEnv } from './index.js';

const base = { DATABASE_URL: 'postgres://u:p@localhost:5432/db' };

describe('secret fail-fast (ADR-0076)', () => {
  beforeEach(() => __resetEnv());

  it('throws in production when JWT_SECRET is the dev default', () => {
    expect(() =>
      loadEnv({ ...base, NODE_ENV: 'production', JWT_SECRET: 'dev-only-insecure-secret-change-me' }),
    ).toThrow(/JWT_SECRET/);
  });

  it('throws in production when MFA_ENC_KEY is the dev default', () => {
    expect(() =>
      loadEnv({ ...base, NODE_ENV: 'production', MFA_ENC_KEY: 'dev-only-insecure-mfa-key-change-me' }),
    ).toThrow(/MFA_ENC_KEY/);
  });

  it('accepts real secrets in production', () => {
    expect(() =>
      loadEnv({
        ...base,
        NODE_ENV: 'production',
        JWT_SECRET: 'a-real-strong-production-secret-value',
        MFA_ENC_KEY: 'a-real-strong-production-mfa-key-value',
      }),
    ).not.toThrow();
  });

  it('allows the dev defaults outside production', () => {
    expect(() => loadEnv({ ...base, NODE_ENV: 'development' })).not.toThrow();
  });
});
