-- 0087_case_applicant_dedupe.sql — per-applicant dedupe verdict (ADR-0053).
-- A case's original applicants are deduped atomically at creation and the decision is recorded on the
-- `cases` row. An applicant ADDED after creation (POST /cases/:id/applicants) carries its OWN dedupe
-- verdict on its row: dedupe_decision NULL => a creation-time applicant (covered by the case-level
-- record); non-NULL => added post-creation. Additive, idempotent, re-run-safe (no DROP/ADD on an
-- existing constraint, so it cannot become a migrate-rerun deploy blocker like the 0037/0083 traps).
BEGIN;

ALTER TABLE case_applicants
  ADD COLUMN IF NOT EXISTS dedupe_decision varchar(30),
  ADD COLUMN IF NOT EXISTS dedupe_rationale text,
  ADD COLUMN IF NOT EXISTS dedupe_matched_case_numbers text[] NOT NULL DEFAULT '{}';

-- CHECK added via a guarded ADD CONSTRAINT (PG has no IF NOT EXISTS for CHECK) so re-run is a no-op.
-- All pre-existing rows have dedupe_decision = NULL (new column) => they satisfy the NULL branch; the
-- constraint can never reject live data on re-validation.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_case_applicant_dedupe_decision') THEN
    ALTER TABLE case_applicants
      ADD CONSTRAINT chk_case_applicant_dedupe_decision
      CHECK (dedupe_decision IS NULL OR dedupe_decision IN ('NO_DUPLICATES_FOUND', 'CREATE_NEW'));
  END IF;
END$$;

COMMIT;
