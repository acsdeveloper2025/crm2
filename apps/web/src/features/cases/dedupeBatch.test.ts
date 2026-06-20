import { describe, it, expect } from 'vitest';
import { summarizeDedupe, type DedupeGroup } from './dedupeBatch.js';

const match = (caseNumber: string): DedupeGroup['matches'][number] => ({
  caseId: 'x',
  caseNumber,
  applicantName: 'A',
  mobile: null,
  pan: null,
  companyName: null,
  status: 'NEW',
  clientName: 'C',
  createdAt: '',
  matchType: ['NAME'],
});

describe('summarizeDedupe (ADR-0053 batch dedupe)', () => {
  it('NO_DUPLICATES_FOUND when every applicant is clean', () => {
    const groups: DedupeGroup[] = [
      { index: 0, label: 'Applicant', name: 'Ravi', matches: [] },
      { index: 1, label: 'Co-applicant 1', name: 'Sita', matches: [] },
    ];
    expect(summarizeDedupe(groups)).toEqual({ decision: 'NO_DUPLICATES_FOUND', matchedCaseNumbers: [] });
  });

  it('CREATE_NEW + de-duplicated union of case numbers when ANY applicant matches', () => {
    const groups: DedupeGroup[] = [
      { index: 0, label: 'Applicant', name: 'Ravi', matches: [match('CASE-000001'), match('CASE-000002')] },
      { index: 1, label: 'Co-applicant 1', name: 'Sita', matches: [match('CASE-000002')] },
    ];
    expect(summarizeDedupe(groups)).toEqual({
      decision: 'CREATE_NEW',
      matchedCaseNumbers: ['CASE-000001', 'CASE-000002'],
    });
  });
});
