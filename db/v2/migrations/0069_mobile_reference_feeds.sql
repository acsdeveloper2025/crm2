-- 0069_mobile_reference_feeds.sql — server-driven reference masters the field app refreshes each
-- sync cycle (mobile parity): per-verification-type field OUTCOMES + REVOKE REASONS. v2 had neither
-- endpoint; the field outcome vocabulary (Positive/Shifted/NSP/Entry Restricted/Untraceable/…) is a
-- richer, per-type set than the 4-value OFFICE verdict carried by `verification_units.result_set`
-- (POSITIVE/NEGATIVE/REFER/FRAUD) — so it is its own lookup, NOT derived from result_set.
-- Data ported verbatim from the v1 masters, re-keyed from v1 type codes (RV/OV/…) to the v2 unit
-- codes the sync DTO emits (`verificationTypeDetails.code`). Integer ids match the mobile's numeric
-- `id` contract. Static lookup data is seeded inline (idempotent) so the test template carries it.
-- Forward-only, idempotent. Triple-write: file → test:5433 (auto) → dev:54329 (psql -f).

BEGIN;

-- Field revoke reasons (TaskRevokeModal dropdown). code is the wire value; label is the UI text.
CREATE TABLE IF NOT EXISTS revoke_reasons (
  id         integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code       text NOT NULL UNIQUE,
  label      text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO revoke_reasons (code, label, sort_order) VALUES
  ('NOT_MY_AREA',              'Not my area',            10),
  ('WRONG_PINCODE',            'Wrong pincode',          20),
  ('ADDRESS_NOT_WORKING',      'Address not working',    30),
  ('NOT_WORKING',              'Not working',            40),
  ('CUSTOMER_LEFT_AREA',       'Customer left area',     50),
  ('LEFT_AREA',                'Left area',              60),
  ('WRONG_ADDRESS',            'Wrong address',          70),
  ('WRONG_INCOMPLETE_ADDRESS', 'Wrong/incomplete address', 80),
  ('OTHER',                    'Other (specify below)',  90)
ON CONFLICT (code) DO NOTHING;

-- Per-type field outcomes. verification_type_code = the v2 unit code the device matches a task on;
-- verification_type_id mirrors the v1 numeric id (the mobile's ordering/shape contract). Denormalized
-- (no FK to verification_units) so seeding is independent of the units seed order.
CREATE TABLE IF NOT EXISTS verification_unit_outcomes (
  id                     integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  verification_type_id   integer NOT NULL,
  verification_type_code text NOT NULL,
  outcome_code           text NOT NULL,
  display_label          text NOT NULL,
  sort_order             integer NOT NULL DEFAULT 0,
  is_active              boolean NOT NULL DEFAULT true,
  created_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_verification_unit_outcomes UNIQUE (verification_type_code, outcome_code)
);
CREATE INDEX IF NOT EXISTS idx_verification_unit_outcomes_type
  ON verification_unit_outcomes (verification_type_code, sort_order);

-- The 7 standard field types share the 5-outcome set (Positive/Shifted/NSP/Entry Restricted/Untraceable).
INSERT INTO verification_unit_outcomes
  (verification_type_id, verification_type_code, outcome_code, display_label, sort_order)
SELECT t.id, t.code, o.outcome_code, o.display_label, o.sort_order
FROM (VALUES
  (1, 'RESIDENCE'), (2, 'OFFICE'), (3, 'RESIDENCE_CUM_OFFICE'), (4, 'BUSINESS'),
  (5, 'BUILDER'), (6, 'NOC'), (7, 'DSA_CONNECTOR')
) AS t(id, code)
CROSS JOIN (VALUES
  ('POSITIVE',         'Positive',        1),
  ('SHIFTED',          'Shifted',         2),
  ('NSP',              'No Such Person',  3),
  ('ENTRY_RESTRICTED', 'Entry Restricted', 4),
  ('UNTRACEABLE',      'Untraceable',     5)
) AS o(outcome_code, display_label, sort_order)
ON CONFLICT (verification_type_code, outcome_code) DO NOTHING;

-- Property APF: NEGATIVE in place of Shifted/NSP.
INSERT INTO verification_unit_outcomes
  (verification_type_id, verification_type_code, outcome_code, display_label, sort_order)
VALUES
  (8, 'PROPERTY_APF', 'POSITIVE',         'Positive',         1),
  (8, 'PROPERTY_APF', 'NEGATIVE',         'Negative',         2),
  (8, 'PROPERTY_APF', 'ENTRY_RESTRICTED', 'Entry Restricted', 3),
  (8, 'PROPERTY_APF', 'UNTRACEABLE',      'Untraceable',      4)
ON CONFLICT (verification_type_code, outcome_code) DO NOTHING;

-- Property Individual: no Shifted.
INSERT INTO verification_unit_outcomes
  (verification_type_id, verification_type_code, outcome_code, display_label, sort_order)
VALUES
  (9, 'PROPERTY_INDIVIDUAL', 'POSITIVE',         'Positive',         1),
  (9, 'PROPERTY_INDIVIDUAL', 'NSP',              'No Such Person',   2),
  (9, 'PROPERTY_INDIVIDUAL', 'ENTRY_RESTRICTED', 'Entry Restricted', 3),
  (9, 'PROPERTY_INDIVIDUAL', 'UNTRACEABLE',      'Untraceable',      4)
ON CONFLICT (verification_type_code, outcome_code) DO NOTHING;

COMMIT;
