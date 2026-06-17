import type { Env } from '@crm2/config';
import { loadEnv } from '@crm2/config';
import { AppError } from '../errors.js';
import { HTTP_STATUS } from '../http.js';

/**
 * Object-storage seam (ADR-0021). Callers depend on this interface, never on the AWS SDK directly.
 * The factory returns a real S3-backed provider only when storage is configured; otherwise a disabled
 * provider that throws STORAGE_NOT_CONFIGURED (503) — deferred-activation: the code ships, the bucket
 * is a deploy step.
 */
export interface StorageProvider {
  /** store bytes at `key`; returns the key. */
  put(key: string, body: Buffer, contentType: string): Promise<{ key: string }>;
  /** fetch the object's bytes (server-side; e.g. the worker reading an uploaded import file). */
  get(key: string): Promise<Buffer>;
  /** a time-limited URL to read the object (presigned). */
  signedUrl(key: string): Promise<string>;
  /** remove the object (no-op-safe — deleting a missing key must not throw). */
  remove(key: string): Promise<void>;
}

const notConfigured = (): AppError =>
  new AppError(
    HTTP_STATUS.SERVICE_UNAVAILABLE,
    'STORAGE_NOT_CONFIGURED',
    'object storage is not configured on this deployment',
  );

/** The deferred-activation provider: every operation is a clean 503, never a 500. */
const disabledStorage: StorageProvider = {
  put: () => Promise.reject(notConfigured()),
  get: () => Promise.reject(notConfigured()),
  signedUrl: () => Promise.reject(notConfigured()),
  remove: () => Promise.resolve(),
};

/** True when the env actually provisions an S3/MinIO bucket (backend selected + bucket + credentials). */
export function storageConfigured(env: Env = loadEnv()): boolean {
  return (
    (env.STORAGE_BACKEND === 's3' || env.STORAGE_BACKEND === 'minio') &&
    !!env.S3_BUCKET &&
    !!env.S3_ACCESS_KEY_ID &&
    !!env.S3_SECRET_ACCESS_KEY
  );
}

let override: StorageProvider | null = null;
let cached: StorageProvider | null = null;

/** For tests: inject a fake provider (mirrors setPool). Pass null to restore the real factory. */
export function setStorage(p: StorageProvider | null): void {
  override = p;
  cached = null;
}

/** The active provider for this deployment: real S3 when configured, else the disabled 503 provider. */
export function getStorage(env: Env = loadEnv()): StorageProvider {
  if (override) return override;
  if (cached) return cached;
  cached = storageConfigured(env) ? createS3Storage(env) : disabledStorage;
  return cached;
}

/**
 * The real provider. Both AWS SDK packages are imported lazily (dynamic import) so an unconfigured
 * deployment never loads the large client tree; the typed module shapes flow through, so no `any`.
 * The client is built once, on first use.
 */
function createS3Storage(env: Env): StorageProvider {
  // S3_BUCKET/credentials are present — narrowed by storageConfigured() before we reach here.
  const bucket = env.S3_BUCKET as string;

  async function loadSdk() {
    const lib = await import('@aws-sdk/client-s3');
    const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
    const client = new lib.S3Client({
      region: env.S3_REGION,
      credentials: {
        accessKeyId: env.S3_ACCESS_KEY_ID as string,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY as string,
      },
      ...(env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT, forcePathStyle: true } : {}),
    });
    return { client, lib, getSignedUrl };
  }
  let ctx: ReturnType<typeof loadSdk> | null = null;
  const sdk = (): ReturnType<typeof loadSdk> => (ctx ??= loadSdk());

  return {
    async put(key, body, contentType) {
      const { client, lib } = await sdk();
      await client.send(
        new lib.PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }),
      );
      return { key };
    },
    async get(key) {
      const { client, lib } = await sdk();
      const out = await client.send(new lib.GetObjectCommand({ Bucket: bucket, Key: key }));
      if (!out.Body) throw notConfigured();
      return Buffer.from(await out.Body.transformToByteArray());
    },
    async signedUrl(key) {
      const { client, lib, getSignedUrl } = await sdk();
      return getSignedUrl(client, new lib.GetObjectCommand({ Bucket: bucket, Key: key }), {
        expiresIn: env.S3_SIGNED_URL_TTL_S,
      });
    },
    async remove(key) {
      const { client, lib } = await sdk();
      await client.send(new lib.DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
  };
}
