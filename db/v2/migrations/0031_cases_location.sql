-- 0031_cases_location.sql — verification location on a case (Access & Scope milestone, Epic F).
-- A case's location is what scopes a FIELD_AGENT / KYC_VERIFIER by territory: an agent sees cases in
-- their assigned pincodes/areas even when unassigned. pincode_id is the coarse grain, area_id the
-- finer; both reference a `locations` row (a (pincode, area) pair). NULL = no location captured
-- (such a case is visible only via hierarchy/assignment, not territory). Forward-only, idempotent.

ALTER TABLE cases ADD COLUMN IF NOT EXISTS pincode_id integer REFERENCES locations (id);
ALTER TABLE cases ADD COLUMN IF NOT EXISTS area_id integer REFERENCES locations (id);

CREATE INDEX IF NOT EXISTS idx_cases_pincode ON cases (pincode_id);
