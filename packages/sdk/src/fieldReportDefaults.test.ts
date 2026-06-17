import { describe, it, expect } from 'vitest';
import { FIELD_REPORT_DEFAULTS, FIELD_REPORT_HELPER_SET } from './fieldReportDefaults.js';
import { CreateReportLayoutSchema } from './reportLayouts.js';

describe('FIELD_REPORT_DEFAULTS (standard templates)', () => {
  for (const [vtype, def] of Object.entries(FIELD_REPORT_DEFAULTS)) {
    describe(vtype, () => {
      it('is a valid FIELD_REPORT layout (passes CreateReportLayoutSchema)', () => {
        const r = CreateReportLayoutSchema.safeParse({
          clientId: 1,
          productId: 2,
          kind: 'FIELD_REPORT',
          name: `${vtype} Report`,
          verificationType: vtype,
          templateBody: def.templateBody,
          columns: def.columns,
        });
        expect(r.success, r.success ? '' : JSON.stringify(r.error.issues)).toBe(true);
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
