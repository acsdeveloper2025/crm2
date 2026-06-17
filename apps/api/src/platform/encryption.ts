import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { loadEnv } from '@crm2/config';

/**
 * Symmetric encryption for secrets at rest (the TOTP shared secret) via AES-256-GCM with a key
 * derived from `MFA_ENC_KEY` (env). Built-in crypto only — same no-dependency policy as scrypt/TOTP.
 * Stored format: `v1:<ivB64>:<tagB64>:<ciphertextB64>`.
 */
const IV_BYTES = 12; // GCM standard nonce length
const KEY_BYTES = 32; // AES-256
const KEY_SALT = 'acs-mfa-enc-v1'; // fixed salt: the env key is the secret, scrypt just stretches it
const VERSION = 'v1';

let cachedKey: Buffer | null = null;
function key(): Buffer {
  if (!cachedKey) cachedKey = scryptSync(loadEnv().MFA_ENC_KEY, KEY_SALT, KEY_BYTES);
  return cachedKey;
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${VERSION}:${iv.toString('base64')}:${tag.toString('base64')}:${ct.toString('base64')}`;
}

export function decryptSecret(stored: string): string {
  const parts = stored.split(':');
  if (parts.length !== 4 || parts[0] !== VERSION) throw new Error('bad ciphertext format');
  const iv = Buffer.from(parts[1]!, 'base64');
  const tag = Buffer.from(parts[2]!, 'base64');
  const ct = Buffer.from(parts[3]!, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}
