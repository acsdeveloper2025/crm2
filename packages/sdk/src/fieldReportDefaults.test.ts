import { describe, it, expect } from 'vitest';
import { FIELD_REPORT_DEFAULTS, FIELD_REPORT_HELPER_SET } from './fieldReportDefaults.js';

const COLUMN_DATA_TYPES = ['TEXT', 'NUMBER', 'DATE', 'SELECT', 'BOOLEAN'];
// The output-encoding gate (ADR-0041): a template body must never opt out of HTML-escaping via a raw
// output form ({{{ }}} / {{& }}, with or without a ~ whitespace-control prefix).
const RAW_OUTPUT_RE = /\{\{~?[{&]/;

describe('FIELD_REPORT_DEFAULTS (standard templates)', () => {
  for (const [vtype, def] of Object.entries(FIELD_REPORT_DEFAULTS)) {
    describe(vtype, () => {
      it('is a well-formed FIELD_REPORT default (body + columns)', () => {
        // Since ADR-0083 removed the report-layout authoring schema, assert the invariants directly:
        // a non-empty body with no raw un-escaped output, and ≥1 column with a valid key/type.
        expect(def.templateBody.trim().length).toBeGreaterThan(0);
        expect(RAW_OUTPUT_RE.test(def.templateBody)).toBe(false);
        expect(def.columns.length).toBeGreaterThan(0);
        for (const c of def.columns) {
          expect(c.columnKey).toMatch(/^[a-z0-9_]+$/);
          expect(c.headerLabel.trim().length).toBeGreaterThan(0);
          expect(COLUMN_DATA_TYPES).toContain(c.dataType);
        }
      });

      it('no column key collides with a grammar-helper name (would be shadowed)', () => {
        const clash = def.columns.map((c) => c.columnKey).filter((k) => FIELD_REPORT_HELPER_SET.has(k));
        expect(clash).toEqual([]);
      });

      it('every {{var}} referenced in the body is a declared column or a known helper', () => {
        const keys = new Set(def.columns.map((c) => c.columnKey));
        // first identifier inside each mustache (the variable or helper name)
        const refs = [...def.templateBody.matchAll(/\{\{[#/]?\s*([a-zA-Z_][a-zA-Z0-9_]*)/g)].map(
          (m) => m[1]!,
        );
        // `eq` is registered; if/else/unless/each/with are Handlebars built-in block helpers.
        const BUILTINS = new Set(['eq', 'if', 'else', 'unless', 'each', 'with']);
        const unknown = refs.filter(
          (id) => !BUILTINS.has(id) && !keys.has(id) && !FIELD_REPORT_HELPER_SET.has(id),
        );
        expect([...new Set(unknown)]).toEqual([]);
      });
    });
  }
});

// Guard the v2-native device-key corrections (audit A2026-0623-03/08) against regression. These keys are
// what NEW FIELD_REPORT layouts snapshot into their columns; mig 0088 remaps any pre-fix stored layout.
describe('FIELD_REPORT_DEFAULTS device-key drift guard', () => {
  const cols = Object.entries(FIELD_REPORT_DEFAULTS).flatMap(([vtype, def]) =>
    def.columns.map((c) => ({ vtype, sourceRef: c.sourceRef })),
  );

  it('no column reads the dead key applicantStayingFloor (residence/RCO floor must be addressFloor)', () => {
    const stale = cols.filter((c) => c.sourceRef?.endsWith('.formData.applicantStayingFloor'));
    expect(stale).toEqual([]);
  });

  it('BUSINESS + RESIDENCE_CUM_OFFICE area read officeApproxArea, not approxArea', () => {
    const stale = cols.filter(
      (c) =>
        (c.vtype === 'BUSINESS' || c.vtype === 'RESIDENCE_CUM_OFFICE') &&
        c.sourceRef?.endsWith('.formData.approxArea'),
    );
    expect(stale).toEqual([]);
  });
});
