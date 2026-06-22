import { describe, it, expect } from 'vitest';
import {
  CreateReportLayoutSchema,
  UpdateReportLayoutSchema,
  SOURCE_CATALOG,
  SOURCE_TYPES,
  validateColumnSource,
} from './reportLayouts.js';

const col = (over: Record<string, unknown> = {}) => ({
  columnKey: 'case_no',
  headerLabel: 'Case No',
  sourceType: 'CASE_FIELD',
  sourceRef: 'case_number',
  dataType: 'TEXT',
  ...over,
});
const base = { clientId: 1, productId: 2, kind: 'MIS', name: 'Axis MIS', columns: [col()] };

describe('ReportLayout source catalog', () => {
  it('every SOURCE_TYPES member has a catalog entry', () => {
    for (const t of SOURCE_TYPES) expect(SOURCE_CATALOG[t]).toBeDefined();
  });
  it('FIXED source: ref must be a known field', () => {
    expect(validateColumnSource('TASK_FIELD', 'visit_type')).toBeNull();
    expect(validateColumnSource('TASK_FIELD', 'not_a_field')).toMatch(/not a valid/);
    expect(validateColumnSource('CASE_FIELD', '')).toMatch(/requires a source reference/);
  });
  it('REFLESS source: ref must be empty', () => {
    expect(validateColumnSource('RATE_AMOUNT', null)).toBeNull();
    expect(validateColumnSource('COMMISSION_AMOUNT', undefined)).toBeNull();
    expect(validateColumnSource('TAT', 'something')).toMatch(/takes no source reference/);
  });
  it('FREE source: any non-empty ref accepted, empty rejected', () => {
    expect(validateColumnSource('DATA_ENTRY_FIELD', 'sampler_name')).toBeNull();
    expect(validateColumnSource('DOC_TYPE_COUNT', 'ITR')).toBeNull();
    expect(validateColumnSource('FORM_DATA_PATH', '')).toMatch(/requires a source reference/);
  });
});

describe('CreateReportLayout contract', () => {
  it('accepts a valid layout', () => {
    expect(CreateReportLayoutSchema.safeParse(base).success).toBe(true);
  });
  it('accepts a REFLESS amount column with no ref', () => {
    const r = CreateReportLayoutSchema.safeParse({
      ...base,
      columns: [
        col({
          columnKey: 'bill',
          headerLabel: 'Bill',
          sourceType: 'RATE_AMOUNT',
          sourceRef: undefined,
          dataType: 'NUMBER',
        }),
      ],
    });
    expect(r.success).toBe(true);
  });
  it('rejects a column binding to an unknown fixed field', () => {
    expect(
      CreateReportLayoutSchema.safeParse({ ...base, columns: [col({ sourceRef: 'bogus' })] }).success,
    ).toBe(false);
  });
  it('rejects a REFLESS column carrying a stray ref', () => {
    expect(
      CreateReportLayoutSchema.safeParse({
        ...base,
        columns: [col({ sourceType: 'TAT', sourceRef: 'x', dataType: 'NUMBER' })],
      }).success,
    ).toBe(false);
  });
  it('rejects duplicate column keys', () => {
    expect(CreateReportLayoutSchema.safeParse({ ...base, columns: [col(), col()] }).success).toBe(false);
  });
  it('rejects an invalid column key shape', () => {
    expect(
      CreateReportLayoutSchema.safeParse({ ...base, columns: [col({ columnKey: 'Bad Key' })] }).success,
    ).toBe(false);
  });
  it('rejects an unknown kind and an empty column set', () => {
    expect(CreateReportLayoutSchema.safeParse({ ...base, kind: 'NOPE' }).success).toBe(false);
    expect(CreateReportLayoutSchema.safeParse({ ...base, columns: [] }).success).toBe(false);
  });
});

describe('FIELD_REPORT contract (ADR-0039)', () => {
  const fieldReportCol = col({
    columnKey: 'customer_name',
    headerLabel: 'Customer Name',
    sourceType: 'FORM_DATA_PATH',
    sourceRef: 'residence.formData.customerName',
  });
  const fr = {
    clientId: 1,
    productId: 2,
    kind: 'FIELD_REPORT',
    name: 'Axis Residence Report',
    verificationType: 'RESIDENCE',
    templateBody: 'Visited for {{customer_name}}.',
    columns: [fieldReportCol],
  };
  it('accepts a valid FIELD_REPORT with verificationType + templateBody', () => {
    expect(CreateReportLayoutSchema.safeParse(fr).success).toBe(true);
  });
  it('rejects a FIELD_REPORT missing verificationType', () => {
    expect(CreateReportLayoutSchema.safeParse({ ...fr, verificationType: undefined }).success).toBe(false);
  });
  it('rejects a FIELD_REPORT missing templateBody', () => {
    expect(CreateReportLayoutSchema.safeParse({ ...fr, templateBody: undefined }).success).toBe(false);
  });
  it('rejects a non-FIELD_REPORT kind carrying verificationType or templateBody', () => {
    expect(CreateReportLayoutSchema.safeParse({ ...base, verificationType: 'RESIDENCE' }).success).toBe(
      false,
    );
    expect(CreateReportLayoutSchema.safeParse({ ...base, templateBody: 'x' }).success).toBe(false);
  });
  it('update accepts a templateBody-only patch', () => {
    expect(UpdateReportLayoutSchema.safeParse({ templateBody: 'new body' }).success).toBe(true);
  });
});

describe('CASE_REPORT contract (ADR-0041 slice 3)', () => {
  const cr = {
    clientId: 1,
    productId: 2,
    kind: 'CASE_REPORT',
    name: 'Axis Client Report',
    templateBody: '<h1>{{client.name}}</h1><p>{{case.caseNumber}}</p>',
    pageSize: 'A4',
    pageOrientation: 'portrait',
    columns: [],
  };
  it('accepts a valid CASE_REPORT (body + page geometry, no columns, no verificationType)', () => {
    expect(CreateReportLayoutSchema.safeParse(cr).success).toBe(true);
  });
  it('rejects a CASE_REPORT missing templateBody / pageSize / pageOrientation', () => {
    expect(CreateReportLayoutSchema.safeParse({ ...cr, templateBody: undefined }).success).toBe(false);
    expect(CreateReportLayoutSchema.safeParse({ ...cr, pageSize: undefined }).success).toBe(false);
    expect(CreateReportLayoutSchema.safeParse({ ...cr, pageOrientation: undefined }).success).toBe(false);
  });
  it('rejects a CASE_REPORT carrying columns or a verificationType', () => {
    expect(CreateReportLayoutSchema.safeParse({ ...cr, columns: [col()] }).success).toBe(false);
    expect(CreateReportLayoutSchema.safeParse({ ...cr, verificationType: 'RESIDENCE' }).success).toBe(false);
  });
  it('rejects an invalid pageSize / pageOrientation', () => {
    expect(CreateReportLayoutSchema.safeParse({ ...cr, pageSize: 'A3' }).success).toBe(false);
    expect(CreateReportLayoutSchema.safeParse({ ...cr, pageOrientation: 'sideways' }).success).toBe(false);
  });
  it('⭐ rejects BOTH raw-output forms {{{ }}} AND {{& }} in the template body (output-encoding gate, BLOCK-level)', () => {
    // triple-stash
    expect(
      CreateReportLayoutSchema.safeParse({ ...cr, templateBody: '<p>{{{case.customerName}}}</p>' }).success,
    ).toBe(false);
    // ampersand form — Handlebars treats {{& x}} as raw/un-escaped too (the gate must catch it)
    expect(
      CreateReportLayoutSchema.safeParse({ ...cr, templateBody: '<p>{{& case.customerName}}</p>' }).success,
    ).toBe(false);
    expect(
      CreateReportLayoutSchema.safeParse({ ...cr, templateBody: '<p>{{&case.customerName}}</p>' }).success,
    ).toBe(false);
    // whitespace-control prefix variants are raw too — {{~{ }}} / {{~& }} must NOT slip the gate
    expect(
      CreateReportLayoutSchema.safeParse({ ...cr, templateBody: '<p>{{~& case.customerName}}</p>' }).success,
    ).toBe(false);
    expect(
      CreateReportLayoutSchema.safeParse({ ...cr, templateBody: '<p>{{~{case.customerName}}}</p>' }).success,
    ).toBe(false);
    // same gate on update, all forms
    expect(UpdateReportLayoutSchema.safeParse({ templateBody: '<b>{{{x}}}</b>' }).success).toBe(false);
    expect(UpdateReportLayoutSchema.safeParse({ templateBody: '<b>{{& x}}</b>' }).success).toBe(false);
    expect(UpdateReportLayoutSchema.safeParse({ templateBody: '<b>{{~& x}}</b>' }).success).toBe(false);
    // normal {{ }} — and a whitespace-control {{~x}} on an ESCAPED expression — are fine
    expect(
      CreateReportLayoutSchema.safeParse({ ...cr, templateBody: '<p>{{case.customerName}}</p>' }).success,
    ).toBe(true);
    expect(
      CreateReportLayoutSchema.safeParse({ ...cr, templateBody: '<p>{{~case.customerName}}</p>' }).success,
    ).toBe(true);
  });
  it('rejects page geometry on a non-CASE_REPORT kind', () => {
    expect(CreateReportLayoutSchema.safeParse({ ...base, pageSize: 'A4' }).success).toBe(false);
  });
  it('update accepts a page-geometry patch', () => {
    expect(UpdateReportLayoutSchema.safeParse({ pageOrientation: 'landscape' }).success).toBe(true);
  });
});

describe('ReportLayout uppercase transform (ADR-0058)', () => {
  it('uppercases layout name + column headerLabel/section, preserving keys/refs/template', () => {
    const p = CreateReportLayoutSchema.parse({
      ...base,
      name: 'Axis Mis',
      columns: [col({ headerLabel: 'Case No', section: 'Summary' })],
    });
    expect(p.name).toBe('AXIS MIS');
    expect(p.columns[0]?.headerLabel).toBe('CASE NO');
    expect(p.columns[0]?.section).toBe('SUMMARY');
    // codes/keys/refs are NOT transformed
    expect(p.columns[0]?.columnKey).toBe('case_no');
    expect(p.columns[0]?.sourceRef).toBe('case_number');
  });
  it('uppercases name on update, preserving templateBody/verificationType content', () => {
    const u = UpdateReportLayoutSchema.parse({ name: 'Renamed Layout' });
    expect(u.name).toBe('RENAMED LAYOUT');
    const body = UpdateReportLayoutSchema.parse({ templateBody: 'Visited {{customer_name}}.' });
    expect(body.templateBody).toBe('Visited {{customer_name}}.');
  });
  it('preserves FIELD_REPORT verificationType + templateBody (codes/content not transformed)', () => {
    const p = CreateReportLayoutSchema.parse({
      clientId: 1,
      productId: 2,
      kind: 'FIELD_REPORT',
      name: 'Axis Residence Report',
      verificationType: 'RESIDENCE',
      templateBody: 'Visited for {{customer_name}}.',
      columns: [
        col({
          columnKey: 'customer_name',
          headerLabel: 'Customer Name',
          sourceType: 'FORM_DATA_PATH',
          sourceRef: 'residence.formData.customerName',
        }),
      ],
    });
    expect(p.verificationType).toBe('RESIDENCE');
    expect(p.templateBody).toBe('Visited for {{customer_name}}.');
    expect(p.columns[0]?.sourceRef).toBe('residence.formData.customerName');
  });
});

describe('UpdateReportLayout contract', () => {
  it('accepts a name-only update', () => {
    expect(UpdateReportLayoutSchema.safeParse({ name: 'Renamed' }).success).toBe(true);
  });
  it('accepts a columns-only update', () => {
    expect(UpdateReportLayoutSchema.safeParse({ columns: [col()] }).success).toBe(true);
  });
  it('rejects an empty patch (nothing to update)', () => {
    expect(UpdateReportLayoutSchema.safeParse({}).success).toBe(false);
  });
});
