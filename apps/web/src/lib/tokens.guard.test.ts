import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/*
 * Design-token cleanliness guard (ADR-0008 / COLOR_SYSTEM_FREEZE). Components must consume
 * SEMANTIC tokens only — never a raw Tailwind palette color, and never a status token outside
 * the frozen 8. Catches the two H-7 slips (text-st-completed = dead/undefined; text-amber-600 =
 * raw palette) and prevents regressions. Scans real source (excludes tests, which carry examples).
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
// Greedy name (may include hyphens, e.g. in-progress); the optional `-bg` background suffix
// is stripped in code so `bg-st-approved-bg` resolves to the status name `approved`.
const ST_RE = /\b(?:text|bg|border)-st-([a-z][a-z-]*)\b/g;
const stName = (raw: string): string => (raw.endsWith('-bg') ? raw.slice(0, -3) : raw);

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

const FILES = walk('src');

describe('design-token guard', () => {
  it('uses no raw Tailwind palette colors (only semantic tokens)', () => {
    const offenders: string[] = [];
    for (const f of FILES) {
      const hits = readFileSync(f, 'utf8').match(PALETTE_RE);
      if (hits) offenders.push(`${f}: ${[...new Set(hits)].join(', ')}`);
    }
    expect(offenders).toEqual([]);
  });

  it('uses only the 8 frozen st-* status tokens (no dead/undefined names)', () => {
    const offenders: string[] = [];
    for (const f of FILES) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(ST_RE)) {
        const name = stName(m[1]);
        if (!FROZEN_ST.has(name)) offenders.push(`${f}: ${m[0]} (unknown status "${name}")`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
