import { z } from 'zod';

/**
 * @crm2/config — single fail-fast env schema shared by every v2 app
 * (api / worker / report-worker). Parse once at boot; crash early on drift.
 */
const EnvSchema = z.object({
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
  // Transactional email (ADR-0021) — one-time-password / reset mail. Inert unless SMTP_HOST is set.
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
  // Reverse geocoding (ADR-0026) — server-side Google Geocoding key for coord→address on the Field
  // Monitoring console. Inert unless set: with no key the geocoder degrades to null (the UI shows
  // raw coords + a Maps link, never an error). Restrict the key to the Geocoding API + the server IP.
  GOOGLE_GEOCODING_API_KEY: z.string().optional(),
  // FCM push (ADR-0027 phase 2). Path (relative to the api cwd) to the Firebase service-account JSON —
  // MUST be the `caseflow-mobile` project (the device's). Inert unless set: with no path the pusher is a
  // disabled no-op (the in-app + socket legs still deliver). The file lives under secrets/ (gitignored).
  FIREBASE_SERVICE_ACCOUNT_PATH: z.string().optional(),
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
});

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
