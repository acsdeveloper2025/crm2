import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * RFC 6238 TOTP / RFC 4226 HOTP via Node's built-in crypto (no dependency — same policy as the
 * scrypt password hashing). Authenticator apps (Google Authenticator, Authy, …) consume the base32
 * secret through an `otpauth://` URI. Verification allows a ±1 step window for clock drift.
 */
const STEP_SECONDS = 30;
const DIGITS = 6;
const SECRET_BYTES = 20; // 160-bit shared secret (RFC 4226 recommended)
const DRIFT_WINDOW = 1; // accept the previous/next 30s step
const B32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const BYTE = 8;
const B32_BITS = 5;
const TEN = 10;

/** base32-encode (RFC 4648, no padding) — the form authenticator apps expect in the otpauth URI. */
export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << BYTE) | byte;
    bits += BYTE;
    while (bits >= B32_BITS) {
      out += B32_ALPHABET[(value >>> (bits - B32_BITS)) & 31];
      bits -= B32_BITS;
    }
  }
  if (bits > 0) out += B32_ALPHABET[(value << (B32_BITS - bits)) & 31];
  return out;
}

function base32Decode(str: string): Buffer {
  const clean = str.toUpperCase().replace(/=+$/, '').replace(/\s/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32_ALPHABET.indexOf(ch);
    if (idx === -1) continue;
    value = (value << B32_BITS) | idx;
    bits += B32_BITS;
    if (bits >= BYTE) {
      out.push((value >>> (bits - BYTE)) & 255);
      bits -= BYTE;
    }
  }
  return Buffer.from(out);
}

/** A fresh 160-bit secret, base32-encoded for storage + the otpauth URI. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(SECRET_BYTES));
}

function hotp(secret: Buffer, counter: number): string {
  const buf = Buffer.alloc(BYTE);
  // 8-byte big-endian counter (high 32 bits are ~0 for any realistic time step).
  buf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const hmac = createHmac('sha1', secret).update(buf).digest();
  const offset = hmac[hmac.length - 1]! & 0xf;
  const bin =
    ((hmac[offset]! & 0x7f) << 24) |
    ((hmac[offset + 1]! & 0xff) << 16) |
    ((hmac[offset + 2]! & 0xff) << 8) |
    (hmac[offset + 3]! & 0xff);
  return (bin % TEN ** DIGITS).toString().padStart(DIGITS, '0');
}

/** The current TOTP code for a base32 secret (for tests + the verify window). */
export function totp(secretB32: string, atMs: number): string {
  return hotp(base32Decode(secretB32), Math.floor(atMs / 1000 / STEP_SECONDS));
}

/** Constant-time verify of a user-supplied 6-digit code, accepting a ±1 step drift window. */
export function verifyTotp(secretB32: string, code: string, atMs: number): boolean {
  const cleaned = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(cleaned)) return false;
  const secret = base32Decode(secretB32);
  const step = Math.floor(atMs / 1000 / STEP_SECONDS);
  for (let w = -DRIFT_WINDOW; w <= DRIFT_WINDOW; w++) {
    const expected = hotp(secret, step + w);
    if (expected.length === cleaned.length && timingSafeEqual(Buffer.from(expected), Buffer.from(cleaned)))
      return true;
  }
  return false;
}

/** otpauth:// URI the FE renders as a QR code for the authenticator app to scan. */
export function otpauthUri(secretB32: string, account: string, issuer = 'CRM2'): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret: secretB32,
    issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
