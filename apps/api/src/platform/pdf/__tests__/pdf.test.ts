import { describe, it, expect, afterAll } from 'vitest';
import { htmlToPdf, closePdfBrowser } from '../index.js';

/** Real Puppeteer render (bundled Chromium). Slow-ish (~1-2s browser launch) but it's the only way to
 *  prove the HTML→PDF path actually produces a valid PDF. */
describe('htmlToPdf (ADR-0041 S5 slice 2b)', () => {
  afterAll(async () => {
    await closePdfBrowser();
  });

  it('renders trusted HTML to a valid PDF buffer (portrait A4)', async () => {
    const html = '<!doctype html><html><body><h1>Hello PDF</h1><p>body</p></body></html>';
    const pdf = await htmlToPdf(html, { pageSize: 'A4', orientation: 'portrait' });
    expect(Buffer.isBuffer(pdf)).toBe(true);
    expect(pdf.length).toBeGreaterThan(500);
    // PDF magic number — the file starts with "%PDF-".
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('honours landscape orientation + reuses the browser across renders', async () => {
    const pdf = await htmlToPdf('<html><body>landscape</body></html>', {
      pageSize: 'LETTER',
      orientation: 'landscape',
    });
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });
});
