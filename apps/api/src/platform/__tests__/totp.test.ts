import { describe, it, expect } from 'vitest';
import { generateTotpSecret, totp, verifyTotp, base32Encode, otpauthUri } from '../totp.js';
import { encryptSecret, decryptSecret } from '../encryption.js';

describe('TOTP (RFC 6238)', () => {
  it('a freshly generated code verifies against its secret', () => {
    const secret = generateTotpSecret();
    const now = 1_700_000_000_000;
    const code = totp(secret, now);
    expect(code).toMatch(/^\d{6}$/);
    expect(verifyTotp(secret, code, now)).toBe(true);
  });

  it('accepts a ±1 step (30s) drift window but rejects beyond it', () => {
    const secret = generateTotpSecret();
    const now = 1_700_000_000_000;
    const code = totp(secret, now);
    expect(verifyTotp(secret, code, now + 30_000)).toBe(true); // next step
    expect(verifyTotp(secret, code, now - 30_000)).toBe(true); // prev step
    expect(verifyTotp(secret, code, now + 120_000)).toBe(false); // 4 steps away
  });

  it('rejects a wrong code and malformed input', () => {
    const secret = generateTotpSecret();
    const now = 1_700_000_000_000;
    const code = totp(secret, now);
    const other = code === '000000' ? '111111' : '000000';
    expect(verifyTotp(secret, other, now)).toBe(false);
    expect(verifyTotp(secret, 'abc', now)).toBe(false);
    expect(verifyTotp(secret, '12345', now)).toBe(false);
  });

  it('matches the RFC 4648 base32 test vector and builds an otpauth URI', () => {
    expect(base32Encode(Buffer.from('foobar'))).toBe('MZXW6YTBOI');
    const uri = otpauthUri('JBSWY3DPEHPK3PXP', 'alice');
    expect(uri.startsWith('otpauth://totp/')).toBe(true);
    expect(uri).toContain('secret=JBSWY3DPEHPK3PXP');
  });
});

describe('secret encryption (AES-256-GCM)', () => {
  it('round-trips a secret and produces distinct ciphertexts per call (random IV)', () => {
    const secret = generateTotpSecret();
    const a = encryptSecret(secret);
    const b = encryptSecret(secret);
    expect(a).not.toBe(b); // random IV → different ciphertext
    expect(decryptSecret(a)).toBe(secret);
    expect(decryptSecret(b)).toBe(secret);
  });

  it('rejects tampered ciphertext (GCM auth tag)', () => {
    const enc = encryptSecret('JBSWY3DPEHPK3PXP');
    const parts = enc.split(':');
    const tampered = `${parts[0]}:${parts[1]}:${parts[2]}:${Buffer.from('zzzz').toString('base64')}`;
    expect(() => decryptSecret(tampered)).toThrow();
  });
});
