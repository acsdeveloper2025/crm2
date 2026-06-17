-- CRM2 — Build Step 1: Verification Unit Registry
-- Migration 0001 · forward-only · idempotent
-- Frozen model: Case → Task → Verification Unit. This migration creates ONLY the
-- registry (the master catalog + outcomes + CPV enablement). Tasks/results/billing
-- tables come in later build steps (Case/Task creation).
--
-- Pre-DDL decisions baked in (per FINAL_PRE_BUILD_CHALLENGE):
--   (1) subtype payload → separate typed extension tables (NOT jsonb on tasks) — applied in later steps
--   (2) form schema    → referenced by code (verification_units.required_form_code), config-JSON + code fallback
--   (3) PII/DPDP       → pii_sensitive flag on the unit from day 1 (drives masking/encryption downstream)

BEGIN;

-- ---------------------------------------------------------------------------
-- verification_units : the unified catalog (9 field ∪ 59 KYC ∪ future)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS verification_units (
    id                   integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code                 varchar(64)  NOT NULL UNIQUE,                 -- UPPER_SNAKE, stable key (immutable)
    name                 varchar(255) NOT NULL,
    description          text,                                         -- admin/UI helptext
    version              integer      NOT NULL DEFAULT 1,              -- bumped on policy edit; tasks snapshot (unit_id, version) for report/billing integrity
    category             varchar(32)  NOT NULL,                        -- FIELD/IDENTITY/FINANCIAL/BUSINESS/ADDRESS/PROPERTY/LEGAL/VERIFICATION/MEDICAL/OTHER
    kind                 varchar(16)  NOT NULL
        CHECK (kind IN ('FIELD_VISIT','KYC_DOCUMENT','DESK_DOCUMENT')),
    worker_role          varchar(32)  NOT NULL
        CHECK (worker_role IN ('FIELD_AGENT','KYC_VERIFIER')),
    assignment_method    varchar(20)  NOT NULL DEFAULT 'MANUAL'
        CHECK (assignment_method IN ('TERRITORY_AUTO','MANUAL','DESK_POOL')),
    required_form_code   varchar(64),                                  -- ref to a form schema (NULL for doc-only units)
    required_photos      integer      NOT NULL DEFAULT 0 CHECK (required_photos >= 0),
    required_gps         boolean      NOT NULL DEFAULT false,
    required_attachments jsonb        NOT NULL DEFAULT '[]'::jsonb,    -- e.g. [{"type":"DOCUMENT","min":1}]
    result_set           varchar(20)[] NOT NULL DEFAULT ARRAY['Positive','Negative','Refer','Fraud'],
    review_required      boolean      NOT NULL DEFAULT true,
    billing_profile      varchar(20)  NOT NULL
        CHECK (billing_profile IN ('AGENT_COMMISSION','CLIENT_INVOICE')),
    commission_profile   varchar(20)  NOT NULL DEFAULT 'NONE'
        CHECK (commission_profile IN ('FIELD_RATE','NONE')),
    report_template_type varchar(24)  NOT NULL
        CHECK (report_template_type IN ('FIELD_NARRATIVE','KYC_DOCUMENT')),
    reverification_rule  varchar(24)  NOT NULL
        CHECK (reverification_rule IN ('REVISIT_PARENT_RATE','RECHECK_FRESH_RATE')),
    pii_sensitive        boolean      NOT NULL DEFAULT false,          -- DPDP: drives masking/field-encryption downstream
    is_active            boolean      NOT NULL DEFAULT true,
    sort_order           integer      NOT NULL DEFAULT 0,
    created_by           uuid,                                         -- config audit (who created)
    updated_by           uuid,                                         -- config audit (who last edited)
    created_at           timestamptz  NOT NULL DEFAULT now(),
    updated_at           timestamptz  NOT NULL DEFAULT now(),

    -- Cross-field invariants (the registry enforces its own coherence — see §validation)
    CONSTRAINT chk_vu_field_visit CHECK (
        kind <> 'FIELD_VISIT' OR (
            worker_role = 'FIELD_AGENT' AND required_photos >= 5 AND required_gps = true
            AND required_form_code IS NOT NULL AND billing_profile = 'AGENT_COMMISSION'
            AND report_template_type = 'FIELD_NARRATIVE' AND reverification_rule = 'REVISIT_PARENT_RATE'
        )
    ),
    CONSTRAINT chk_vu_kyc_document CHECK (
        kind <> 'KYC_DOCUMENT' OR (
            worker_role = 'KYC_VERIFIER' AND required_photos = 0 AND required_gps = false
            AND billing_profile = 'CLIENT_INVOICE' AND commission_profile = 'NONE'
            AND report_template_type = 'KYC_DOCUMENT' AND reverification_rule = 'RECHECK_FRESH_RATE'
        )
    ),
    CONSTRAINT chk_vu_result_set_nonempty CHECK (array_length(result_set, 1) >= 1)
);

CREATE INDEX IF NOT EXISTS idx_verification_units_kind     ON verification_units (kind) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_verification_units_category ON verification_units (category) WHERE is_active;

-- ---------------------------------------------------------------------------
-- client_product_verification_units : CPV enablement (which units per client+product)
-- Replaces v1 client_product_verifications keyed on verification_type → keyed on the unit.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS client_product_verification_units (
    id                   integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    client_product_id    integer NOT NULL,                            -- FK → client_products (added when that table lands)
    verification_unit_id integer NOT NULL REFERENCES verification_units(id),
    is_active            boolean NOT NULL DEFAULT true,
    created_at           timestamptz NOT NULL DEFAULT now(),
    updated_at           timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_cpvu UNIQUE (client_product_id, verification_unit_id)
);

CREATE INDEX IF NOT EXISTS idx_cpvu_client_product ON client_product_verification_units (client_product_id) WHERE is_active;

COMMIT;
