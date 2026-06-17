/**
 * @crm2/sdk — Rate Type lookup (managed dropdown list). Supplies the selectable rate-type
 * options for Rate Management (Local/OGL/Outstation + numbered variants). A rate stores the
 * chosen `code` as a string snapshot. Mirrors migration 0014 `rate_types`.
 */
export interface RateType {
  id: number;
  code: string;
  sortOrder: number;
  isActive: boolean;
  /** when the row becomes usable (ADR-0017); usable ⇔ isActive AND effectiveFrom <= now(). */
  effectiveFrom: string;
}
