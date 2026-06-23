import { describe, it, expect } from 'vitest';
import { tabButtonClass } from './Tabs.js';

/**
 * Shared tab-strip helper — single source for the tab-button look duplicated across
 * CaseDetailPage (task buckets) and UserRecordPage (Profile/Access). `tabButtonClass` is the
 * pure class fn (unit-tested without jsdom, mirroring buttonClass / workStatusChipClass).
 */
describe('tabButtonClass', () => {
  it('marks the active tab with the primary underline', () => {
    const c = tabButtonClass(true);
    expect(c).toContain('border-b-2');
    expect(c).toContain('border-primary');
    expect(c).toContain('text-primary');
  });

  it('renders an inactive tab muted, with no underline', () => {
    const c = tabButtonClass(false);
    expect(c).toContain('text-muted-foreground');
    expect(c).not.toContain('border-b-2');
  });
});
