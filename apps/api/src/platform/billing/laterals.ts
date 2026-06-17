/**
 * Shared billing-amount resolution SQL (ADR-0036). Extracted to platform so the billing read-model
 * AND the Pipeline (tasks) read-model resolve identically — do NOT fork. Module-local copies would
 * drift; the scope predicate is copied per-module by design, but these are pure rate-config SQL.
 *
 * FROM contract (every consumer must supply these aliases):
 *   - `cases cs`        — the case (client_id/product_id/area_id/pincode_id)
 *   - `case_tasks ct`   — the task (verification_unit_id/area_id/pincode_id/assigned_to)
 * RATE_LATERAL produces alias `rt` (rt.rate_type, rt.bill_amount). COMMISSION_LATERAL references
 * `rt.rate_type` so it MUST be placed AFTER the rate lateral; it produces alias `com`
 * (com.commission_amount).
 *
 * ⚠ PRECEDENCE DUPLICATION: the rate ladder is also expressed as a correlated subquery in
 * cases/repository.ts `TASK_VIEW_COLS` (resolves `rate_type` only, for the case-detail Rate Type
 * column). Any change to the location-specificity ladder here must be mirrored there.
 */

/** Most-specific active rate for the task's CPV (task area > task pincode > case area > case pincode >
 *  location-less default > any), temporal + active. LIMIT 1 → 1:1 (COUNT/SUM stay exact). */
export const RATE_LATERAL = `LEFT JOIN LATERAL (
    SELECT r.rate_type, r.amount::float8 AS bill_amount
    FROM rates r
    WHERE r.client_id = cs.client_id AND r.product_id = cs.product_id
      AND r.verification_unit_id = ct.verification_unit_id AND r.is_active
      AND r.effective_from <= now() AND (r.effective_to IS NULL OR r.effective_to > now())
    ORDER BY (r.location_id = ct.area_id) DESC NULLS LAST,
             (r.location_id = ct.pincode_id) DESC NULLS LAST,
             (r.location_id = cs.area_id) DESC NULLS LAST,
             (r.location_id = cs.pincode_id) DESC NULLS LAST,
             (r.location_id IS NULL) DESC, r.location_id
    LIMIT 1) rt ON true`;

/** The assignee's commission for the RESOLVED rate type (most-specific-client-wins + active + now()).
 *  References `rt.rate_type` → must follow RATE_LATERAL. */
export const COMMISSION_LATERAL = `LEFT JOIN LATERAL (
    SELECT cmr.amount::float8 AS commission_amount
    FROM commission_rates cmr
    WHERE cmr.user_id = ct.assigned_to AND cmr.rate_type = rt.rate_type AND cmr.is_active
      AND (cmr.client_id IS NULL OR cmr.client_id = cs.client_id)
      AND cmr.effective_from <= now() AND (cmr.effective_to IS NULL OR cmr.effective_to > now())
    ORDER BY cmr.client_id DESC NULLS LAST
    LIMIT 1) com ON true`;
