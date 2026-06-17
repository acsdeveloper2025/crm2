/**
 * Field-photo processing (ADR-0034). `sharp` is LAZY-imported — only loaded when a device field photo
 * is uploaded, never at boot. Two outputs per photo:
 *   • stripped   — the photo re-encoded in its source format with ALL metadata removed (defensive
 *                  EXIF/GPS strip; sharp drops metadata on encode) and auto-oriented from the EXIF
 *                  Orientation tag. This is the stored evidence artifact.
 *   • thumbnail  — a 200×200 JPEG (fit inside, no enlargement). Best-effort: a thumbnail failure must
 *                  NOT fail the upload (v1 parity) — the stripped original still stores.
 */
export interface ProcessedFieldPhoto {
  stripped: Buffer;
  thumbnail: Buffer | null;
}

const THUMB_PX = 200;
const THUMB_QUALITY = 80;

/** Field-photo upload bounds (ADR-0034). A phone photo is a few MiB → a tighter cap than the 25 MiB
 *  office-document cap, and a bounded batch + decode size, to keep the field-facing endpoint off a
 *  memory/CPU DoS surface (20×25 MiB buffered + a decompression-bomb decode). */
export const MAX_FIELD_PHOTO_BYTES = 15_728_640; // 15 MiB per photo
export const MAX_FIELD_PHOTOS = 10; // per upload
const MAX_INPUT_PIXELS = 50_000_000; // sharp decode bound (≈50 MP) — a larger image throws → failed[]

export async function processFieldPhoto(bytes: Buffer): Promise<ProcessedFieldPhoto> {
  const { default: sharp } = await import('sharp');
  // `.rotate()` with no arg auto-orients from EXIF then drops the orientation tag; re-encoding without
  // `.withMetadata()` strips all other metadata (incl. embedded GPS). Output keeps the source format.
  // `limitInputPixels` bounds the decode (decompression-bomb defense).
  const pipeline = sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS }).rotate();
  const stripped = await pipeline.clone().toBuffer();
  // assigned in both the try and the catch below — no dead initializer (eslint no-useless-assignment).
  let thumbnail: Buffer | null;
  try {
    thumbnail = await pipeline
      .clone()
      .resize(THUMB_PX, THUMB_PX, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: THUMB_QUALITY })
      .toBuffer();
  } catch {
    thumbnail = null; // best-effort — a thumbnail failure never fails the upload
  }
  return { stripped, thumbnail };
}
