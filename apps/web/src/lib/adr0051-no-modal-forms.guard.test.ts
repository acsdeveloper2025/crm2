import { describe, it, expect } from 'vitest';

/*
 * ADR-0051 guard — add/edit for the CONVERTED entities is inline-grid cell editing (flat) or a
 * full record-page route (complex), NEVER a modal/overlay form. This scans those entities' source
 * and asserts the ONLY *Dialog/*Modal components they render are the sanctioned NON-FORM overlays.
 * If anyone re-introduces an add/edit modal (e.g. <PolicyDialog>) for a converted entity, it fails.
 * Reads source via Vite's ?raw glob (no node:fs — typechecks under the browser tsconfig); test
 * files are skipped (they carry usage examples).
 *
 * Converted (ADR-0051):
 *   D3 flat inline-grid → Departments, Designations, Clients, Products, Locations (+ MasterDataCrud)
 *   D4 record-page route → Policies, Roles (access), CommissionRates, Users,
 *                          VerificationUnits, Templates, RateManagement (+ backend GET /:id)
 * NOT converted (documented scope, tracked in COMPLIANCE_GAPS §H):
 *   CPV (bespoke master-detail accordion).
 */
const CONVERTED_SOURCES = import.meta.glob(
  [
    '../features/policies/**/*.tsx',
    '../features/access/**/*.tsx',
    '../features/commissionRates/**/*.tsx',
    '../features/users/**/*.tsx',
    '../features/verificationUnits/**/*.tsx',
    '../features/departments/**/*.tsx',
    '../features/designations/**/*.tsx',
    '../features/clients/**/*.tsx',
    '../features/products/**/*.tsx',
    '../features/locations/**/*.tsx',
    '../features/templates/**/*.tsx',
    '../features/rateManagement/**/*.tsx',
    '../components/MasterDataCrud.tsx',
  ],
  { query: '?raw', import: 'default', eager: true },
) as Record<string, string>;

// Sanctioned NON-FORM overlays a converted entity may still render (ADR-0051 §4 — kept overlays):
//   ConflictDialog       OCC stale-update recovery (ADR-0019) — not an add/edit form
//   ResetPasswordDialog  a Users list-row action — not an add/edit form
//   HistoryDialog        Rate Management's READ-ONLY effective-dated history view — not an add/edit form
const ALLOWED = new Set(['ConflictDialog', 'ResetPasswordDialog', 'HistoryDialog']);
const DIALOG_USAGE = /<([A-Z][A-Za-z0-9]*(?:Dialog|Modal))\b/g;

describe('ADR-0051: converted entities render no add/edit modal form', () => {
  it('renders only sanctioned non-form *Dialog/*Modal overlays', () => {
    const offenders: string[] = [];
    for (const [path, src] of Object.entries(CONVERTED_SOURCES)) {
      if (/\.test\.tsx?$/.test(path)) continue;
      for (const m of src.matchAll(DIALOG_USAGE)) {
        const name = m[1];
        if (name && !ALLOWED.has(name)) offenders.push(`${path}: <${name}>`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('scans a non-empty set of converted-entity source files', () => {
    // Guards the glob itself — a broken path would silently scan nothing and always pass.
    const nonTest = Object.keys(CONVERTED_SOURCES).filter((p) => !/\.test\.tsx?$/.test(p));
    expect(nonTest.length).toBeGreaterThan(10);
  });
});
