/**
 * Shared billing-amount resolution SQL (ADR-0036). Extracted to platform so the billing read-model
 * AND the Pipeline (tasks) read-model resolve identically — do NOT fork. Module-local copies would
 * drift; the scope predicate is copied per-module by design, but these are pure rate-config SQL.
 *
 * FROM contract (every consumer must supply these aliases):
 *   - `cases cs`        — the case (client_id/product_id/area_id/pincode_id)
 *   - `case_tasks ct`   — the task (verification_unit_id/area_id/pincode_id/assigned_to/completed_at/
 *                          completed_elapsed_minutes)
 * RATE_LATERAL produces alias `rt` (rt.client_rate_type, rt.bill_amount); COMMISSION_LATERAL produces
 * alias `com` (com.commission_amount). The two laterals are independent (commission keys on the
 * field-executive rate type `ct.field_rate_type`, billing on the client rate `rates.client_rate_type`).
 *
 * ⚠ PRECEDENCE DUPLICATION: the rate ladder is also expressed as a correlated subquery in
 * cases/repository.ts `TASK_VIEW_COLS` (resolves the CLIENT `client_rate_type` for the case-detail Rate
 * Type column). Any change to the RATE_LATERAL location-specificity ladder must be mirrored there.
 */

/** Most-specific active rate for the task's CPV (task area > task pincode > case area > case pincode >
 *  location-less default > a non-matching scoped rate), temporal + active. The location rank is a single
 *  CASE (ADR-0048): a plain `(loc = X) DESC NULLS LAST` ladder ranks a non-matching FALSE ABOVE the
 *  location-less NULL, so a task at an unmatched location would wrongly bill a different-location override
 *  instead of the default (COMPLIANCE §G-8). LIMIT 1 → 1:1 (COUNT/SUM stay exact). */
export const RATE_LATERAL = `LEFT JOIN LATERAL (
    SELECT r.client_rate_type, r.amount::float8 AS bill_amount
    FROM rates r
    WHERE r.client_id = cs.client_id AND r.product_id = cs.product_id
      AND r.verification_unit_id = ct.verification_unit_id AND r.is_active
      AND r.effective_from <= now() AND (r.effective_to IS NULL OR r.effective_to > now())
    ORDER BY (CASE
               WHEN r.location_id = ct.area_id    THEN 5
               WHEN r.location_id = ct.pincode_id THEN 4
               WHEN r.location_id = cs.area_id    THEN 3
               WHEN r.location_id = cs.pincode_id THEN 2
               WHEN r.location_id IS NULL         THEN 1
               ELSE 0 END) DESC,
             r.location_id, r.id DESC
    LIMIT 1) rt ON true`;

/** The assignee's commission tariff line (ADR-0050, supersedes ADR-0046). REQUIRED-specific dims:
 *  user, rate_type (= the task's `field_rate_type`, LOCAL/OGL — re-coupled as a key), and location
 *  (`location_id IN (task.area, task.pincode, case.area, case.pincode)` — NO location-less default).
 *  UNIVERSAL-able dims (NULL ⇒ matches any): client, product, verification unit, tat_band — each is
 *  `(col IS NULL OR col = task.col)`. The MOST-SPECIFIC matching row wins, priority Client > Product >
 *  Unit > TAT band (DESC NULLS LAST = a specific value outranks Universal at each level), then location
 *  granularity (task.area > task.pincode > case.area > case.pincode). A task whose rate_type/location
 *  match no active row (e.g. no distance band set at assign) earns NOTHING — no fallback, by design.
 *  Point-in-time as-of COALESCE(ct.submitted_at, ct.completed_at, now()) — ADR-0047 freezes commission at
 *  SUBMIT (office-only tasks with no submit fall back to completed_at), so editing rates/tat_policies later
 *  never rewrites a frozen commission. The band is the SUBMIT-in band, derived from
 *  COALESCE(submitted_elapsed_minutes, completed_elapsed_minutes) vs tat_policies as-of the same anchor.
 *  LIMIT 1 → 1:1 (COUNT/SUM exact). */
export const COMMISSION_LATERAL = `LEFT JOIN LATERAL (
    SELECT cmr.amount::float8 AS commission_amount
    FROM commission_rates cmr
    WHERE cmr.user_id = ct.assigned_to AND cmr.is_active
      AND (cmr.client_id IS NULL OR cmr.client_id = cs.client_id)
      AND (cmr.product_id IS NULL OR cmr.product_id = cs.product_id)
      AND (cmr.verification_unit_id IS NULL OR cmr.verification_unit_id = ct.verification_unit_id)
      AND cmr.field_rate_type = ct.field_rate_type
      AND (cmr.tat_band IS NULL OR cmr.tat_band = (
            COALESCE(
              (SELECT tp.tat_hours FROM tat_policies tp
                 WHERE tp.is_active
                   AND tp.effective_from <= COALESCE(ct.submitted_at, ct.completed_at, now())
                   AND (tp.effective_to IS NULL OR tp.effective_to > COALESCE(ct.submitted_at, ct.completed_at, now()))
                   AND tp.tat_hours >= CEIL(COALESCE(ct.submitted_elapsed_minutes, ct.completed_elapsed_minutes) / 60.0)
                 ORDER BY tp.tat_hours ASC LIMIT 1),
              CASE WHEN COALESCE(ct.submitted_elapsed_minutes, ct.completed_elapsed_minutes) IS NULL THEN NULL ELSE -1 END)))
      AND (cmr.location_id IN (ct.area_id, ct.pincode_id, cs.area_id, cs.pincode_id)
           OR (ct.field_rate_type = 'OFFICE' AND cmr.location_id IS NULL))
      AND cmr.effective_from <= COALESCE(ct.submitted_at, ct.completed_at, now())
      AND (cmr.effective_to IS NULL OR cmr.effective_to > COALESCE(ct.submitted_at, ct.completed_at, now()))
    ORDER BY cmr.client_id            DESC NULLS LAST,
             cmr.product_id           DESC NULLS LAST,
             cmr.verification_unit_id DESC NULLS LAST,
             cmr.tat_band             DESC NULLS LAST,
             (CASE
               WHEN cmr.location_id = ct.area_id    THEN 4
               WHEN cmr.location_id = ct.pincode_id THEN 3
               WHEN cmr.location_id = cs.area_id    THEN 2
               WHEN cmr.location_id = cs.pincode_id THEN 1
               ELSE 0 END) DESC,
             cmr.id DESC
    LIMIT 1) com ON true`;
