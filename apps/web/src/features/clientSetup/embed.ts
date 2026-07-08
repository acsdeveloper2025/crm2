/**
 * The ONE controlled-prop contract every page embedded in the Client Setup hub shares (ADR-0092 §3.2).
 * A page accepts an optional `clientId`: absent → the page behaves exactly as it does standalone;
 * present → the hub's client wins and the page's own client picker is replaced by a read-only display.
 */
export interface EmbeddedPageProps {
  clientId?: string;
}

/**
 * Merges the controlled `clientId` into a grid's `filters`. Controlled wins over an existing
 * `filters.clientId`; when uncontrolled, `filters.clientId` passes through unchanged (including
 * `undefined`, so a page embedded without a client behaves identically to standalone — `undefined`
 * filter values are skipped by `pageQueryToParams`).
 */
export function withClientFilter(
  filters: Record<string, string | undefined>,
  controlledClientId?: string,
): Record<string, string | undefined> {
  return { ...filters, clientId: controlledClientId || filters['clientId'] || undefined };
}
