/**
 * @crm2/sdk — the ONE pagination contract for every list endpoint (web + mobile).
 * SoT: docs/PAGINATION_AND_LOADING_STANDARDS.md §1/§4. Request sends `page/limit/
 * search/sortBy/sortOrder/filters`; the response is the fixed `Paginated<T>` envelope.
 */
export const PAGE_SIZES = [25, 50, 100, 200] as const;
export const DEFAULT_PAGE_SIZE = 25;
/** Extended max (MIS/reporting only). Above this is forbidden — the server 400s. */
export const MAX_PAGE_SIZE = 500;

export type SortOrder = 'asc' | 'desc';

/** Request shape sent to a list endpoint. `filters` are domain-specific (server-whitelisted). */
export interface PageQuery {
  page?: number;
  limit?: number;
  search?: string;
  sortBy?: string;
  sortOrder?: SortOrder;
  filters?: Record<string, string | boolean | number | undefined>;
}

/** The single response envelope every list endpoint returns. */
export interface Paginated<T> {
  items: T[];
  /** total rows matching search+filters, before pagination. */
  totalCount: number;
  page: number;
  /** = the request `limit`, echoed. */
  pageSize: number;
  totalPages: number;
  sort: { sortBy: string; sortOrder: SortOrder };
  filters: Record<string, unknown>;
}

/** Serialize a PageQuery to URL params (used by the SDK list methods + URL-state). */
export function pageQueryToParams(q: PageQuery): URLSearchParams {
  const p = new URLSearchParams();
  if (q.page !== undefined) p.set('page', String(q.page));
  if (q.limit !== undefined) p.set('limit', String(q.limit));
  if (q.search) p.set('search', q.search);
  if (q.sortBy) p.set('sortBy', q.sortBy);
  if (q.sortOrder) p.set('sortOrder', q.sortOrder);
  for (const [k, v] of Object.entries(q.filters ?? {})) {
    if (v !== undefined && v !== '') p.set(k, String(v));
  }
  return p;
}
