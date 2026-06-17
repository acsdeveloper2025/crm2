/**
 * Upload validation for case attachments (ADR-0025 B2). We identify a file by its MAGIC BYTES, not
 * the declared Content-Type, so a renamed/spoofed file is rejected before it reaches object storage.
 * The accepted set is the office-reference-doc set: PDF + the three web image types (a KYC document is
 * a PAN/Aadhaar scan or PDF; a field reference is a PDF/image). Platform utility — byte constants live
 * next to what they describe, out of the business layer.
 */

/** Max accepted attachment size. */
export const MAX_ATTACHMENT_BYTES = 26_214_400; // 25 MiB

interface FileType {
  type: string;
  ext: string;
  /** bytes that must match at given offsets — supports gaps (e.g. WebP's "RIFF"…"WEBP"). */
  signature: ReadonlyArray<{ at: number; bytes: readonly number[] }>;
}

const ATTACHMENT_TYPES: readonly FileType[] = [
  { type: 'application/pdf', ext: 'pdf', signature: [{ at: 0, bytes: [0x25, 0x50, 0x44, 0x46] }] }, // "%PDF"
  { type: 'image/png', ext: 'png', signature: [{ at: 0, bytes: [0x89, 0x50, 0x4e, 0x47] }] },
  { type: 'image/jpeg', ext: 'jpg', signature: [{ at: 0, bytes: [0xff, 0xd8, 0xff] }] },
  {
    type: 'image/webp',
    ext: 'webp',
    signature: [
      { at: 0, bytes: [0x52, 0x49, 0x46, 0x46] }, // "RIFF"
      { at: 8, bytes: [0x57, 0x45, 0x42, 0x50] }, // "WEBP"
    ],
  },
];

/** Identify an attachment by its byte signature; null when the bytes match no accepted type. */
export function detectAttachment(bytes: Buffer): { type: string; ext: string } | null {
  const match = ATTACHMENT_TYPES.find((t) =>
    t.signature.every((part) => part.bytes.every((b, i) => bytes[part.at + i] === b)),
  );
  return match ? { type: match.type, ext: match.ext } : null;
}
