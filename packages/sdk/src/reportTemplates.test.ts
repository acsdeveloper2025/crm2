import { describe, it, expect } from 'vitest';
import { CreateReportTemplateSchema, UpdateReportTemplateSchema } from './reportTemplates.js';
import { REPORT_TEMPLATE_TYPES } from './verificationUnit.js';

const base = { code: 'FIELD_RESIDENCE_V1', name: 'Residence', templateType: 'FIELD_NARRATIVE' as const };

describe('ReportTemplate contract', () => {
  it('accepts a valid template and defaults content to empty', () => {
    const parsed = CreateReportTemplateSchema.safeParse(base);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.content).toBe('');
  });
  it('uppercases the name, leaving code/content untouched (ADR-0058)', () => {
    const parsed = CreateReportTemplateSchema.safeParse({ ...base, content: 'Some body' });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.name).toBe('RESIDENCE');
      expect(parsed.data.code).toBe('FIELD_RESIDENCE_V1');
      expect(parsed.data.content).toBe('Some body');
    }
    const updated = UpdateReportTemplateSchema.safeParse({
      name: 'Office report',
      templateType: 'KYC_DOCUMENT',
      content: 'x',
    });
    expect(updated.success && updated.data.name).toBe('OFFICE REPORT');
  });
  it('rejects a lowercase code', () => {
    expect(CreateReportTemplateSchema.safeParse({ ...base, code: 'lower' }).success).toBe(false);
  });
  it('rejects an unknown template type', () => {
    expect(CreateReportTemplateSchema.safeParse({ ...base, templateType: 'OTHER' }).success).toBe(false);
  });
  it('update: code optional (ADR-0020 — correctable while unreferenced); validated when present', () => {
    expect(
      UpdateReportTemplateSchema.safeParse({ name: 'N', templateType: 'KYC_DOCUMENT', content: 'x' }).success,
    ).toBe(true);
    const withCode = UpdateReportTemplateSchema.safeParse({
      name: 'N',
      templateType: 'KYC_DOCUMENT',
      content: 'x',
      code: 'FIELD_RESIDENCE_V2',
    });
    expect(withCode.success && withCode.data.code).toBe('FIELD_RESIDENCE_V2');
  });
  it('exposes the two report template types', () => {
    expect(REPORT_TEMPLATE_TYPES).toHaveLength(2);
  });
});
