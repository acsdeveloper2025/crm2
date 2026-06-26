import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { composeFieldPhotoOverlay } from '../photo.js';

const jpeg = (w: number, h: number) =>
  sharp({ create: { width: w, height: h, channels: 3, background: { r: 120, g: 140, b: 160 } } })
    .jpeg()
    .toBuffer();
const png = (w: number, h: number) =>
  sharp({ create: { width: w, height: h, channels: 3, background: { r: 40, g: 160, b: 80 } } })
    .png()
    .toBuffer();

const META = {
  address: 'D1, Yashaswi Nagar, Dhokali, Thane West, Mumbai, Maharashtra 400607, India',
  latitude: 19.2226429,
  longitude: 72.9830479,
  accuracy: 12,
  captureTime: '2026-06-22T05:51:16.600Z',
  photoType: 'verification',
  unitName: 'Residence Verification',
};

describe('composeFieldPhotoOverlay (ADR-0075)', () => {
  it('bakes the overlay onto a real JPEG — valid JPEG, same dimensions, bytes changed', async () => {
    const src = await jpeg(1080, 1920);
    const map = await png(480, 320);
    const out = await composeFieldPhotoOverlay(src, { ...META, mapPng: map });
    const m = await sharp(out).metadata();
    expect(m.format).toBe('jpeg');
    expect(m.width).toBe(1080);
    expect(m.height).toBe(1920); // overlaid on the bottom — dimensions preserved
    expect(out.equals(src)).toBe(false); // overlay actually applied
  });

  it('text-only band when the static map is unavailable (still bakes address + coords)', async () => {
    const src = await jpeg(800, 1000);
    const out = await composeFieldPhotoOverlay(src, { ...META, mapPng: null });
    expect((await sharp(out).metadata()).format).toBe('jpeg');
    expect(out.equals(src)).toBe(false);
  });

  it('returns the original bytes unchanged when there is nothing to overlay (no geo, no address, no map)', async () => {
    const src = await jpeg(640, 480);
    const out = await composeFieldPhotoOverlay(src, { mapPng: null, address: null });
    expect(out).toBe(src); // same reference — untouched
  });

  it('fail-open: a non-image buffer returns unchanged (a download must never break)', async () => {
    const bad = Buffer.from('PNGDATA-not-an-image');
    const out = await composeFieldPhotoOverlay(bad, { ...META, mapPng: null });
    expect(out).toBe(bad);
  });
});
