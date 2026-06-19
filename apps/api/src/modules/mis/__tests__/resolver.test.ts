import { describe, it, expect } from 'vitest';
import type { ReportLayoutColumn } from '@crm2/sdk';
import { resolveColumns } from '../resolver.js';

// Minimal factory — only the fields resolveColumns cares about.
function col(
  sourceType: ReportLayoutColumn['sourceType'],
  sourceRef: string | null,
  header = 'Col',
  dataType: ReportLayoutColumn['dataType'] = 'TEXT',
): ReportLayoutColumn {
  return {
    id: 1,
    columnKey: 'col_key',
    headerLabel: header,
    sourceType,
    sourceRef,
    dataType,
    displayOrder: 0,
    section: null,
    isRequired: false,
    options: [],
    validation: {},
  };
}

describe('resolveColumns', () => {
  it('FIXED TASK_FIELD known ref → aliased column fragment + descriptor', () => {
    const params: unknown[] = [];
    const result = resolveColumns([col('TASK_FIELD', 'task_number', 'Task No', 'TEXT')], params);
    expect(result.selects).toEqual([`ct.task_number AS "c0"`]);
    expect(result.columns).toEqual([{ key: 'c0', header: 'Task No', dataType: 'TEXT' }]);
    expect(params).toEqual([]);
    expect(result.needsApplicant).toBe(false);
    expect(result.needsDataEntry).toBe(false);
    expect(result.needsRate).toBe(false);
    expect(result.needsCommission).toBe(false);
  });

  it('FIXED TASK_FIELD unknown ref → NULL (ref never interpolated)', () => {
    const params: unknown[] = [];
    const result = resolveColumns([col('TASK_FIELD', "x'; DROP TABLE", 'Evil', 'TEXT')], params);
    expect(result.selects).toEqual([`NULL AS "c0"`]);
    // The injected string must NOT appear anywhere in the SQL fragment
    expect(result.selects[0]).not.toContain('DROP TABLE');
    expect(params).toEqual([]);
  });

  it('DATA_ENTRY_FIELD → bound $n, needsDataEntry=true', () => {
    const params: unknown[] = [];
    const result = resolveColumns([col('DATA_ENTRY_FIELD', "evil'--", 'DE', 'TEXT')], params);
    expect(result.selects).toEqual([`de.data ->> $1 AS "c0"`]);
    expect(params).toEqual(["evil'--"]);
    expect(result.needsDataEntry).toBe(true);
  });

  it('FORM_DATA_PATH ref split and bound as array', () => {
    const params: unknown[] = [];
    const result = resolveColumns([col('FORM_DATA_PATH', 'residence.address.line1', 'FDP', 'TEXT')], params);
    expect(result.selects).toEqual([`ct.form_data #>> $1::text[] AS "c0"`]);
    expect(params).toEqual([['residence', 'address', 'line1']]);
  });

  it('RATE_AMOUNT → rt.bill_amount, needsRate=true', () => {
    const params: unknown[] = [];
    const result = resolveColumns([col('RATE_AMOUNT', null, 'Rate', 'NUMBER')], params);
    expect(result.selects).toEqual([`rt.bill_amount AS "c0"`]);
    expect(result.needsRate).toBe(true);
    expect(params).toEqual([]);
  });

  it('COMMISSION_AMOUNT → COALESCE expression, needsCommission=true', () => {
    const params: unknown[] = [];
    const result = resolveColumns([col('COMMISSION_AMOUNT', null, 'Comm', 'NUMBER')], params);
    expect(result.selects).toEqual([`COALESCE(ct.commission_amount, com.commission_amount) AS "c0"`]);
    expect(result.needsCommission).toBe(true);
    expect(params).toEqual([]);
  });

  it('TAT → COMPLETED_BAND expression', () => {
    const params: unknown[] = [];
    const result = resolveColumns([col('TAT', null, 'TAT', 'NUMBER')], params);
    // The select must contain the COMPLETED_BAND subquery (starts with COALESCE)
    expect(result.selects[0]).toMatch(/^COALESCE\(/);
    expect(result.selects[0]).toContain('tat_policies');
    expect(result.selects[0]).toMatch(/AS "c0"$/);
    expect(params).toEqual([]);
  });

  it('RATE_AMOUNT + COMMISSION_AMOUNT → needsRate && needsCommission both true', () => {
    const params: unknown[] = [];
    const result = resolveColumns(
      [col('RATE_AMOUNT', null, 'R', 'NUMBER'), col('COMMISSION_AMOUNT', null, 'C', 'NUMBER')],
      params,
    );
    expect(result.needsRate).toBe(true);
    expect(result.needsCommission).toBe(true);
    expect(result.selects).toHaveLength(2);
    expect(result.selects[0]).toContain('"c0"');
    expect(result.selects[1]).toContain('"c1"');
  });

  it('COMPUTED → NULL', () => {
    const params: unknown[] = [];
    const result = resolveColumns([col('COMPUTED', 'some_expr', 'Computed', 'TEXT')], params);
    expect(result.selects).toEqual([`NULL AS "c0"`]);
    expect(params).toEqual([]);
  });

  it('DOC_TYPE_COUNT → NULL', () => {
    const params: unknown[] = [];
    const result = resolveColumns([col('DOC_TYPE_COUNT', 'RESIDENCE', 'Docs', 'NUMBER')], params);
    expect(result.selects).toEqual([`NULL AS "c0"`]);
    expect(params).toEqual([]);
  });

  it('APPLICANT_FIELD pan → ap.pan, needsApplicant=true', () => {
    const params: unknown[] = [];
    const result = resolveColumns([col('APPLICANT_FIELD', 'pan', 'PAN', 'TEXT')], params);
    expect(result.selects).toEqual([`ap.pan AS "c0"`]);
    expect(result.needsApplicant).toBe(true);
    expect(params).toEqual([]);
  });

  it('DATA_ENTRY_FIELD empty/whitespace ref → NULL, no param pushed', () => {
    const params: unknown[] = [];
    const result = resolveColumns([col('DATA_ENTRY_FIELD', '   ', 'Empty', 'TEXT')], params);
    expect(result.selects).toEqual([`NULL AS "c0"`]);
    expect(params).toEqual([]);
  });

  it('FORM_DATA_PATH empty ref → NULL, no param pushed', () => {
    const params: unknown[] = [];
    const result = resolveColumns([col('FORM_DATA_PATH', '', 'Empty', 'TEXT')], params);
    expect(result.selects).toEqual([`NULL AS "c0"`]);
    expect(params).toEqual([]);
  });

  it('multiple columns produce sequential c0,c1,c2 aliases', () => {
    const params: unknown[] = [];
    const result = resolveColumns(
      [
        col('TASK_FIELD', 'task_number', 'Task No'),
        col('CASE_FIELD', 'case_number', 'Case No'),
        col('APPLICANT_FIELD', 'name', 'Name'),
      ],
      params,
    );
    expect(result.selects[0]).toContain('"c0"');
    expect(result.selects[1]).toContain('"c1"');
    expect(result.selects[2]).toContain('"c2"');
    expect(result.needsApplicant).toBe(true);
  });

  it('CASE_FIELD known key → correct alias', () => {
    const params: unknown[] = [];
    const result = resolveColumns([col('CASE_FIELD', 'client_name', 'Client', 'TEXT')], params);
    expect(result.selects).toEqual([`cl.name AS "c0"`]);
  });

  it('DATA_ENTRY_FIELD param index increments correctly with pre-existing params', () => {
    const params: unknown[] = ['existing'];
    const result = resolveColumns([col('DATA_ENTRY_FIELD', 'field_a', 'A', 'TEXT')], params);
    // params already had 1 item, so next placeholder is $2
    expect(result.selects).toEqual([`de.data ->> $2 AS "c0"`]);
    expect(params).toEqual(['existing', 'field_a']);
  });
});
