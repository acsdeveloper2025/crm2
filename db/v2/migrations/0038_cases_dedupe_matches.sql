-- 0038_cases_dedupe_matches.sql — record WHICH existing cases a CREATE_NEW decision overrode.
-- When the operator creates a case despite duplicates, capture the matched case numbers alongside
-- the rationale so the case detail page can show "created despite duplicates: CASE-000007, …".
-- Forward-only, idempotent.

BEGIN;

ALTER TABLE cases
  ADD COLUMN IF NOT EXISTS dedupe_matched_case_numbers text[] NOT NULL DEFAULT '{}';

COMMIT;
