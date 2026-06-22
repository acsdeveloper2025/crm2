import { describe, it, expect } from 'vitest';

/*
 * Design-token cleanliness guard (ADR-0008 / COLOR_SYSTEM_FREEZE). Components must consume
 * SEMANTIC tokens only — never a raw Tailwind palette color, and never a status token outside
 * the frozen 8. Catches the two H-7 slips (text-st-completed = dead/undefined; text-amber-600 =
 * raw palette) and prevents regressions. Reads source via Vite's ?raw glob (no node:fs, so it
 * typechecks under the browser tsconfig). Test files are excluded (they carry token examples).
 */
const FROZEN_ST = new Set([
  'pending',
  'assigned',
  'in-progress',
  'submitted',
  'under-review',
  'approved',
  'rejected',
  'revisit',
]);

const PALETTE =
  '(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)';
const PALETTE_RE = new RegExp(
  `\\b(?:text|bg|border|ring|from|to|via|fill|stroke|divide|placeholder|caret|outline|decoration)-${PALETTE}-\\d{2,3}\\b`,
  'g',
);
const ST_RE = /\b(?:text|bg|border)-st-([a-z][a-z-]*)\b/g;
const stName = (raw: string): string => (raw.endsWith('-bg') ? raw.slice(0, -3) : raw);

const SOURCES = import.meta.glob('../**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;
const FILES = Object.entries(SOURCES).filter(([path]) => !/\.test\.(ts|tsx)$/.test(path));

describe('design-token guard', () => {
  it('uses no raw Tailwind palette colors (only semantic tokens)', () => {
    const offenders: string[] = [];
    for (const [path, src] of FILES) {
      const hits = src.match(PALETTE_RE);
      if (hits) offenders.push(`${path}: ${[...new Set(hits)].join(', ')}`);
    }
    expect(offenders).toEqual([]);
  });

  it('uses only the 8 frozen st-* status tokens (no dead/undefined names)', () => {
    const offenders: string[] = [];
    for (const [path, src] of FILES) {
      for (const m of src.matchAll(ST_RE)) {
        const raw = m[1];
        if (!raw) continue;
        const name = stName(raw);
        if (!FROZEN_ST.has(name)) offenders.push(`${path}: ${m[0]} (unknown status "${name}")`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
