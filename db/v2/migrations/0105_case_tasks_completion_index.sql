-- 0105_case_tasks_completion_index.sql — index the completion-date hot path (PERFORMANCE-04,
-- docs/audit/15-performance.md).
--
-- completed_at (0041) and submitted_at (0081) were added with no supporting index despite being the
-- filter/sort key for MIS (`ORDER BY ct.completed_at DESC`) and the range-filter anchor for Billing +
-- the Commission Summary read model (ADR-0081, `COALESCE(submitted_at, completed_at)`). A plain
-- composite index covers the raw-column predicates directly (MIS's ORDER BY, and any future filter on
-- either column); it does NOT cover the Commission Summary's `... AT TIME ZONE 'Asia/Kolkata'`-wrapped
-- range predicate specifically — `timestamptz AT TIME ZONE text` is STABLE, not IMMUTABLE, so Postgres
-- refuses an expression index on it. Making that specific query index-friendly would mean shifting the
-- bound parameters instead of the column (a query-shape change to a just-shipped ADR-0081 feature) —
-- out of scope for a straight index addition; tracked as a follow-up if Commission Summary query plans
-- show it's needed at scale.
BEGIN;

CREATE INDEX IF NOT EXISTS idx_case_tasks_completion_dates ON case_tasks (completed_at, submitted_at);

COMMIT;
