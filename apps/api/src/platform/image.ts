/**
 * Image validation for uploads (slice 7). We identify an image by its MAGIC BYTES, not the declared
 * Content-Type, so a renamed/spoofed file is rejected before it ever reaches object storage. Platform
 * utility (kept out of the business layer so the byte constants live next to what they describe).
 */

/** Max accepted upload size for a profile photo. */
export const MAX_IMAGE_BYTES = 5_242_880; // 5 MiB

interface ImageType {
  type: string;
  ext: string;
  /** the bytes that must match at given offsets — supports gaps (e.g. WebP's "RIFF"…"WEBP"). */
  signature: ReadonlyArray<{ at: number; bytes: readonly number[] }>;
}

const IMAGE_TYPES: readonly ImageType[] = [
  { type: 'image/png', ext: 'png', signature: [{ at: 0, bytes: [0x89, 0x50, 0x4e, 0x47] }] },
  { type: 'image/jpeg', ext: 'jpg', signature: [{ at: 0, bytes: [0xff, 0xd8, 0xff] }] },
  {
    // WebP = a RIFF container whose FourCC is "WEBP" — both must match, else a .wav/.avi (also RIFF) passes.
    type: 'image/webp',
    ext: 'webp',
    signature: [
      { at: 0, bytes: [0x52, 0x49, 0x46, 0x46] }, // "RIFF"
      { at: 8, bytes: [0x57, 0x45, 0x42, 0x50] }, // "WEBP"
    ],
  },
];

/** Identify an image by its byte signature; null when the bytes match no accepted type. */
export function detectImage(bytes: Buffer): { type: string; ext: string } | null {
  const match = IMAGE_TYPES.find((t) =>
    t.signature.every((part) => part.bytes.every((b, i) => bytes[part.at + i] === b)),
  );
  return match ? { type: match.type, ext: match.ext } : null;
}
