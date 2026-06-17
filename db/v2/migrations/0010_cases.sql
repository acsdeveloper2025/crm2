-- 0010_cases.sql — Cases + Applicants + Case Tasks (operations core). Frozen model:
-- Case → Task → Verification Unit (ADR-0002). Mirrors Zion NewDataEntry: a case is created
-- for a client+product against an applicant + co-applicants, with a search-first dedupe gate
-- (dedupe matches across ALL applicants); each selected CPV-enabled unit becomes a task.
-- Forward-only, idempotent.

CREATE SEQUENCE IF NOT EXISTS case_number_seq START 1;

CREATE TABLE IF NOT EXISTS cases (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_number varchar(20) NOT NULL,
  client_id   integer NOT NULL REFERENCES clients(id),
  product_id  integer NOT NULL REFERENCES products(id),
  status      varchar(20) NOT NULL DEFAULT 'NEW',
  -- Mandatory dedupe gate (Zion/v1): the operator must search before creating and record
  -- the outcome. dedupe_checked is always true (create is blocked otherwise).
  dedupe_checked   boolean NOT NULL DEFAULT true,
  dedupe_decision  varchar(30) NOT NULL,
  dedupe_rationale text,
  created_by  uuid,
  updated_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_cases_number UNIQUE (case_number),
  CONSTRAINT chk_cases_status CHECK (status IN ('NEW', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED')),
  CONSTRAINT chk_cases_dedupe CHECK (dedupe_decision IN ('NO_DUPLICATES_FOUND', 'CREATE_NEW'))
);

CREATE INDEX IF NOT EXISTS idx_cases_client ON cases (client_id);
CREATE INDEX IF NOT EXISTS idx_cases_status ON cases (status);

-- Applicants on a case: one primary (APPLICANT) + N co-applicants (CO_APPLICANT). The
-- dedupe gate searches across every applicant row. Identity columns are the source of truth.
CREATE TABLE IF NOT EXISTS case_applicants (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id        uuid NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  name           varchar(200) NOT NULL,
  mobile         varchar(20),
  pan            varchar(20),
  applicant_type varchar(20) NOT NULL DEFAULT 'APPLICANT',
  is_primary     boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_applicant_type CHECK (applicant_type IN ('APPLICANT', 'CO_APPLICANT'))
);

-- Exactly one primary applicant per case.
CREATE UNIQUE INDEX IF NOT EXISTS uq_case_one_primary ON case_applicants (case_id) WHERE is_primary;
CREATE INDEX IF NOT EXISTS idx_applicants_case ON case_applicants (case_id);
CREATE INDEX IF NOT EXISTS idx_applicants_name ON case_applicants (lower(name));
CREATE INDEX IF NOT EXISTS idx_applicants_mobile ON case_applicants (mobile);
CREATE INDEX IF NOT EXISTS idx_applicants_pan ON case_applicants (upper(pan));

-- A task = one verification unit instance on a case (Zion "document"). A case may carry
-- the same unit more than once (Zion "NO OF" count), so no unique (case, unit) constraint.
CREATE TABLE IF NOT EXISTS case_tasks (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id              uuid NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  verification_unit_id integer NOT NULL REFERENCES verification_units(id),
  status               varchar(20) NOT NULL DEFAULT 'PENDING',
  assigned_to          uuid REFERENCES users(id),
  created_by           uuid,
  updated_by           uuid,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_case_task_status CHECK (
    status IN ('PENDING', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED')
  )
);

CREATE INDEX IF NOT EXISTS idx_case_tasks_case ON case_tasks (case_id);
CREATE INDEX IF NOT EXISTS idx_case_tasks_assigned ON case_tasks (assigned_to);
CREATE INDEX IF NOT EXISTS idx_case_tasks_status ON case_tasks (status);
