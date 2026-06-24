import { describe, it, expect } from 'vitest';
import type { CaseTaskView } from '@crm2/sdk';
import { fieldVisitTasks } from './fieldReportTasks.js';

const task = (id: string, unitKind: CaseTaskView['unitKind']): CaseTaskView =>
  ({ id, unitKind }) as CaseTaskView;

describe('fieldVisitTasks (A2026-0623-17)', () => {
  it('keeps FIELD_VISIT tasks and drops desk (KYC_DOCUMENT / DESK_DOCUMENT) tasks', () => {
    const tasks = [
      task('a', 'FIELD_VISIT'),
      task('b', 'KYC_DOCUMENT'),
      task('c', 'DESK_DOCUMENT'),
      task('d', 'FIELD_VISIT'),
    ];
    expect(fieldVisitTasks(tasks).map((t) => t.id)).toEqual(['a', 'd']);
  });

  it('a case of only KYC tasks yields no field-report rows (card shows its empty state)', () => {
    expect(fieldVisitTasks([task('x', 'KYC_DOCUMENT'), task('y', 'DESK_DOCUMENT')])).toEqual([]);
  });
});
