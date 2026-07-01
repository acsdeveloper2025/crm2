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

  // AUTHENTICATION-03 (docs/audit/01-authentication.md): a length/entropy floor beyond just
  // rejecting the literal dev-default string.
  it('throws in production when a secret is too short, even if not the dev default', () => {
    expect(() =>
      loadEnv({ ...base, NODE_ENV: 'production', JWT_SECRET: 'short-but-not-the-default' }),
    ).toThrow(/JWT_SECRET/);
  });

  it('throws in production when a secret is long but low-entropy (few distinct chars)', () => {
    expect(() =>
      loadEnv({ ...base, NODE_ENV: 'production', MFA_ENC_KEY: 'ababababababababababababababababab' }),
    ).toThrow(/MFA_ENC_KEY/);
  });

  it('accepts an openssl-rand-style base64 secret', () => {
    expect(() =>
      loadEnv({
        ...base,
        NODE_ENV: 'production',
        JWT_SECRET: 'Zt8bQmP2vX9nK4wR7yL1cH6sJ0dF3gT5aE8iU2oN4qW7',
        MFA_ENC_KEY: 'Hq3vXpL9wK2mN7bR5tY8dJ1sF4gU6oE0aC3iZ7',
      }),
    ).not.toThrow();
  });
});
