import type { Env } from '@crm2/config';
import { loadEnv } from '@crm2/config';
import { logger } from '@crm2/logger';

/**
 * Transactional-email seam (ADR-0021). Callers depend on this interface, never on a transport
 * directly. Sending is ALWAYS best-effort: a mail failure must never block the request that
 * triggered it. Two transports (ADR-0089), selected by MAIL_TRANSPORT:
 *   smtp (default) — nodemailer, configured when SMTP_HOST is set
 *   ses            — SES API over HTTPS/443 (for hosts whose datacenter blocks outbound SMTP
 *                    ports entirely, as the staging box's does); creds via SES_* env or the
 *                    SDK default chain (EC2 instance role)
 * Unconfigured deployments get a disabled mailer that logs-and-skips — deferred-activation.
 */
export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}
export interface Mailer {
  /** Returns true when the message was handed to the transport, false when skipped/failed (best-effort). */
  send(msg: MailMessage): Promise<boolean>;
}

/** The deferred-activation mailer: logs the intent and skips (no throw). */
const disabledMailer: Mailer = {
  send(msg) {
    logger.info('email skipped — SMTP not configured', { to: msg.to, subject: msg.subject });
    return Promise.resolve(false);
  },
};

let override: Mailer | null = null;
let cached: Mailer | null = null;

/** True when a mail transport is provisioned for this deployment (an injected test mailer counts —
 *  a caller asking "can I email?" must get yes when setMailer() has supplied one). */
export function mailConfigured(env: Env = loadEnv()): boolean {
  if (override !== null) return true;
  // ses is an explicit deploy decision — the SDK resolves credentials (env keys or instance role).
  if (env.MAIL_TRANSPORT === 'ses') return true;
  return !!env.SMTP_HOST;
}

/** For tests: inject a fake mailer (mirrors setPool). Pass null to restore the real factory. */
export function setMailer(m: Mailer | null): void {
  override = m;
  cached = null;
}

export function getMailer(env: Env = loadEnv()): Mailer {
  if (override) return override;
  if (cached) return cached;
  cached = !mailConfigured(env)
    ? disabledMailer
    : env.MAIL_TRANSPORT === 'ses'
      ? createSesMailer(env)
      : createSmtpMailer(env);
  return cached;
}

/** SES API mailer (ADR-0089). The SDK is imported lazily so smtp/unconfigured deployments never
 *  load it; the client is built once, on first use. Rides HTTPS/443 — immune to SMTP port blocks. */
function createSesMailer(env: Env): Mailer {
  async function loadClient() {
    const lib = await import('@aws-sdk/client-sesv2');
    const client = new lib.SESv2Client({
      region: env.SES_REGION,
      ...(env.SES_ACCESS_KEY_ID && env.SES_SECRET_ACCESS_KEY
        ? {
            credentials: {
              accessKeyId: env.SES_ACCESS_KEY_ID,
              secretAccessKey: env.SES_SECRET_ACCESS_KEY,
            },
          }
        : {}),
    });
    return { client, lib };
  }
  let ctx: ReturnType<typeof loadClient> | null = null;
  return {
    async send(msg) {
      try {
        ctx ??= loadClient();
        const { client, lib } = await ctx;
        await client.send(
          new lib.SendEmailCommand({
            FromEmailAddress: env.MAIL_FROM,
            Destination: { ToAddresses: [msg.to] },
            Content: {
              Simple: {
                Subject: { Data: msg.subject, Charset: 'UTF-8' },
                Body: {
                  Text: { Data: msg.text, Charset: 'UTF-8' },
                  ...(msg.html ? { Html: { Data: msg.html, Charset: 'UTF-8' } } : {}),
                },
              },
            },
          }),
        );
        return true;
      } catch (err) {
        // best-effort: never propagate — the caller's primary action already succeeded.
        logger.error('email send failed', {
          to: msg.to,
          subject: msg.subject,
          err: err instanceof Error ? err.message : String(err),
        });
        return false;
      }
    },
  };
}

/** Real mailer. nodemailer is imported lazily so an unconfigured deployment never loads it. */
function createSmtpMailer(env: Env): Mailer {
  const host = env.SMTP_HOST as string;
  async function transport() {
    const nodemailer = await import('nodemailer');
    return nodemailer.createTransport({
      host,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      ...(env.SMTP_USER ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD ?? '' } } : {}),
    });
  }
  let tx: ReturnType<typeof transport> | null = null;
  return {
    async send(msg) {
      try {
        tx ??= transport();
        await (
          await tx
        ).sendMail({
          from: env.MAIL_FROM,
          to: msg.to,
          subject: msg.subject,
          text: msg.text,
          ...(msg.html ? { html: msg.html } : {}),
        });
        return true;
      } catch (err) {
        // best-effort: never propagate — the caller's primary action already succeeded.
        logger.error('email send failed', {
          to: msg.to,
          subject: msg.subject,
          err: err instanceof Error ? err.message : String(err),
        });
        return false;
      }
    },
  };
}
