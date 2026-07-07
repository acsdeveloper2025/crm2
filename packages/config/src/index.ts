import { z } from 'zod';

/**
 * @crm2/config — single fail-fast env schema shared by every v2 app
 * (api / worker / report-worker). Parse once at boot; crash early on drift.
 */
const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    ROLE: z.enum(['api', 'worker', 'report']).default('api'),
    PORT: z.coerce.number().int().positive().default(4000),
    DATABASE_URL: z.string().url().or(z.string().startsWith('postgres')),
    REDIS_QUEUE_URL: z.string().optional(),
    REDIS_CACHE_URL: z.string().optional(),
    JWT_SECRET: z.string().min(16).default('dev-only-insecure-secret-change-me'),
    /** key that encrypts TOTP secrets at rest (AES-256-GCM); set a real value in prod. */
    MFA_ENC_KEY: z.string().min(16).default('dev-only-insecure-mfa-key-change-me'),
    AUTH_ACCESS_TTL_S: z.coerce.number().int().positive().default(900), // 15 min
    AUTH_REFRESH_TTL_S: z.coerce.number().int().positive().default(2592000), // 30 days
    /**
     * scrypt CPU/memory work factor for password hashing (a power of 2). Prod default 16384 (~2s/hash).
     * The integration suite overrides this to a tiny value: with ~30 auth tests each doing several
     * logins/password-sets, production scrypt saturates the libuv threadpool and, under CI CPU
     * contention, delays in-process responses enough to reset supertest sockets ("socket hang up") —
     * a long-standing :5433 flake. The stored hash self-describes its N, so verification is unaffected
     * and existing prod hashes still verify after this knob changes.
     */
    PASSWORD_SCRYPT_N: z.coerce.number().int().positive().default(16384),
    STORAGE_BACKEND: z.enum(['minio', 's3', 'local']).default('local'),
    // Object storage (ADR-0021) — profile photos. Active only when STORAGE_BACKEND is s3/minio AND
    // S3_BUCKET + credentials are present; otherwise storage is a disabled provider (503 on use).
    S3_BUCKET: z.string().optional(),
    S3_REGION: z.string().default('ap-south-1'),
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),
    /** custom endpoint for MinIO / S3-compatible stores (path-style); unset = real AWS S3. */
    S3_ENDPOINT: z.string().optional(),
    /** presigned-URL lifetime (seconds) for reading a stored object (e.g. a profile photo). */
    S3_SIGNED_URL_TTL_S: z.coerce.number().int().positive().default(900),
    // Transactional email (ADR-0021) — one-time-password / reset mail. Inert unless SMTP_HOST is
    // set (smtp transport) or MAIL_TRANSPORT=ses (ADR-0089: SES API over HTTPS/443, for hosts
    // whose datacenter blocks outbound SMTP ports entirely, as the staging box's does).
    MAIL_TRANSPORT: z.enum(['smtp', 'ses']).default('smtp'),
    /** SES API region (ADR-0089); keys optional — absent = SDK default chain (EC2 instance role). */
    SES_REGION: z.string().default('ap-south-1'),
    SES_ACCESS_KEY_ID: z.string().optional(),
    SES_SECRET_ACCESS_KEY: z.string().optional(),
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().int().positive().default(587),
    SMTP_USER: z.string().optional(),
    SMTP_PASSWORD: z.string().optional(),
    /** true for implicit TLS (port 465); false for STARTTLS (587). */
    SMTP_SECURE: z
      .string()
      .optional()
      .transform((v) => v === 'true'),
    MAIL_FROM: z.string().default('CRM2 <no-reply@crm2.local>'),
    // OTP SMS via Fast2SMS (ADR-0088). Inert unless BOTH are set: with either missing the SMS sender
    // is a disabled provider that logs-and-skips (the email leg / gate inertness handle delivery).
    // The OTP template id comes from the Fast2SMS panel (DLT approval lives there, not in code).
    FAST2SMS_API_KEY: z.string().optional(),
    FAST2SMS_OTP_TEMPLATE_ID: z.string().optional(),
    // OTP WhatsApp via AWS End User Messaging Social (ADR-0090). Inert unless BOTH the origination
    // phone-number id AND the approved Meta template name are set; then it's a 3rd parallel OTP leg.
    // Credentials resolve via the SDK default chain (prod EC2 instance role) or SES_*/AWS static keys
    // on staging. Region is shared with SES (SES_REGION — same AWS messaging region, ap-south-1).
    WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
    WHATSAPP_TEMPLATE_NAME: z.string().optional(),
    WHATSAPP_TEMPLATE_LANG: z.string().default('en_US'),
    WHATSAPP_META_API_VERSION: z.string().default('v20.0'),
    // Reverse geocoding (ADR-0026) — server-side Google Geocoding key for coord→address on the Field
    // Monitoring console. Inert unless set: with no key the geocoder degrades to null (the UI shows
    // raw coords + a Maps link, never an error). Restrict the key to the Geocoding API + the server IP.
    GOOGLE_GEOCODING_API_KEY: z.string().optional(),
    // FCM push (ADR-0027 phase 2). Path (relative to the api cwd) to the Firebase service-account JSON —
    // MUST be the `caseflow-mobile` project (the device's). Inert unless set: with no path the pusher is a
    // disabled no-op (the in-app + socket legs still deliver). The file lives under secrets/ (gitignored).
    FIREBASE_SERVICE_ACCOUNT_PATH: z.string().optional(),
    // Malware scanning for attachment/photo/avatar uploads (FILE_UPLOAD-01, docs/audit/08-file-upload.md)
    // — a clamd daemon's INSTREAM protocol, plain node:net, no new dependency. Inert unless
    // AV_SCAN_HOST is set: with no host, scanBuffer() is a no-op (uploads still go through magic-byte
    // validation, just not malware-scanned) — same pattern as every other optional external service here.
    AV_SCAN_HOST: z.string().optional(),
    AV_SCAN_PORT: z.coerce.number().int().positive().default(3310), // clamd's default INSTREAM port
    /** Export rows below this generate synchronously; at/above it require a background job (≥10k → report-worker). */
    EXPORT_JOB_THRESHOLD: z.coerce.number().int().positive().default(10000),
    /**
     * Hard ceiling on a single background EXPORT job's rows (ADR-0030). Above it the export is `capped`
     * and surfaces that in the job result (never a silent truncation). Default 200k comfortably covers
     * the largest real dataset (the ~157k pincode catalog); raise it only with streaming builders + a
     * DB cursor (the report-worker follow-up) so worker memory stays bounded.
     */
    EXPORT_JOB_MAX_ROWS: z.coerce.number().int().positive().default(200000),
    /** Import files below this many rows process synchronously; at/above it run as a background IMPORT job. */
    IMPORT_JOB_THRESHOLD: z.coerce.number().int().positive().default(10000),
    /** Hard ceiling on a single import file's rows (ADR-0030); above it the file is rejected (split it). */
    IMPORT_JOB_MAX_ROWS: z.coerce.number().int().positive().default(200000),
    // ── Rate limiting (ADR-0076). Windows in ms, limits in requests/window. Tunable without a code
    // deploy. In-memory store (single-instance prod); the existing DB per-account lockout is the
    // credential-stuffing control — these are flood caps sized for shared-NAT offices.
    RATE_LIMIT_LOGIN_WINDOW_MS: z.coerce.number().int().positive().default(900000), // 15 min
    RATE_LIMIT_LOGIN_MAX: z.coerce.number().int().positive().default(30),
    RATE_LIMIT_REFRESH_MAX: z.coerce.number().int().positive().default(60),
    // ── pg pool guards (ADR-0076). Bound a stuck/locking query, a slow connection acquire, and a
    // leaked idle transaction; cap pooled connections.
    DB_STATEMENT_TIMEOUT_MS: z.coerce.number().int().positive().default(60000),
    DB_CONNECTION_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
    DB_IDLE_IN_TX_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
    DB_POOL_MAX: z.coerce.number().int().positive().default(10),
  })
  .superRefine((env, ctx) => {
    // Fail-fast (ADR-0076): a real production boot must never run on the insecure dev defaults for the
    // two crypto secrets. dev/test/CI legitimately fall back to these; prod sets real values
    // (secrets/.env.prod). Surfaces via loadEnv()'s existing throw, for every ROLE.
    if (env.NODE_ENV !== 'production') return;
    checkSecretStrength(env.JWT_SECRET, 'JWT_SECRET', 'dev-only-insecure-secret-change-me', ctx);
    checkSecretStrength(env.MFA_ENC_KEY, 'MFA_ENC_KEY', 'dev-only-insecure-mfa-key-change-me', ctx);
  });

/**
 * AUTHENTICATION-03 (docs/audit/01-authentication.md): the old check only rejected the exact dev-default
 * string, so e.g. 16 repeated characters passed `min(16)` fine. Adds an entropy floor: a real length
 * (`.env.prod.example` generates these with `openssl rand -base64 32/48`, i.e. 44-64 chars) and a
 * distinct-character-count floor that catches "aaaa…a" / "0101…01"-style low-entropy strings a min-length
 * check alone can't. Not a substitute for real randomness — a cheap, no-dependency floor above it.
 */
const MIN_SECRET_LENGTH = 32;
const MIN_DISTINCT_CHARS = 10;
function checkSecretStrength(value: string, path: string, devDefault: string, ctx: z.RefinementCtx): void {
  if (value === devDefault) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [path],
      message: `must be set to a real secret in production (insecure dev default detected)`,
    });
    return;
  }
  if (value.length < MIN_SECRET_LENGTH) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [path],
      message: `must be at least ${MIN_SECRET_LENGTH} chars in production (got ${value.length}) — generate with e.g. \`openssl rand -base64 32\``,
    });
  }
  const distinctChars = new Set(value).size;
  if (distinctChars < MIN_DISTINCT_CHARS) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [path],
      message: `looks low-entropy (only ${distinctChars} distinct characters) — generate with e.g. \`openssl rand -base64 32\``,
    });
  }
}

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | null = null;

/** Parse + cache process env. Throws (fail-fast) on invalid config. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`[@crm2/config] invalid environment:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

/** test helper — reset the cache between suites */
export function __resetEnv(): void {
  cached = null;
}
