import type { Env } from '@crm2/config';
import { loadEnv } from '@crm2/config';
import { logger } from '@crm2/logger';

/**
 * OTP-SMS seam (ADR-0088), mirroring the mail seam (ADR-0021). Callers depend on this interface,
 * never on the Fast2SMS HTTP API directly. Sending is best-effort: a send failure must never crash
 * the request that triggered it (the caller decides what a failed leg means). The factory returns
 * the real Fast2SMS sender only when FAST2SMS_API_KEY + FAST2SMS_OTP_TEMPLATE_ID are configured;
 * otherwise a disabled sender that logs-and-skips — deferred activation (creds are a deploy step).
 */
export interface SmsSender {
  /** true when the provider accepted the message, false when skipped/failed (best-effort). */
  sendOtp(phone: string, code: string): Promise<boolean>;
}

/** Fast2SMS OTP route needs a bare 10-digit Indian mobile: strip separators/+91/leading 0.
 *  Returns null when what remains isn't 10 digits (send is skipped, not errored). */
export function normalizeIndianMobile(phone: string): string | null {
  const digits = phone.replace(/\D/g, '').replace(/^(91|0)(?=\d{10}$)/, '');
  return /^[6-9]\d{9}$/.test(digits) ? digits : null;
}

const last4 = (phone: string): string => `******${phone.slice(-4)}`;

const disabledSender: SmsSender = {
  sendOtp(phone) {
    logger.info('otp sms skipped — Fast2SMS not configured', { phone: last4(phone) });
    return Promise.resolve(false);
  },
};

let override: SmsSender | null = null;
let cached: SmsSender | null = null;

/** True when Fast2SMS is provisioned for this deployment (an injected test sender counts —
 *  mirrors mailConfigured()). */
export function smsConfigured(env: Env = loadEnv()): boolean {
  return override !== null || (!!env.FAST2SMS_API_KEY && !!env.FAST2SMS_OTP_TEMPLATE_ID);
}

/** For tests: inject a fake sender (mirrors setMailer). Pass null to restore the real factory. */
export function setSmsSender(s: SmsSender | null): void {
  override = s;
  cached = null;
}

export function getSmsSender(env: Env = loadEnv()): SmsSender {
  if (override) return override;
  if (cached) return cached;
  cached = smsConfigured(env) ? createFast2SmsSender(env) : disabledSender;
  return cached;
}

const FAST2SMS_OTP_URL = 'https://www.fast2sms.com/dev/otp/send';
const SEND_TIMEOUT_MS = 10_000;

/** Real sender — Fast2SMS OTP route (docs.fast2sms.com/reference/send-otp): header-auth POST with
 *  our own code (`otp`) so the SMS carries the SAME code as the email leg. Native fetch, no dep. */
function createFast2SmsSender(env: Env): SmsSender {
  return {
    async sendOtp(phone, code) {
      const mobile = normalizeIndianMobile(phone);
      if (!mobile) {
        logger.warn('otp sms skipped — phone not a 10-digit Indian mobile', { phone: last4(phone) });
        return false;
      }
      try {
        const res = await fetch(FAST2SMS_OTP_URL, {
          method: 'POST',
          headers: { authorization: env.FAST2SMS_API_KEY as string, 'content-type': 'application/json' },
          body: JSON.stringify({ mobile, otp_id: env.FAST2SMS_OTP_TEMPLATE_ID, otp: code }),
          signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
        });
        const body = (await res.json().catch(() => null)) as {
          return?: boolean;
          request_id?: string;
          message?: string;
        } | null;
        if (!res.ok || body?.return !== true) {
          logger.error('otp sms send failed', {
            phone: last4(mobile),
            status: res.status,
            provider: body?.message,
          });
          return false;
        }
        // the daily-cost metric line (ADR-0088 §5): one INFO per accepted SMS, grep/count-able.
        logger.info('otp sms sent', { phone: last4(mobile), requestId: body.request_id });
        return true;
      } catch (err) {
        logger.error('otp sms send failed', {
          phone: last4(mobile),
          err: err instanceof Error ? err.message : String(err),
        });
        return false;
      }
    },
  };
}
