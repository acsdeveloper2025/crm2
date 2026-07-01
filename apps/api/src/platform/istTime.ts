/**
 * IST (India Standard Time, UTC+05:30, no DST) day-boundary helpers (CODE_QUALITY-02,
 * docs/audit/17-code-quality.md) — the same offset constant and "today's IST midnight" formula was
 * duplicated verbatim across dashboard/service.ts, field-monitoring/service.ts, and
 * location/service.ts. All three consoles need to agree on what "today" means (India-based operation).
 */
export const IST_OFFSET_MS = 19_800_000;

/** Today's IST midnight, expressed as a UTC epoch-ms instant — the day boundary every "today" window uses. */
export function istMidnightUtcMs(now: number): number {
  const ist = new Date(now + IST_OFFSET_MS);
  return Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()) - IST_OFFSET_MS;
}

/** The IST hour-of-day (0-23) for a given ISO timestamp — e.g. shift-window gating. */
export function istHour(iso: string): number {
  return new Date(Date.parse(iso) + IST_OFFSET_MS).getUTCHours();
}
