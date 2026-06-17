/**
 * @crm2/sdk — lightweight dropdown option (id/code/name) for the unpaginated `/options` feed.
 *
 * Selectors (case-create, CPV, rate-management) need every USABLE master-data row, not a
 * paginated page. The `/clients|products|verification-units/options` endpoints return this
 * trimmed shape (no version/audit/effective-from), unpaginated, so a dropdown can never
 * silently truncate the way `?active=true&limit=200` did (B-22).
 */
export interface Option {
  id: number;
  code: string;
  name: string;
}
