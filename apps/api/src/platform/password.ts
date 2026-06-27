import { scrypt, randomBytes, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import { loadEnv } from '@crm2/config';

/**
 * Password hashing via Node's built-in scrypt (ADR-0014 — no external dependency).
 * Stored format: `scrypt$N$r$p$<saltB64>$<hashB64>`.
 */
const scryptAsync = (plain: string, salt: Buffer, keylen: number, options: ScryptOptions): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    scrypt(plain, salt, keylen, options, (err, derivedKey) => (err ? reject(err) : resolve(derivedKey)));
  });

// CPU/memory cost — prod 16384 (~2s); the test env lowers it (PASSWORD_SCRYPT_N) so scrypt can't
// saturate the threadpool and reset supertest sockets under CI load. Verification reads N from the
// stored hash, so this only sets the cost of NEWLY minted hashes.
const N = (): number => loadEnv().PASSWORD_SCRYPT_N;
const R = 8; // block size
const P = 1; // parallelization
const KEYLEN = 32;
const SALT_BYTES = 16;
const MAX_MEM = 64 * 1024 * 1024; // scrypt needs >128*N*r bytes; raise the default ceiling

const b64 = (buf: Buffer): string => buf.toString('base64url');

export async function hashPassword(plain: string): Promise<string> {
  const n = N();
  const salt = randomBytes(SALT_BYTES);
  const derived = await scryptAsync(plain, salt, KEYLEN, { N: n, r: R, p: P, maxmem: MAX_MEM });
  return `scrypt$${n}$${R}$${P}$${b64(salt)}$${b64(derived)}`;
}

/**
 * Mint a random one-time password that satisfies the strong policy (lower+upper+digit+symbol).
 * Used by the admin "generate one-time password" action (shown once; the user must change it on
 * first login). One char is drawn from each class to guarantee the policy, then filled + shuffled.
 */
export function generateTempPassword(length = 14): string {
  const lower = 'abcdefghijkmnopqrstuvwxyz';
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const digit = '23456789';
  const symbol = '!@#$%^&*-_=+';
  const all = lower + upper + digit + symbol;
  const pick = (set: string): string => set[randomBytes(1)[0]! % set.length]!;
  const chars = [pick(lower), pick(upper), pick(digit), pick(symbol)];
  for (let i = chars.length; i < length; i++) chars.push(pick(all));
  // Fisher–Yates shuffle with crypto bytes so the guaranteed chars aren't always in front.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomBytes(1)[0]! % (i + 1);
    [chars[i], chars[j]] = [chars[j]!, chars[i]!];
  }
  return chars.join('');
}

/**
 * Anti-enumeration (ADR-0076): verifying against a throwaway dummy hash makes an unknown-username
 * login spend the SAME scrypt cost as a real one, so response latency can't reveal whether a
 * username exists. The dummy hash is minted once (lazily, at the current env's cost factor) and
 * cached, so every environment self-tunes — including the low-N test env. Always returns false.
 */
let dummyHash: Promise<string> | null = null;
export async function verifyDummyPassword(plain: string): Promise<void> {
  dummyHash ??= hashPassword(randomBytes(24).toString('base64url'));
  await verifyPassword(plain, await dummyHash);
}

export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  const salt = Buffer.from(parts[4] ?? '', 'base64url');
  const expected = Buffer.from(parts[5] ?? '', 'base64url');
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p) || expected.length === 0)
    return false;
  const derived = await scryptAsync(plain, salt, expected.length, { N: n, r, p, maxmem: MAX_MEM });
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}
