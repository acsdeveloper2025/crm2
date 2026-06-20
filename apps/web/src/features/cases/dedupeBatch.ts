import type { DuplicateMatch, DedupeDecision } from '@crm2/sdk';

/**
 * Batch dedupe at case creation (ADR-0053): the Search button checks EVERY applicant (not just the
 * primary). Each applicant's matches are kept in its own group so the operator sees which of their
 * applicants flagged which existing case. The case-level decision/rationale is then derived from the
 * union — one case, one `dedupe_decision`.
 */

/** One applicant's dedupe result group (which of MY applicants matched which existing cases). */
export interface DedupeGroup {
  index: number;
  label: string; // 'Applicant' | 'Co-applicant N'
  name: string;
  matches: DuplicateMatch[];
}

/** Roll per-applicant groups up to the case-level decision + the de-duplicated matched case numbers. */
export function summarizeDedupe(groups: DedupeGroup[]): {
  decision: DedupeDecision;
  matchedCaseNumbers: string[];
} {
  const numbers = new Set<string>();
  for (const g of groups) for (const m of g.matches) numbers.add(m.caseNumber);
  const matchedCaseNumbers = [...numbers].sort();
  return {
    decision: matchedCaseNumbers.length > 0 ? 'CREATE_NEW' : 'NO_DUPLICATES_FOUND',
    matchedCaseNumbers,
  };
}
