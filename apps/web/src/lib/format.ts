/**
 * Display formatters (web). Single source so every management/admin list renders
 * timestamps identically — see docs/MANAGEMENT_LIST_STANDARD.md (Created date+time
 * column is mandatory in every management section).
 */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const pad = (n: number): string => String(n).padStart(2, '0');

/** ISO timestamp → `DD Mon YYYY, HH:MM` (local time, 24h). Empty string for missing/invalid. */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${pad(d.getDate())} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** ISO timestamp → `YYYY-MM-DD` (local) for an `<input type="date">` value. Empty when missing. */
export function toDateInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** `<input type="date">` value (`YYYY-MM-DD`) → full ISO at local midnight; undefined when blank. */
export function toIsoDate(value: string): string | undefined {
  if (!value) return undefined;
  const d = new Date(`${value}T00:00:00`);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toISOString();
}
