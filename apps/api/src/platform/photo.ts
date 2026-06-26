import type Sharp from 'sharp';

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

/** The GPS-Map-Camera overlay inputs for ONE field photo (ADR-0075). Mirrors the web `PhotoOverlay`. */
export interface FieldPhotoOverlay {
  mapPng: Buffer | null; // Google Static-Maps thumbnail for the coords; null ⇒ text-only band
  address: string | null; // frozen reverse-geocoded address (ADR-0040)
  latitude?: number | undefined;
  longitude?: number | undefined;
  accuracy?: number | undefined;
  captureTime?: string | undefined; // ISO; rendered in IST (the field zone)
  photoType?: string | null;
  unitName?: string | null;
}

const xmlEscape = (s: string): string =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c] ?? c,
  );

/** Greedy word-wrap to ~`maxChars` per line, capped at `maxLines` (last line ellipsised if it overflows). */
function wrapText(text: string, maxChars: number, maxLines: number): string[] {
  const all: string[] = [];
  let cur = '';
  for (const w of text.split(/\s+/).filter(Boolean)) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length > maxChars && cur) {
      all.push(cur);
      cur = w;
    } else cur = next;
  }
  if (cur) all.push(cur);
  if (all.length <= maxLines) return all;
  const kept = all.slice(0, maxLines);
  kept[maxLines - 1] = `${kept[maxLines - 1]!.slice(0, Math.max(1, maxChars - 1))}…`;
  return kept;
}

/** Capture instant → "Mon, 22/06/2026, 11:21 AM IST" in Asia/Kolkata (the field agents' zone). */
function formatCaptureIST(iso: string): string {
  try {
    return `${new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      weekday: 'short',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    }).format(new Date(iso))} IST`;
  } catch {
    return iso;
  }
}

/**
 * Bake the GPS-Map-Camera overlay onto a field-photo download (ADR-0075, extends ADR-0060). Composites the
 * same band the web shows — static-map inset (left) + photoType·unit + bold address + lat/long + capture
 * time — onto the BOTTOM of the JPEG, so the saved/shared file is self-contained. The stored evidence
 * artifact is untouched; only this download copy is composited.
 *
 * Fail-open at every step (a download must NEVER break): no coords/address/map ⇒ nothing to show ⇒ return
 * the bytes unchanged; a non-image / sharp failure ⇒ caught ⇒ return the bytes unchanged.
 */
export async function composeFieldPhotoOverlay(bytes: Buffer, o: FieldPhotoOverlay): Promise<Buffer> {
  const hasCoords = typeof o.latitude === 'number' && typeof o.longitude === 'number';
  if (!hasCoords && !o.address && !o.mapPng) return bytes; // nothing to overlay
  try {
    const { default: sharp } = await import('sharp');
    const base = sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS });
    const meta = await base.metadata();
    const W = meta.width ?? 0;
    const H = meta.height ?? 0;
    if (!W || !H) return bytes;

    const pad = Math.round(W * 0.018);
    const fs = Math.min(40, Math.max(13, Math.round(W * 0.025)));
    const fsAddr = Math.round(fs * 1.12);
    const lh = Math.round(fs * 1.36);
    const mapSz = o.mapPng ? Math.min(360, Math.max(96, Math.round(W * 0.17))) : 0;
    const textLeft = pad + (mapSz ? mapSz + pad : 0);
    const avail = W - textLeft - pad;
    const cpl = Math.max(8, Math.floor(avail / (fsAddr * 0.54))); // ~chars/line at the address size

    const lines: { t: string; size: number; bold?: boolean; dim?: boolean }[] = [];
    const header = [o.photoType, o.unitName].filter(Boolean).join(' · ');
    if (header) lines.push({ t: header, size: fs, dim: true });
    if (o.address)
      for (const ln of wrapText(o.address, cpl, 2)) lines.push({ t: ln, size: fsAddr, bold: true });
    if (hasCoords) {
      const acc = typeof o.accuracy === 'number' ? ` (±${Math.round(o.accuracy)}m)` : '';
      lines.push({ t: `Lat ${o.latitude!.toFixed(6)}, Long ${o.longitude!.toFixed(6)}${acc}`, size: fs });
    }
    if (o.captureTime) lines.push({ t: formatCaptureIST(o.captureTime), size: fs, dim: true });
    if (lines.length === 0) return bytes;

    const textH = lines.length * lh;
    const band = Math.min(Math.round(H * 0.5), Math.max(textH, mapSz) + 2 * pad);
    const top = H - band;
    let y = top + Math.round((band - textH) / 2) + Math.round(fsAddr * 0.8); // first baseline
    const texts = lines
      .map((l) => {
        const span = `<text x="${textLeft}" y="${y}" font-family="'Liberation Sans','Noto Sans',sans-serif" font-size="${l.size}" font-weight="${l.bold ? 700 : 400}" fill="${l.dim ? '#e5e7eb' : '#ffffff'}">${xmlEscape(l.t)}</text>`;
        y += lh;
        return span;
      })
      .join('');
    // full-image SVG: a semi-transparent band at the bottom + the white text (fonts ship in the image)
    const svg = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect x="0" y="${top}" width="${W}" height="${band}" fill="#000000" fill-opacity="0.55"/>${texts}</svg>`,
    );
    const layers: Sharp.OverlayOptions[] = [{ input: svg, top: 0, left: 0 }];
    if (o.mapPng && mapSz) {
      const map = await sharp(o.mapPng).resize(mapSz, mapSz, { fit: 'cover' }).png().toBuffer();
      layers.push({ input: map, top: top + Math.round((band - mapSz) / 2), left: pad });
    }
    return await base.composite(layers).jpeg({ quality: 86 }).toBuffer();
  } catch {
    return bytes; // fail-open — a download must never break
  }
}
