import type { Env } from '@crm2/config';
import { loadEnv } from '@crm2/config';
import { logger } from '@crm2/logger';
import { normalizeIndianMobile } from './sms.js';

/**
 * OTP-WhatsApp seam (ADR-0090), mirroring the SMS seam (sms.ts) and the SES mail transport
 * (mail/index.ts). Callers depend on this interface, never on the AWS SDK directly. Sending is
 * best-effort: a send failure must never crash the request that triggered it. The factory returns
 * the real AWS End User Messaging (Social) sender only when WHATSAPP_PHONE_NUMBER_ID +
 * WHATSAPP_TEMPLATE_NAME are configured; otherwise a disabled sender that logs-and-skips —
 * deferred activation (WABA + Meta template approval + creds are a deploy step).
 *
 * The AWS SDK is imported lazily so an unconfigured/other-channel deployment never loads it.
 * Credentials resolve via the SDK default chain (prod EC2 instance role) or the static AWS keys
 * already in the staging box env; region is the app's SES region (same AWS messaging region).
 */
export interface WhatsappSender {
  /** true when AWS accepted the message, false when skipped/failed (best-effort). */
  sendOtp(phone: string, code: string): Promise<boolean>;
}

const last4 = (phone: string): string => `******${phone.slice(-4)}`;

const disabledSender: WhatsappSender = {
  sendOtp(phone) {
    logger.info('otp whatsapp skipped — AWS EUM Social not configured', { phone: last4(phone) });
    return Promise.resolve(false);
  },
};

let override: WhatsappSender | null = null;
let cached: WhatsappSender | null = null;

/** True when WhatsApp is provisioned for this deployment (an injected test sender counts —
 *  mirrors smsConfigured()/mailConfigured()). */
export function whatsappConfigured(env: Env = loadEnv()): boolean {
  return override !== null || (!!env.WHATSAPP_PHONE_NUMBER_ID && !!env.WHATSAPP_TEMPLATE_NAME);
}

/** For tests: inject a fake sender (mirrors setSmsSender). Pass null to restore the real factory. */
export function setWhatsappSender(s: WhatsappSender | null): void {
  override = s;
  cached = null;
}

export function getWhatsappSender(env: Env = loadEnv()): WhatsappSender {
  if (override) return override;
  if (cached) return cached;
  cached = whatsappConfigured(env) ? createAwsWhatsappSender(env) : disabledSender;
  return cached;
}

/** Build the WhatsApp Cloud API template payload carrying OUR code (so WhatsApp delivers the SAME
 *  code as the email leg). Body param + the authentication template's copy-code button both get it. */
function otpTemplatePayload(env: Env, e164: string, code: string): string {
  return JSON.stringify({
    messaging_product: 'whatsapp',
    to: e164,
    type: 'template',
    template: {
      name: env.WHATSAPP_TEMPLATE_NAME,
      language: { code: env.WHATSAPP_TEMPLATE_LANG },
      components: [
        { type: 'body', parameters: [{ type: 'text', text: code }] },
        { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: code }] },
      ],
    },
  });
}

/** Real sender — AWS EUM Social SendWhatsAppMessage over HTTPS. `message` is a Uint8Array blob of the
 *  WhatsApp Cloud API payload. Built once, on first use. */
function createAwsWhatsappSender(env: Env): WhatsappSender {
  async function loadClient() {
    const lib = await import('@aws-sdk/client-socialmessaging');
    const client = new lib.SocialMessagingClient({
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
    async sendOtp(phone, code) {
      const mobile = normalizeIndianMobile(phone);
      if (!mobile) {
        logger.warn('otp whatsapp skipped — phone not a 10-digit Indian mobile', {
          phone: last4(phone),
        });
        return false;
      }
      const e164 = `+91${mobile}`;
      try {
        ctx ??= loadClient();
        const { client, lib } = await ctx;
        const out = await client.send(
          new lib.SendWhatsAppMessageCommand({
            originationPhoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID as string,
            metaApiVersion: env.WHATSAPP_META_API_VERSION,
            message: new TextEncoder().encode(otpTemplatePayload(env, e164, code)),
          }),
        );
        // the daily-cost metric line (ADR-0090): one INFO per accepted message, grep/count-able.
        logger.info('otp whatsapp sent', { phone: last4(mobile), messageId: out.messageId });
        return true;
      } catch (err) {
        logger.error('otp whatsapp send failed', {
          phone: last4(mobile),
          err: err instanceof Error ? err.message : String(err),
        });
        return false;
      }
    },
  };
}
