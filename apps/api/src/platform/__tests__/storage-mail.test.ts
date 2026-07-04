import { describe, it, expect, afterEach, vi } from 'vitest';
import type { Env } from '@crm2/config';
import { getStorage, setStorage, storageConfigured, type StorageProvider } from '../storage/index.js';
import { getMailer, setMailer, mailConfigured } from '../mail/index.js';

// ADR-0089: the ses transport is exercised against a mocked SDK — the seam's lazy
// dynamic import resolves to this mock, so no network and no real credentials.
const sesSend = vi.fn();
vi.mock('@aws-sdk/client-sesv2', () => ({
  SESv2Client: class {
    send = sesSend;
  },
  SendEmailCommand: class {
    constructor(public readonly input: unknown) {}
  },
}));
import { detectImage, MAX_IMAGE_BYTES } from '../image.js';
import { AppError } from '../errors.js';
import { HTTP_STATUS } from '../http.js';

/** A minimal Env stub for the config-gating checks (only the storage/mail fields are read). */
const env = (over: Partial<Env>): Env =>
  ({ STORAGE_BACKEND: 'local', SMTP_PORT: 587, ...over }) as unknown as Env;

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe('object storage (ADR-0021)', () => {
  afterEach(() => setStorage(null));

  it('is configured only when backend + bucket + credentials are all present', () => {
    expect(storageConfigured(env({ STORAGE_BACKEND: 'local' }))).toBe(false);
    expect(storageConfigured(env({ STORAGE_BACKEND: 's3', S3_BUCKET: 'b' }))).toBe(false); // creds missing
    expect(
      storageConfigured(
        env({ STORAGE_BACKEND: 's3', S3_BUCKET: 'b', S3_ACCESS_KEY_ID: 'k', S3_SECRET_ACCESS_KEY: 's' }),
      ),
    ).toBe(true);
  });

  it('the disabled provider throws STORAGE_NOT_CONFIGURED (503), never a 500', async () => {
    const s = getStorage(env({ STORAGE_BACKEND: 'local' }));
    await expect(s.put('k', Buffer.from('x'), 'image/png')).rejects.toMatchObject({
      status: HTTP_STATUS.SERVICE_UNAVAILABLE,
      code: 'STORAGE_NOT_CONFIGURED',
    });
    await expect(s.signedUrl('k')).rejects.toBeInstanceOf(AppError);
    await expect(s.remove('k')).resolves.toBeUndefined(); // remove is no-op-safe
  });

  it('setStorage injects a fake provider (test seam)', async () => {
    const fake: StorageProvider = {
      put: (key) => Promise.resolve({ key }),
      get: () => Promise.resolve(Buffer.from('')),
      signedUrl: (key) => Promise.resolve(`https://signed/${key}`),
      remove: () => Promise.resolve(),
    };
    setStorage(fake);
    expect(await getStorage().signedUrl('abc')).toBe('https://signed/abc');
  });
});

describe('transactional email (ADR-0021)', () => {
  afterEach(() => setMailer(null));

  it('is configured only when SMTP_HOST is set (smtp) or the ses transport is selected', () => {
    expect(mailConfigured(env({}))).toBe(false);
    expect(mailConfigured(env({ SMTP_HOST: 'smtp.example.com' }))).toBe(true);
    // ADR-0089: MAIL_TRANSPORT=ses is an explicit deploy decision — configured without SMTP_HOST.
    expect(mailConfigured(env({ MAIL_TRANSPORT: 'ses' }))).toBe(true);
  });

  it('ses transport maps the message onto SendEmail and returns true (ADR-0089)', async () => {
    sesSend.mockReset().mockResolvedValueOnce({});
    const m = getMailer(
      env({ MAIL_TRANSPORT: 'ses', SES_REGION: 'ap-south-1', MAIL_FROM: 'CRM2 <no-reply@x.com>' }),
    );
    expect(await m.send({ to: 'a@b.com', subject: 'OTP', text: '123456', html: '<b>123456</b>' })).toBe(true);
    const cmd = sesSend.mock.calls[0]?.[0] as { input: Record<string, unknown> };
    expect(cmd.input).toMatchObject({
      FromEmailAddress: 'CRM2 <no-reply@x.com>',
      Destination: { ToAddresses: ['a@b.com'] },
      Content: {
        Simple: {
          Subject: { Data: 'OTP' },
          Body: { Text: { Data: '123456' }, Html: { Data: '<b>123456</b>' } },
        },
      },
    });
  });

  it('ses transport is best-effort — an SDK failure returns false, never throws (ADR-0089)', async () => {
    sesSend.mockReset().mockRejectedValueOnce(new Error('throttled'));
    setMailer(null); // drop the cached mailer from the previous test
    const m = getMailer(env({ MAIL_TRANSPORT: 'ses' }));
    await expect(m.send({ to: 'a@b.com', subject: 's', text: 't' })).resolves.toBe(false);
  });

  it('the disabled mailer logs-and-skips (returns false, never throws)', async () => {
    const m = getMailer(env({}));
    expect(await m.send({ to: 'a@b.com', subject: 's', text: 't' })).toBe(false);
  });

  it('setMailer injects a fake mailer that records the message', async () => {
    const sent: { to: string }[] = [];
    setMailer({
      send: (msg) => {
        sent.push({ to: msg.to });
        return Promise.resolve(true);
      },
    });
    expect(await getMailer().send({ to: 'x@y.com', subject: 's', text: 't' })).toBe(true);
    expect(sent).toEqual([{ to: 'x@y.com' }]);
  });
});

describe('image detection (magic bytes)', () => {
  it('accepts PNG by leading bytes and rejects non-images', () => {
    expect(detectImage(PNG)).toEqual({ type: 'image/png', ext: 'png' });
    expect(detectImage(Buffer.from('not an image'))).toBeNull();
    expect(MAX_IMAGE_BYTES).toBeGreaterThan(0);
  });

  it('accepts a real WebP but rejects a RIFF-but-not-WEBP container (e.g. .wav/.avi)', () => {
    const riff = [0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00];
    expect(detectImage(Buffer.from([...riff, 0x57, 0x45, 0x42, 0x50]))).toEqual({
      type: 'image/webp',
      ext: 'webp',
    });
    expect(detectImage(Buffer.from([...riff, 0x57, 0x41, 0x56, 0x45]))).toBeNull(); // "WAVE", not "WEBP"
  });
});
