import { effectiveStatus } from '../lib/effectiveStatus.js';

/** Three-state master-data status chip (ADR-0017): ACTIVE / SCHEDULED / INACTIVE. */
const STYLES: Record<string, string> = {
  ACTIVE: 'bg-st-approved-bg text-st-approved',
  SCHEDULED: 'bg-st-pending-bg text-st-pending',
  INACTIVE: 'bg-muted text-muted-foreground',
};

export function StatusChip({ isActive, effectiveFrom }: { isActive: boolean; effectiveFrom: string }) {
  const status = effectiveStatus({ isActive, effectiveFrom });
  return <span className={`rounded px-2 py-0.5 text-xs font-medium ${STYLES[status]}`}>{status}</span>;
}
