import type { Browser } from 'puppeteer';
import { logger } from '@crm2/logger';
import type { PageSize, PageOrientation } from '@crm2/sdk';

/**
 * HTML → PDF rendering (ADR-0041 S5 slice 2b). A thin, self-contained Puppeteer wrapper used by the
 * CASE_REPORT job processor on the worker tier. Platform-level (no feature imports); the only consumer
 * is the injected job processor.
 *
 * Design:
 *  - ONE lazily-launched headless browser per process, reused across renders (launch is ~1s; a
 *    per-render launch would dominate latency). Promise-cached so concurrent first-calls share it.
 *  - A small concurrency gate (PDF_MAX_CONCURRENCY pages) so a burst of report jobs can't open
 *    unbounded Chromium pages and OOM the worker — excess renders queue.
 *  - Hard timeouts on setContent + page.pdf (a hung render must fail the job, not wedge the worker).
 *  - Each render uses a fresh page, always closed in `finally` (no page leak on error).
 *
 * The HTML is already output-encoded by the CASE_REPORT render engine (auto-escape ON) — this layer
 * adds NO interpolation; it only prints the given markup.
 */

const SET_CONTENT_TIMEOUT_MS = 30_000;
const PDF_TIMEOUT_MS = 60_000;
const PDF_MAX_CONCURRENCY = 6;

let browserPromise: Promise<Browser> | undefined;

async function getBrowser(): Promise<Browser> {
  browserPromise ??= (async (): Promise<Browser> => {
    const { default: puppeteer } = await import('puppeteer');
    const browser = await puppeteer.launch({
      headless: true,
      // Container-safe flags — Chromium's sandbox needs privileges most prod containers don't grant;
      // the input is our own trusted server-rendered HTML, not arbitrary web content.
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
    logger.info('pdf: puppeteer browser launched');
    // If Chromium dies (crash/OOM), drop the cached promise so the next render relaunches.
    browser.on('disconnected', () => {
      browserPromise = undefined;
      logger.warn('pdf: puppeteer browser disconnected — will relaunch on next render');
    });
    return browser;
  })().catch((e: unknown) => {
    browserPromise = undefined; // failed launch must not be cached
    throw e;
  });
  return browserPromise;
}

// A minimal FIFO concurrency gate (no dep): at most PDF_MAX_CONCURRENCY renders hold a slot at once.
let active = 0;
const waiters: Array<() => void> = [];
async function acquire(): Promise<void> {
  if (active < PDF_MAX_CONCURRENCY) {
    active++;
    return;
  }
  await new Promise<void>((resolve) => waiters.push(resolve));
  active++;
}
function release(): void {
  active--;
  waiters.shift()?.();
}

/** Puppeteer's `format` accepts lowercase paper names; our PageSize is uppercase (A4/LETTER/LEGAL). */
const PAPER: Record<PageSize, 'a4' | 'letter' | 'legal'> = {
  A4: 'a4',
  LETTER: 'letter',
  LEGAL: 'legal',
};

export interface PdfOptions {
  pageSize: PageSize;
  orientation: PageOrientation;
}

/**
 * Render trusted HTML to a PDF buffer. Throws on launch failure / timeout / Chromium crash so the
 * caller (the job runner) marks the job FAILED. The page is always closed.
 */
export async function htmlToPdf(html: string, opts: PdfOptions): Promise<Buffer> {
  await acquire();
  try {
    const browser = await getBrowser();
    const page = await browser.newPage();
    try {
      await page.setContent(html, { waitUntil: 'load', timeout: SET_CONTENT_TIMEOUT_MS });
      const pdf = await page.pdf({
        format: PAPER[opts.pageSize],
        landscape: opts.orientation === 'landscape',
        printBackground: true,
        timeout: PDF_TIMEOUT_MS,
        margin: { top: '12mm', bottom: '14mm', left: '10mm', right: '10mm' },
      });
      return Buffer.from(pdf);
    } finally {
      await page.close().catch(() => undefined);
    }
  } finally {
    release();
  }
}

/** Close the browser (graceful worker shutdown). No-op when none was launched. */
export async function closePdfBrowser(): Promise<void> {
  const p = browserPromise;
  browserPromise = undefined;
  if (!p) return;
  await p.then((b) => b.close()).catch(() => undefined);
}
