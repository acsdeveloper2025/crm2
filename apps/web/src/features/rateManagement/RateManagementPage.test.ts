import { describe, it, expect } from 'vitest';
import { buildHistoryCsv } from './RateManagementPage.js';
import { formatDateTime } from '../../lib/format.js';
import type { RateHistory } from '@crm2/sdk';

/**
 * UX-13: HistoryDialog "Export CSV" — the rows are already loaded client-side (no new endpoint).
 * Header is fixed (`When,Action,Old,New`); every cell gets the CWE-1236 formula-injection guard
 * since history is partly free-text (action/changedBy) that could be manipulated upstream.
 */
describe('buildHistoryCsv (rate history export, UX-13)', () => {
  const row = (overrides: Partial<RateHistory>): RateHistory => ({
    id: 1,
    rateId: 10,
    action: 'CREATE',
    oldAmount: null,
    newAmount: 500,
    oldEffectiveTo: null,
    newEffectiveFrom: '2026-01-01',
    changedBy: 'admin',
    changedAt: '2026-01-01T10:00:00.000Z',
    ...overrides,
  });

  it('emits the fixed header row', () => {
    expect(buildHistoryCsv([]).split('\r\n')[0]).toBe('When,Action,Old,New');
  });

  it('emits one data row per history entry, dates formatted as displayed in the dialog', () => {
    const csv = buildHistoryCsv([
      row({ id: 1, action: 'CREATE', oldAmount: null, newAmount: 500 }),
      row({ id: 2, action: 'REVISE', oldAmount: 500, newAmount: 750, changedAt: '2026-02-03T04:05:00.000Z' }),
    ]);
    const lines = csv.split('\r\n');
    expect(lines).toHaveLength(3);
    // formatDateTime embeds a comma ("01 Jan 2026, 15:30") so the cell is RFC-4180 quoted.
    expect(lines[1]).toBe(`"${formatDateTime('2026-01-01T10:00:00.000Z')}",CREATE,,500.00`);
    expect(lines[2]).toBe(`"${formatDateTime('2026-02-03T04:05:00.000Z')}",REVISE,500.00,750.00`);
  });

  it('empty history produces a header-only file', () => {
    expect(buildHistoryCsv([])).toBe('When,Action,Old,New');
  });

  it('prefixes cells starting with = + - @ with a single quote (CWE-1236)', () => {
    const csv = buildHistoryCsv([row({ id: 1, action: '=SUM(A1:A9)' as RateHistory['action'] })]);
    const dataLine = csv.split('\r\n')[1];
    // Action cell must be guarded — even though `action` is normally a closed enum, the guard is
    // applied uniformly so a future free-text field never slips an executable formula into a cell.
    // (The "When" cell is quoted for its embedded comma, so match on the Action field directly.)
    expect(dataLine).toContain(",'=SUM(A1:A9),");
  });
});
