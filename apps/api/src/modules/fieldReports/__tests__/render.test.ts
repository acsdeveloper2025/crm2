import { describe, it, expect } from 'vitest';
import type { ReportLayoutColumn } from '@crm2/sdk';
import { renderNarrative, resolveColumnValue, buildContext } from '../render.js';
import type { TaskRenderContext } from '../repository.js';

const ctx: TaskRenderContext = {
  taskId: 't1',
  clientId: 1,
  productId: 2,
  verificationType: 'RESIDENCE',
  formData: {
    residence: {
      formData: { customerName: 'RAJESH', evil: '<script>x</script>' },
      verificationOutcome: 'POSITIVE',
    },
  },
  task: { verification_outcome: 'POSITIVE', remark: 'all ok', address: '12 MG ROAD' },
  case: { case_number: 'CASE-000001', client_name: 'Axis Bank' },
  applicant: { name: 'RAJESH KUMAR', pan: 'ABCDE1234F' },
};

const col = (over: Partial<ReportLayoutColumn>): ReportLayoutColumn => ({
  id: 1,
  columnKey: 'x',
  headerLabel: 'X',
  sourceType: 'COMPUTED',
  sourceRef: null,
  dataType: 'TEXT',
  displayOrder: 0,
  section: null,
  isRequired: false,
  options: [],
  validation: {},
  ...over,
});

describe('field-report render', () => {
  it('resolves each catalog source', () => {
    expect(
      resolveColumnValue(
        col({ sourceType: 'FORM_DATA_PATH', sourceRef: 'residence.formData.customerName' }),
        ctx,
      ),
    ).toBe('RAJESH');
    expect(
      resolveColumnValue(
        col({ sourceType: 'FORM_DATA_PATH', sourceRef: 'residence.verificationOutcome' }),
        ctx,
      ),
    ).toBe('POSITIVE');
    expect(resolveColumnValue(col({ sourceType: 'TASK_FIELD', sourceRef: 'remark' }), ctx)).toBe('all ok');
    expect(resolveColumnValue(col({ sourceType: 'CASE_FIELD', sourceRef: 'case_number' }), ctx)).toBe(
      'CASE-000001',
    );
    expect(resolveColumnValue(col({ sourceType: 'APPLICANT_FIELD', sourceRef: 'pan' }), ctx)).toBe(
      'ABCDE1234F',
    );
  });

  it('missing / unknown / bad-path → undefined; non-narrative sources → empty string', () => {
    expect(
      resolveColumnValue(col({ sourceType: 'FORM_DATA_PATH', sourceRef: 'nope.deep.path' }), ctx),
    ).toBeUndefined();
    expect(
      resolveColumnValue(col({ sourceType: 'TASK_FIELD', sourceRef: 'not_a_field' }), ctx),
    ).toBeUndefined();
    expect(resolveColumnValue(col({ sourceType: 'RATE_AMOUNT', sourceRef: null }), ctx)).toBe('');
    expect(resolveColumnValue(col({ sourceType: 'TAT', sourceRef: null }), ctx)).toBe('');
  });

  it('buildContext keys by columnKey and blanks missing values', () => {
    const c = buildContext(
      [
        col({
          columnKey: 'cust',
          sourceType: 'FORM_DATA_PATH',
          sourceRef: 'residence.formData.customerName',
        }),
        col({ columnKey: 'missing', sourceType: 'TASK_FIELD', sourceRef: 'not_a_field' }),
      ],
      ctx,
    );
    expect(c).toEqual({ cust: 'RAJESH', missing: '' });
  });

  it('renders a narrative, blanks missing placeholders, collapses whitespace', () => {
    const cols = [
      col({ columnKey: 'cust', sourceType: 'FORM_DATA_PATH', sourceRef: 'residence.formData.customerName' }),
      col({ columnKey: 'addr', sourceType: 'TASK_FIELD', sourceRef: 'address' }),
      col({ columnKey: 'phone', sourceType: 'TASK_FIELD', sourceRef: 'not_a_field' }),
    ];
    const out = renderNarrative('Visited {{addr}} for {{cust}}.  Phone: {{phone}} .', cols, ctx);
    expect(out).toBe('Visited 12 MG ROAD for RAJESH. Phone: .');
  });

  it('renders PLAIN TEXT (noEscape) — literal quotes/entities, NOT HTML-escaped (v1 parity)', () => {
    // The narrative is plain text (v1 prints `shows the name "X"` with literal quotes). Handlebars
    // noEscape preserves the raw value; XSS-safety is the consumer's job (the #6 card renders it as a
    // React text node → auto-escaped). So the engine MUST NOT HTML-encode here.
    const cols = [
      col({ columnKey: 'name', sourceType: 'FORM_DATA_PATH', sourceRef: 'residence.formData.customerName' }),
      col({ columnKey: 'e', sourceType: 'FORM_DATA_PATH', sourceRef: 'residence.formData.evil' }),
    ];
    expect(renderNarrative('Door nameplate shows the name "{{name}}".', cols, ctx)).toBe(
      'Door nameplate shows the name "RAJESH".',
    );
    // raw value preserved verbatim (not &lt;script&gt;) — consumer output-encodes downstream
    expect(renderNarrative('Note: {{e}}', cols, ctx)).toBe('Note: <script>x</script>');
  });

  it('supports {{#if}} and the {{#eq}} helper for outcome branching', () => {
    const cols = [
      col({ columnKey: 'outcome', sourceType: 'FORM_DATA_PATH', sourceRef: 'residence.verificationOutcome' }),
    ];
    const tpl = '{{#eq outcome "POSITIVE"}}Confirmed positive.{{/eq}}{{#if outcome}} ({{outcome}}){{/if}}';
    expect(renderNarrative(tpl, cols, ctx)).toBe('Confirmed positive. (POSITIVE)');
  });

  it('prototype-access in a template is inert (proto walking disabled)', () => {
    // A template referencing prototype chain renders empty, not the constructor — defence-in-depth.
    const out = renderNarrative('x{{constructor}}y{{__proto__}}z', [], ctx);
    expect(out).toBe('xyz');
  });
});
