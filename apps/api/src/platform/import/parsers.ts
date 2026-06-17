/**
 * Reusable `ImportColumn.parse` cell coercers (B-14). A spreadsheet cell arrives as a string, number,
 * boolean, or Date; these map it to the shape the domain's zod Create-schema expects. Each returns
 * `undefined` for a blank cell (so an optional field falls back to its default / null) and leaves an
 * un-coercible value as-is so the schema produces a clear per-row error rather than silently dropping.
 */

/** Date/ISO: blank → undefined; Date → ISO; a date-ish string → ISO; otherwise as-is (schema flags it). */
export const parseIsoDate = (raw: unknown): unknown => {
  if (raw === undefined || raw === null) return undefined;
  if (raw instanceof Date) return raw.toISOString();
  const s = String(raw).trim();
  if (s === '') return undefined;
  const t = Date.parse(s);
  return Number.isNaN(t) ? s : new Date(t).toISOString();
};

/** Boolean: blank → undefined (→ schema default); true/1/yes/y → true; false/0/no/n → false; else as-is. */
export const parseBoolean = (raw: unknown): unknown => {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw === 'boolean') return raw;
  const s = String(raw).trim().toLowerCase();
  if (s === '') return undefined;
  if (['true', '1', 'yes', 'y'].includes(s)) return true;
  if (['false', '0', 'no', 'n'].includes(s)) return false;
  return raw; // schema flags the bad value
};

/** Integer: blank → undefined; a whole number → number; otherwise as-is (schema flags it). */
export const parseInteger = (raw: unknown): unknown => {
  if (raw === undefined || raw === null) return undefined;
  const s = String(raw).trim();
  if (s === '') return undefined;
  const n = Number(s);
  return Number.isInteger(n) ? n : raw;
};

/** Number: blank → undefined; a finite number → number; otherwise as-is (schema flags it). */
export const parseNumber = (raw: unknown): unknown => {
  if (raw === undefined || raw === null) return undefined;
  const s = String(raw).trim();
  if (s === '') return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : raw;
};

/** Comma-separated list → trimmed string[]; blank → undefined. */
export const parseCsvList = (raw: unknown): unknown => {
  if (raw === undefined || raw === null) return undefined;
  const s = String(raw).trim();
  if (s === '') return undefined;
  return s
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
};
