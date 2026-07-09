import type { Env } from '@crm2/config';
import { loadEnv } from '@crm2/config';
import { logger } from '@crm2/logger';

/**
 * OTP-SMS seam (ADR-0088), mirroring the mail seam (ADR-0021). Callers depend on this interface,
 * never on the Fast2SMS HTTP API directly. Sending is best-effort: a send failure must never crash
 * the request that triggered it (the caller decides what a failed leg means). The factory returns
 * the real Fast2SMS DLT sender only when FAST2SMS_API_KEY + FAST2SMS_OTP_TEMPLATE_ID +
 * FAST2SMS_SENDER_ID are all configured; otherwise a disabled sender that logs-and-skips — deferred
 * activation (the DLT header/template/creds are a deploy step, not code).
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
  return (
    override !== null ||
    (!!env.FAST2SMS_API_KEY && !!env.FAST2SMS_OTP_TEMPLATE_ID && !!env.FAST2SMS_SENDER_ID)
  );
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

const FAST2SMS_DLT_URL = 'https://www.fast2sms.com/dev/bulkV2';
const SEND_TIMEOUT_MS = 10_000;

/** Real sender — Fast2SMS DLT route (docs.fast2sms.com, route=dlt): the SMS is sent from the approved
 *  header (`sender_id`) using the registered content template (`message` = the DLT template id, which
 *  Fast2SMS resolves to the approved text), with our code passed as the single template variable
 *  (`variables_values`) so the SMS carries the SAME code as the email/WhatsApp legs. The API key rides
 *  the `authorization` header (kept out of the URL/query so it can't leak into access logs). Native
 *  fetch, no dep. Multi-variable templates would pipe-join `variables_values`; ours is one var (the code). */
function createFast2SmsSender(env: Env): SmsSender {
  return {
    async sendOtp(phone, code) {
      const mobile = normalizeIndianMobile(phone);
      if (!mobile) {
        logger.warn('otp sms skipped — phone not a 10-digit Indian mobile', { phone: last4(phone) });
        return false;
      }
      try {
        const form = new URLSearchParams({
          route: 'dlt',
          sender_id: env.FAST2SMS_SENDER_ID as string,
          message: env.FAST2SMS_OTP_TEMPLATE_ID as string,
          variables_values: code,
          flash: '0',
          numbers: mobile,
        });
        const res = await fetch(FAST2SMS_DLT_URL, {
          method: 'POST',
          headers: {
            authorization: env.FAST2SMS_API_KEY as string,
            'content-type': 'application/x-www-form-urlencoded',
          },
          body: form.toString(),
          signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
        });
        // bulkV2 returns { return:true, request_id, message:[...] } on success; { return:false, message }
        // (string) on error — type message loosely to accept both shapes.
        const body = (await res.json().catch(() => null)) as {
          return?: boolean;
          request_id?: string;
          message?: unknown;
        } | null;
        if (!res.ok || body?.return !== true) {
          logger.error('otp sms send failed', {
            phone: last4(mobile),
            status: res.status,
            provider: typeof body?.message === 'string' ? body.message : JSON.stringify(body?.message),
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
