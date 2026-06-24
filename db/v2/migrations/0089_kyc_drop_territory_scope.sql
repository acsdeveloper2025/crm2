-- 0089_kyc_drop_territory_scope.sql — KYC verifiers are scoped by assignment, not territory (ADR-0061).
-- A KYC_VERIFIER verifies DOCUMENTS at a desk; KYC tasks are dispatched through the OFFICE pool, which is
-- territory-less (ADR-0024). Wiring the role to PINCODE/AREA (mig 0034) therefore never matched the job
-- and leaked case PII by geography — a KYC verifier could see every case in an assigned pincode/area,
-- including cases assigned to other operators (A2026-0623-04, KYC half). Remove the two EXPAND rows so KYC
-- falls back to assignment/hierarchy (SELF) visibility — it sees only the cases it is assigned (or
-- created). resolveScope intersects a user's assignments with the role's ACTIVE wiring, so any existing
-- KYC pincode/area assignment becomes inert automatically (no user_scope_assignments cleanup needed); the
-- scope-assignment API also rejects new ones (DIMENSION_NOT_ALLOWED_FOR_ROLE). FIELD_AGENT keeps
-- PINCODE/AREA — address verification is territorial by design (mig 0031). Forward-only, idempotent.
BEGIN;

DELETE FROM role_scope_dimensions
WHERE role_code = 'KYC_VERIFIER' AND dimension_code IN ('PINCODE', 'AREA');

COMMIT;
