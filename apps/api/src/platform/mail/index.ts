import type { Env } from '@crm2/config';
import { loadEnv } from '@crm2/config';
import { logger } from '@crm2/logger';

/**
 * Transactional-email seam (ADR-0021). Callers depend on this interface, never on nodemailer
 * directly. Sending is ALWAYS best-effort: a mail failure must never block the request that
 * triggered it. The factory returns a real SMTP mailer only when SMTP_HOST is configured; otherwise
 * a disabled mailer that logs-and-skips — deferred-activation (the relay is a deploy step).
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

/** True when an SMTP relay is provisioned for this deployment (an injected test mailer counts —
 *  a caller asking "can I email?" must get yes when setMailer() has supplied one). */
export function mailConfigured(env: Env = loadEnv()): boolean {
  return override !== null || !!env.SMTP_HOST;
}

/** For tests: inject a fake mailer (mirrors setPool). Pass null to restore the real factory. */
export function setMailer(m: Mailer | null): void {
  override = m;
  cached = null;
}

export function getMailer(env: Env = loadEnv()): Mailer {
  if (override) return override;
  if (cached) return cached;
  cached = mailConfigured(env) ? createSmtpMailer(env) : disabledMailer;
  return cached;
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
