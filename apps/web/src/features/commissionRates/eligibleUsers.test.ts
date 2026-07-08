import { describe, it, expect } from 'vitest';
import { COMMISSION_ELIGIBLE_ROLES, commissionEligibleUsers } from './eligibleUsers.js';

/**
 * Commission resolves via commission_rates.user_id = case_tasks.assigned_to, and only
 * FIELD_AGENT/KYC_VERIFIER can ever be a task assignee (ADR-0024/0073) — any other role's rate
 * is a guaranteed-dead row (owner decision 2026-07-08). Pinned here so the eligible-role list
 * can't silently drift.
 */
describe('COMMISSION_ELIGIBLE_ROLES', () => {
  it('is exactly FIELD_AGENT and KYC_VERIFIER', () => {
    expect(COMMISSION_ELIGIBLE_ROLES).toEqual(['FIELD_AGENT', 'KYC_VERIFIER']);
  });
});

describe('commissionEligibleUsers', () => {
  it('keeps only FIELD_AGENT and KYC_VERIFIER rows, preserving order', () => {
    const users = [
      { id: '1', role: 'SUPER_ADMIN' },
      { id: '2', role: 'FIELD_AGENT' },
      { id: '3', role: 'OPS_MANAGER' },
      { id: '4', role: 'KYC_VERIFIER' },
      { id: '5', role: 'BILLING_MANAGER' },
    ];
    expect(commissionEligibleUsers(users)).toEqual([
      { id: '2', role: 'FIELD_AGENT' },
      { id: '4', role: 'KYC_VERIFIER' },
    ]);
  });

  it('returns an empty array for an empty input', () => {
    expect(commissionEligibleUsers([])).toEqual([]);
  });
});
