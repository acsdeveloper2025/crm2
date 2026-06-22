import { describe, it, expect } from 'vitest';
import { workStatusChipClass } from './WorkStatusChip.js';

/**
 * The shared work(task)-status badge — single source for the status→token map currently
 * duplicated across Pipeline/CaseDetail/Dedupe (COLOR_SYSTEM_FREEZE). The 8 frozen status
 * tokens have no "completed", so COMPLETED maps to the approved tone.
 */
describe('workStatusChipClass', () => {
  it('maps COMPLETED to the approved status token (no "completed" token exists)', () => {
    const c = workStatusChipClass('COMPLETED');
    expect(c).toContain('bg-st-approved-bg');
    expect(c).toContain('text-st-approved');
  });

  it('maps each known work status to a frozen st-* token pair', () => {
    expect(workStatusChipClass('PENDING')).toContain('text-st-pending');
    expect(workStatusChipClass('ASSIGNED')).toContain('text-st-assigned');
    expect(workStatusChipClass('IN_PROGRESS')).toContain('text-st-in-progress');
    expect(workStatusChipClass('SUBMITTED')).toContain('text-st-under-review');
    expect(workStatusChipClass('REVOKED')).toContain('text-st-rejected');
    expect(workStatusChipClass('CANCELLED')).toContain('text-st-rejected');
  });

  it('falls back to a neutral surface for an unknown status', () => {
    expect(workStatusChipClass('WHATEVER')).toContain('bg-surface-muted');
  });

  it('carries the shared chip chrome', () => {
    const c = workStatusChipClass('PENDING');
    expect(c).toContain('rounded');
    expect(c).toContain('text-xs');
    expect(c).toContain('font-medium');
  });
});
