import { describe, it, expect } from 'vitest';
import {
  CreateCaseSchema,
  DedupeQuerySchema,
  AddTasksSchema,
  AddApplicantSchema,
  AssignTaskSchema,
  CASE_STATUSES,
  CASE_TASK_STATUSES,
  DEDUPE_DECISIONS,
  VISIT_TYPES,
  FIELD_RATE_TYPES,
  TASK_ORIGINS,
  ReassignTaskSchema,
} from './cases.js';

const base = {
  clientId: 1,
  productId: 2,
  backendContactNumber: '9876543210',
  applicants: [{ name: 'Ramesh' }],
  dedupeDecision: 'NO_DUPLICATES_FOUND' as const,
};

const APPL = '00000000-0000-0000-0000-0000000000aa';
const taskBase = { verificationUnitId: 1, applicantId: APPL, address: '12 MG Road' };

describe('Case contract', () => {
  it('task lifecycle exposes SUBMITTED (field-done) and retires SUBMITTED_FOR_REVIEW (ADR-0047)', () => {
    expect(CASE_TASK_STATUSES).toContain('SUBMITTED');
    expect(CASE_TASK_STATUSES as readonly string[]).not.toContain('SUBMITTED_FOR_REVIEW');
  });
  it('accepts a valid create with one applicant and a dedupe decision', () => {
    expect(CreateCaseSchema.safeParse(base).success).toBe(true);
  });

  it('ADR-0058: uppercases applicant name + company on create (server-side safety net)', () => {
    const parsed = CreateCaseSchema.safeParse({
      ...base,
      applicants: [{ name: 'Ramesh kumar', companyName: 'Acme Pvt Ltd' }],
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.applicants[0]?.name).toBe('RAMESH KUMAR');
      expect(parsed.data.applicants[0]?.companyName).toBe('ACME PVT LTD');
    }
  });

  it('ADR-0058: uppercases the dedupe rationale on create', () => {
    const parsed = CreateCaseSchema.safeParse({
      ...base,
      dedupeDecision: 'CREATE_NEW',
      dedupeRationale: 'genuinely a different case',
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.dedupeRationale).toBe('GENUINELY A DIFFERENT CASE');
    }
  });
  it('requires at least one applicant', () => {
    expect(CreateCaseSchema.safeParse({ ...base, applicants: [] }).success).toBe(false);
  });
  it('requires a dedupe decision', () => {
    const { dedupeDecision: _omit, ...noDecision } = base;
    expect(CreateCaseSchema.safeParse(noDecision).success).toBe(false);
  });
  it('requires a rationale when CREATE_NEW despite duplicates', () => {
    expect(CreateCaseSchema.safeParse({ ...base, dedupeDecision: 'CREATE_NEW' }).success).toBe(false);
    expect(
      CreateCaseSchema.safeParse({
        ...base,
        dedupeDecision: 'CREATE_NEW',
        dedupeRationale: 'genuinely a different case',
      }).success,
    ).toBe(true);
  });

  it('dedupe query needs at least one identifier', () => {
    expect(DedupeQuerySchema.safeParse({}).success).toBe(false);
    expect(DedupeQuerySchema.safeParse({ pan: 'ABCDE1234F' }).success).toBe(true);
    expect(DedupeQuerySchema.safeParse({ name: 'Ramesh' }).success).toBe(true);
  });

  it('create requires a backend contact number (10–15 digits)', () => {
    const { backendContactNumber: _omit, ...noContact } = base;
    expect(CreateCaseSchema.safeParse(noContact).success).toBe(false);
    expect(CreateCaseSchema.safeParse({ ...base, backendContactNumber: 'no' }).success).toBe(false);
    expect(CreateCaseSchema.safeParse({ ...base, backendContactNumber: '98765' }).success).toBe(false); // too short
    expect(CreateCaseSchema.safeParse({ ...base, backendContactNumber: '98765abcde' }).success).toBe(false); // non-digit
  });

  it('validates applicant PAN format and mobile digits', () => {
    const ok = (a: object) => CreateCaseSchema.safeParse({ ...base, applicants: [a] }).success;
    expect(ok({ name: 'A', pan: 'ABCDE1234F' })).toBe(true);
    expect(ok({ name: 'A', pan: 'abcde1234f' })).toBe(true); // case-insensitive (FE uppercases)
    expect(ok({ name: 'A', pan: 'ABCD1234F' })).toBe(false); // 4 letters
    expect(ok({ name: 'A', pan: 'ABCDE12345' })).toBe(false); // wrong shape
    expect(ok({ name: 'A', mobile: '9876543210' })).toBe(true);
    expect(ok({ name: 'A', mobile: '98765' })).toBe(false); // too short
    expect(ok({ name: 'A', mobile: '98765-43210' })).toBe(false); // non-digit
  });

  it('add-tasks requires explicit per-task specs (unit + applicant; address only for a FIELD visit)', () => {
    expect(AddTasksSchema.safeParse({ tasks: [] }).success).toBe(false);
    const parsed = AddTasksSchema.safeParse({ tasks: [taskBase] });
    expect(parsed.success).toBe(true);
    // trigger + priority default in; ADR-0058: address is uppercased server-side
    if (parsed.success) {
      expect(parsed.data.tasks[0]?.trigger).toBe('');
      expect(parsed.data.tasks[0]?.priority).toBe('MEDIUM');
      expect(parsed.data.tasks[0]?.address).toBe('12 MG ROAD');
    }
    // applicantId must be a uuid; priority enum-checked
    expect(AddTasksSchema.safeParse({ tasks: [{ ...taskBase, applicantId: 'nope' }] }).success).toBe(false);
    expect(AddTasksSchema.safeParse({ tasks: [{ ...taskBase, priority: 'WHENEVER' }] }).success).toBe(false);
    // ADR-0044/0050: address is required only for a FIELD visit; an assign-later task (no visitType) may
    // omit it (it's set when later dispatched as FIELD), and OFFICE/desk tasks have no address.
    expect(AddTasksSchema.safeParse({ tasks: [{ ...taskBase, address: '' }] }).success).toBe(true);
    expect(
      AddTasksSchema.safeParse({ tasks: [{ ...taskBase, visitType: 'FIELD', address: '' }] }).success,
    ).toBe(false);
    // a target-TAT override (ADR-0044) is accepted alongside the defaulted priority.
    const withTat = AddTasksSchema.safeParse({ tasks: [{ ...taskBase, tatHours: 8 }] });
    expect(withTat.success).toBe(true);
    if (withTat.success) expect(withTat.data.tasks[0]?.tatHours).toBe(8);
    // ADR-0085 unified KYC document fields: optional; number/holder + BOTH sides of every detail
    // uppercase (ADR-0058); labels trimmed; >12 details or a blank label rejected.
    const withDoc = AddTasksSchema.safeParse({
      tasks: [
        {
          ...taskBase,
          documentNumber: 'ab12cd3456',
          documentHolderName: 'rahul sharma',
          documentDetails: { ' Bank name ': 'hdfc bank' },
        },
      ],
    });
    expect(withDoc.success).toBe(true);
    if (withDoc.success) {
      expect(withDoc.data.tasks[0]?.documentNumber).toBe('AB12CD3456');
      expect(withDoc.data.tasks[0]?.documentHolderName).toBe('RAHUL SHARMA');
      expect(withDoc.data.tasks[0]?.documentDetails).toEqual({ 'BANK NAME': 'HDFC BANK' });
    }
    expect(
      AddTasksSchema.safeParse({ tasks: [{ ...taskBase, documentDetails: { '  ': 'X' } }] }).success,
    ).toBe(false);
    // labels that collapse after normalization would silently lose a value → rejected
    expect(
      AddTasksSchema.safeParse({
        tasks: [{ ...taskBase, documentDetails: { ' Bank name ': 'HDFC', 'BANK NAME': 'ICICI' } }],
      }).success,
    ).toBe(false);
    expect(
      AddTasksSchema.safeParse({
        tasks: [
          {
            ...taskBase,
            documentDetails: Object.fromEntries(Array.from({ length: 13 }, (_, i) => [`K${i}`, 'V'])),
          },
        ],
      }).success,
    ).toBe(false);
  });

  it('ADR-0058: uppercases the task trigger server-side', () => {
    const parsed = AddTasksSchema.safeParse({ tasks: [{ ...taskBase, trigger: 'call before visit' }] });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.tasks[0]?.trigger).toBe('CALL BEFORE VISIT');
  });

  it('exposes the case statuses and dedupe decisions', () => {
    expect(CASE_STATUSES).toContain('NEW');
    expect(DEDUPE_DECISIONS).toEqual(['NO_DUPLICATES_FOUND', 'CREATE_NEW']);
  });

  it('task lineage origins (ADR-0033): ORIGINAL + REVISIT (recheck collapsed for v2)', () => {
    expect(TASK_ORIGINS).toEqual(['ORIGINAL', 'REVISIT']);
  });

  it('reassign-after-revoke requires a uuid assignee + visit type + non-negative bill; distance band + reason optional', () => {
    const ok = {
      assignedTo: '00000000-0000-0000-0000-000000000001',
      visitType: 'OFFICE',
      fieldRateType: 'LOCAL',
      billCount: 1,
    };
    expect(ReassignTaskSchema.safeParse(ok).success).toBe(true);
    expect(ReassignTaskSchema.safeParse({ ...ok, reason: 'redispatch' }).success).toBe(true);
    expect(ReassignTaskSchema.safeParse({ ...ok, assignedTo: 'nope' }).success).toBe(false);
    expect(ReassignTaskSchema.safeParse({ ...ok, visitType: 'DRONE' }).success).toBe(false);
    // ADR-0050: fieldRateType is the commission resolution key but OPTIONAL — a bad value is rejected,
    // omitting it is allowed (the task just resolves no commission).
    expect(ReassignTaskSchema.safeParse({ ...ok, fieldRateType: 'FAR' }).success).toBe(false);
    const { fieldRateType: _omit, ...noBand } = ok;
    expect(ReassignTaskSchema.safeParse(noBand).success).toBe(true);
    expect(ReassignTaskSchema.safeParse({ ...ok, billCount: -1 }).success).toBe(false);
  });

  it('assign-task requires a uuid assignee, valid visit/distance, and a non-negative bill count', () => {
    const ok = {
      assignedTo: '00000000-0000-0000-0000-000000000001',
      visitType: 'FIELD',
      fieldRateType: 'LOCAL',
      billCount: 1,
    };
    expect(AssignTaskSchema.safeParse(ok).success).toBe(true);
    expect(AssignTaskSchema.safeParse({ ...ok, assignedTo: 'not-a-uuid' }).success).toBe(false);
    expect(AssignTaskSchema.safeParse({ ...ok, visitType: 'DRONE' }).success).toBe(false);
    expect(AssignTaskSchema.safeParse({ ...ok, fieldRateType: 'FAR' }).success).toBe(false);
    expect(AssignTaskSchema.safeParse({ ...ok, billCount: -1 }).success).toBe(false);
    expect(VISIT_TYPES).toEqual(['FIELD', 'OFFICE']);
    expect(FIELD_RATE_TYPES).toEqual(['LOCAL', 'OGL']);
  });
});

describe('AddApplicantSchema (ADR-0053)', () => {
  const base = { name: 'Sita Rao', dedupeDecision: 'NO_DUPLICATES_FOUND' as const };

  it('accepts a clean add with no rationale', () => {
    expect(AddApplicantSchema.safeParse(base).success).toBe(true);
  });

  it('accepts CREATE_NEW with a rationale', () => {
    const r = AddApplicantSchema.safeParse({
      ...base,
      dedupeDecision: 'CREATE_NEW',
      dedupeRationale: 'different loan, same person',
      dedupeMatches: ['CASE-000123'],
    });
    expect(r.success).toBe(true);
  });

  it('rejects CREATE_NEW without a rationale', () => {
    const r = AddApplicantSchema.safeParse({ ...base, dedupeDecision: 'CREATE_NEW' });
    expect(r.success).toBe(false);
  });

  it('rejects a missing name', () => {
    expect(AddApplicantSchema.safeParse({ dedupeDecision: 'NO_DUPLICATES_FOUND' }).success).toBe(false);
  });

  it('rejects a malformed PAN', () => {
    expect(AddApplicantSchema.safeParse({ ...base, pan: 'nope' }).success).toBe(false);
  });

  it('ADR-0058: uppercases name, company, and rationale on add-applicant', () => {
    const parsed = AddApplicantSchema.safeParse({
      name: 'Sita Rao',
      companyName: 'Beta llp',
      dedupeDecision: 'CREATE_NEW',
      dedupeRationale: 'different loan, same person',
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.name).toBe('SITA RAO');
      expect(parsed.data.companyName).toBe('BETA LLP');
      expect(parsed.data.dedupeRationale).toBe('DIFFERENT LOAN, SAME PERSON');
    }
  });
});
