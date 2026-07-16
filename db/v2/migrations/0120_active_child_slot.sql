-- 0120_active_child_slot.sql — one LIVE lineage child per parent, for BOTH lineage flows (§REVOKE-BILLING).
--
-- The mig-0054 index `uq_case_tasks_active_revisit` guarded "at most one open revisit per parent", but it
-- was scoped `task_origin = 'REVISIT'` and status `PENDING/ASSIGNED/IN_PROGRESS`. Two gaps let one
-- verification bill twice (both reproduced on data, audit §REVOKE-BILLING-2026-07-18):
--   1. A reassign-after-revoke REPLACEMENT keeps the parent's origin (ORIGINAL, mig 0054), so the
--      REVISIT-only predicate never constrained it — the office could dispatch N billable replacements
--      from ONE revoked task (the service pre-check had no guard at all for reassign).
--   2. `SUBMITTED` (mig 0081, the device terminal — 27 migrations AFTER 0054) was never added, so a child
--      sitting at SUBMITTED vacated the slot and a second billable child could be created.
--
-- Fix: widen + rename to `uq_case_tasks_active_child` — any lineage child (origin-agnostic) in a NON-terminal
-- status occupies its parent's slot. Terminal statuses (COMPLETED/REVOKED/CANCELLED) free it, so a legitimate
-- sequential revisit/reassign after the prior child ends is still allowed. This is the DB race-backstop for
-- the service guard `hasActiveChildOf` (cases/repository.ts) — the two express ONE rule; keep them identical.
--
-- Safe on live data: a prod check on 2026-07-18 found 0 parents with >1 live child, so the unique index
-- builds without violation. ADR-0033 is unchanged — a revisit still bills separately BY DESIGN (owner
-- confirmed 2026-07-18); this only stops N-billable-siblings, which neither ADR-0033 nor the owner sanction.

BEGIN;

DROP INDEX IF EXISTS uq_case_tasks_active_revisit;

CREATE UNIQUE INDEX IF NOT EXISTS uq_case_tasks_active_child
  ON case_tasks (parent_task_id)
  WHERE parent_task_id IS NOT NULL
    AND status IN ('PENDING', 'ASSIGNED', 'IN_PROGRESS', 'SUBMITTED');

COMMIT;
