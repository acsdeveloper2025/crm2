import { describe, it, expect } from 'vitest';
import { loadEnv } from '@crm2/config';
import { hashPassword, verifyPassword } from '../password.js';

describe('password hashing (scrypt)', () => {
  it('hashes to the scrypt$N$r$p$salt$hash format at the configured work factor', async () => {
    const h = await hashPassword('correct horse');
    // r=8, p=1 are fixed; N is the configured work factor (prod default 16384, lowered in tests).
    expect(h.startsWith(`scrypt$${loadEnv().PASSWORD_SCRYPT_N}$8$1$`)).toBe(true);
    expect(h.split('$')).toHaveLength(6);
  });

  it('verifies the correct password and rejects a wrong one', async () => {
    const h = await hashPassword('s3cret-pass');
    expect(await verifyPassword('s3cret-pass', h)).toBe(true);
    expect(await verifyPassword('wrong-pass', h)).toBe(false);
  });

  it('uses a unique salt per hash (same input → different stored value)', async () => {
    expect(await hashPassword('same')).not.toBe(await hashPassword('same'));
  });

  it('rejects a malformed stored hash', async () => {
    expect(await verifyPassword('x', 'not-a-hash')).toBe(false);
    expect(await verifyPassword('x', 'scrypt$16384$8$1$onlyfive')).toBe(false);
  });
});
