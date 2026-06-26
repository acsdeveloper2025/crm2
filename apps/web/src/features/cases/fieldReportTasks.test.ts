import { describe, it, expect } from 'vitest';
import type { CaseTaskView } from '@crm2/sdk';
import { fieldVisitTasks } from './fieldReportTasks.js';

const task = (id: string, visitType: CaseTaskView['visitType']): CaseTaskView =>
  ({ id, visitType }) as CaseTaskView;

describe('fieldVisitTasks (A2026-0623-17)', () => {
  it('keeps FIELD tasks and drops desk/office (OFFICE) tasks', () => {
    const tasks = [task('a', 'FIELD'), task('b', 'OFFICE'), task('d', 'FIELD')];
    expect(fieldVisitTasks(tasks).map((t) => t.id)).toEqual(['a', 'd']);
  });

  it('a case of only OFFICE tasks yields no field-report rows (card shows its empty state)', () => {
    expect(fieldVisitTasks([task('x', 'OFFICE')])).toEqual([]);
  });
});
