import { describe, it, expect } from 'vitest';
import { FIELD_REPORT_DEFAULTS, type ReportLayoutColumn } from '@crm2/sdk';
import { renderNarrative } from '../render.js';
import { canonicalizeRenderContext } from '../canonicalize.js';
import type { TaskRenderContext } from '../repository.js';

/**
 * Device-contract tests (ADR-0057, closes audit AUDIT-4). These feed the REAL v2-native device payload —
 * an uppercase outcome CODE + the per-type status field + SPLIT `<base>Value`/`<base>Unit` periods — the
 * shape the app actually submits (unlike defaults.*.render.test.ts, which feed the v1 verbose label and so
 * never exercised this path). Each asserts that canonicalize → renderNarrative produces the correct,
 * non-empty v1-faithful branch.
 */

const colsFor = (type: string): ReportLayoutColumn[] =>
  FIELD_REPORT_DEFAULTS[type]!.columns.map(
    (c, i): ReportLayoutColumn => ({
      id: i + 1,
      columnKey: c.columnKey,
      headerLabel: c.headerLabel,
      sourceType: c.sourceType,
      sourceRef: c.sourceRef ?? null,
      dataType: c.dataType,
      displayOrder: i,
      section: c.section ?? null,
      isRequired: c.isRequired ?? false,
      options: [],
      validation: {},
    }),
  );

/** Build a device-shaped render context: a CODE outcome + camelCase form fields under `.formData`. */
const ctx = (
  slug: string,
  type: string,
  formData: Record<string, unknown>,
  code: string,
): TaskRenderContext => ({
  taskId: 't1',
  clientId: 1,
  productId: 2,
  verificationType: type,
  formData: { [slug]: { formData, verificationOutcome: code } },
  task: { address: '12 MG ROAD' },
  case: {},
  applicant: { name: 'RAJESH KUMAR', applicant_type: 'Applicant' },
});

const render = (c: TaskRenderContext): string => {
  const t = c.verificationType;
  return renderNarrative(FIELD_REPORT_DEFAULTS[t]!.templateBody, colsFor(t), canonicalizeRenderContext(c));
};

// slug, type, status field, remark header — the 8 door/piv families.
const DOOR_TYPES: Array<[string, string, string, string]> = [
  ['residence', 'RESIDENCE', 'houseStatus', 'Residence Remark:'],
  ['office', 'OFFICE', 'officeStatus', 'Office Remark:'],
  ['business', 'BUSINESS', 'businessStatus', 'Business Remark:'],
  ['residence-cum-office', 'RESIDENCE_CUM_OFFICE', 'resiCumOfficeStatus', 'Residence-cum-Office Remark:'],
  ['builder', 'BUILDER', 'officeStatus', 'Builder Remark:'],
  ['noc', 'NOC', 'officeStatus', 'NOC Remark:'],
  ['dsa-connector', 'DSA_CONNECTOR', 'officeStatus', 'Connector Remark:'],
  ['property-individual', 'PROPERTY_INDIVIDUAL', 'flatStatus', 'Property Individual Remark:'],
];

describe('FIELD_REPORT canonicalization — device CODE outcome → v1 verbose-label branch', () => {
  for (const [slug, type, statusField, header] of DOOR_TYPES) {
    it(`${type}: POSITIVE + ${statusField}=Open → "${header} POSITIVE & DOOR OPEN."`, () => {
      const out = render(ctx(slug, type, { [statusField]: 'Open', finalStatus: 'Positive' }, 'POSITIVE'));
      expect(out).toContain(`${header} POSITIVE & DOOR OPEN.`);
      expect(out.length).toBeGreaterThan(0);
    });

    it(`${type}: POSITIVE + ${statusField}=Closed → "POSITIVE & DOOR LOCKED."`, () => {
      const out = render(ctx(slug, type, { [statusField]: 'Closed', finalStatus: 'Positive' }, 'POSITIVE'));
      expect(out).toContain(`${header} POSITIVE & DOOR LOCKED.`);
    });

    it(`${type}: ENTRY_RESTRICTED → ERT branch; UNTRACEABLE → Untraceable branch`, () => {
      expect(render(ctx(slug, type, { [statusField]: 'Open' }, 'ENTRY_RESTRICTED'))).toContain(
        `${header} ENTRY RESTRICTED.`,
      );
      expect(render(ctx(slug, type, { [statusField]: 'Open' }, 'UNTRACEABLE'))).toContain(
        `${header} UNTRACEABLE.`,
      );
    });
  }

  it('RESIDENCE: NSP + houseStatus=Closed → NSP & DOOR LOCKED branch', () => {
    const out = render(ctx('residence', 'RESIDENCE', { houseStatus: 'Closed' }, 'NSP'));
    expect(out).toContain('Residence Remark: NSP & DOOR LOCKED.');
  });

  it('PROPERTY_APF: POSITIVE code + finalStatus=Positive → POSITIVE; finalStatus=Negative → NEGATIVE', () => {
    const pos = render(
      ctx(
        'property-apf',
        'PROPERTY_APF',
        { constructionActivity: 'SEEN', finalStatus: 'Positive' },
        'POSITIVE',
      ),
    );
    expect(pos).toContain('Property APF Remark: POSITIVE.');
    const neg = render(
      ctx(
        'property-apf',
        'PROPERTY_APF',
        { constructionActivity: 'STOPPED', finalStatusNegative: 'Negative' },
        'POSITIVE',
      ),
    );
    expect(neg).toContain('Property APF Remark: NEGATIVE.');
  });

  it('recombines split <base>Value/<base>Unit into the combined period token (pluralized)', () => {
    const out = render(
      ctx(
        'residence',
        'RESIDENCE',
        {
          houseStatus: 'Open',
          metPersonName: 'MAYUR',
          metPersonRelation: 'Son',
          stayingPeriodValue: '6',
          stayingPeriodUnit: 'Year',
          stayingStatus: 'On a Self Owned Basis',
          finalStatus: 'Positive',
        },
        'POSITIVE',
      ),
    );
    expect(out).toContain('for the last 6 Years on a self owned basis.');
  });

  it('REGRESSION: the raw device CODE without canonicalize renders an EMPTY body (the bug)', () => {
    const c = ctx('residence', 'RESIDENCE', { houseStatus: 'Open', finalStatus: 'Positive' }, 'POSITIVE');
    // bypass canonicalize → the v1-label templates never match the code
    const raw = renderNarrative(FIELD_REPORT_DEFAULTS['RESIDENCE']!.templateBody, colsFor('RESIDENCE'), c);
    expect(raw).toBe('');
    // with canonicalize → the branch renders
    expect(render(c)).toContain('Residence Remark: POSITIVE & DOOR OPEN.');
  });

  it('idempotent / backward-compatible: an already-verbose label is left verbatim', () => {
    const out = render(
      ctx(
        'residence',
        'RESIDENCE',
        { houseStatus: 'Open', finalStatus: 'Positive' },
        'Positive & Door Locked',
      ),
    );
    expect(out).toContain('Residence Remark: POSITIVE & DOOR LOCKED.');
  });
});
