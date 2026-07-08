/** Pure URL-state helpers for the Client Setup hub (ADR-0092). The URL is the only state store. */

export const HUB_PATH = '/admin/client-setup';

export interface StepDef {
  id: number;
  key: 'cpv' | 'rateTypes' | 'rates' | 'commission';
  label: string;
}

export const STEP_DEFS: StepDef[] = [
  { id: 1, key: 'cpv', label: 'Products & CPV units' },
  { id: 2, key: 'rateTypes', label: 'Rate types' },
  { id: 3, key: 'rates', label: 'Rates' },
  { id: 4, key: 'commission', label: 'Commission rates' },
];

/** Parses the `?step=` search param to an in-range step id; anything else (missing, NaN, out of 1-4) → 1. */
export function parseStep(raw: string | null): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= STEP_DEFS.length ? n : 1;
}

/** Builds a hub deep-link back to a given client + step — the `returnTo` target for embedded record pages. */
export function hubReturnTo(clientId: string, step: number): string {
  return `${HUB_PATH}?clientId=${encodeURIComponent(clientId)}&step=${step}`;
}

/**
 * Open-redirect guard (CWE-601): only the hub's own path (bare or with a query string) is honoured —
 * rejects protocol-relative (`//evil.com`) and absolute (`https://evil.com/...`) URLs, sibling paths
 * sharing the prefix (`/admin/client-setup-evil`), and any other in-app path.
 */
export function safeReturnTo(raw: string | null): string | null {
  return raw !== null && (raw === HUB_PATH || raw.startsWith(`${HUB_PATH}?`)) ? raw : null;
}

/** The nav target for a record page's hard exits: the hub if `returnTo` is a safe hub deep-link, else `fallback`. */
export function exitPath(raw: string | null, fallback: string): string {
  return safeReturnTo(raw) ?? fallback;
}
