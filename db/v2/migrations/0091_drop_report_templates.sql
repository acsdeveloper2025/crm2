-- 0091_drop_report_templates.sql — retire the Report Templates module (ADR-0063).
-- `report_templates` (mig 0008) was the type-only authoring surface for a render engine that was
-- instead built on `report_layouts` (ADR-0037/0039/0041/0049). It has ZERO downstream readers
-- (`reportTemplates/repository.ts` hasDependents()=false) and no FK references it — the
-- `verification_units.report_template_type` column is a semantic enum, NOT an FK to this table.
--
-- Re-run-safe under the prod every-deploy re-apply model: 0008 (CREATE IF NOT EXISTS) and the
-- 0015/0017 migrations that list `report_templates` in their effective-from / OCC-audit trigger
-- arrays all run BEFORE this file, so the table exists when they touch it and is dropped last.
-- CASCADE drops the OCC-audit trigger (0017) attached to it. Append-only audit_log rows with
-- entity_type='report_templates' are intentionally preserved (history; no FK).
-- Forward-only, idempotent.

DROP TABLE IF EXISTS report_templates CASCADE;
