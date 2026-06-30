# ADR-0080: Per-task FIELD_REPORT is snapshotted (frozen) at field submission

- **Status:** Accepted
- **Date:** 2026-06-30
- **Relates to:** ADR-0039 (field-report engine), ADR-0079 (standard-template fallback), ADR-0057 (render-time canonicalization), ADR-0047 (field submission → SUBMITTED), ADR-0041 (CASE_REPORT — separate, stored).
- **Migration:** 0104 (new `field_reports` table). **Owner decision (2026-06-30): freeze at field submission.**

## Context

The per-task FIELD_REPORT narrative is rendered **on-demand** (ADR-0039/0079): the device's `form_data` + the resolved template (custom layout or standard default), computed live on every read. That keeps it always-current and is cheap, but it means there is **no immutable, point-in-time record** of what the report said — edit a template later and a historical task's field report re-renders with the new wording.

v1 stored a per-submission snapshot (`template_reports.report_content`, an explicit generate-and-store). The owner wants that immutability back for the per-task field report, **frozen at field submission** (the agent's original report, before any office review).

## Decision

Add a `field_reports` table and **freeze the narrative when the device submits** the verification form.

- **Write (freeze):** `verification-tasks` `submitForm` — after the form is stored and the task transitions — calls `fieldReportService.snapshot(caseId, taskId, agentId)`: it resolves the template (custom layout → standard default, ADR-0079), renders through the same `canonicalize → renderNarrative` path, and **UPSERTs** one row per task into `field_reports` (a resubmit before completion refreshes it). **Best-effort:** a render/store hiccup is logged and **never fails the submission**.
- **Read (prefer the snapshot):** `fieldReportService.render` returns the **stored snapshot when present** (`snapshotAt` set) — so once submitted, the report is immutable and unaffected by later template edits — else it renders live (current behavior + the ADR-0079 fallback). The raw-fields `sections` view always derives from the stored `form_data`.
- **Schema:** `field_reports (id, case_task_id UNIQUE → case_tasks ON DELETE CASCADE, verification_type, outcome, narrative, layout_id, layout_name, rendered_by, rendered_at)`. `layout_id`/`layout_name` are **denormalised (no FK)** so the snapshot is self-contained even if the `report_layouts` row is later edited or deactivated.
- **SDK:** `FieldReportView` gains `snapshotAt: string | null` (additive, mobile-safe) — non-null ⇒ a frozen snapshot; null ⇒ live render.

## Consequences

- **Immutable per-task record from submission onward.** A completed task's field report is the agent's submitted narrative, verbatim — a later template/default change cannot rewrite it. (Tested: a custom layout authored *after* submission does not change the read.)
- **Lineage is natural.** A revisit/recheck is a NEW task (ADR-0033) → its own submission → its own snapshot; the original task's snapshot persists as its record.
- **No backfill.** Tasks submitted before this feature have no snapshot → they render live (the ADR-0079 fallback, current template). Only new submissions are frozen. Re-freezing an old task would only capture the *current* template (the original-submission template was never stored), so backfill adds nothing.
- **Office completion does not change the field report** — it records a separate official result; the field narrative stays as the agent submitted it.
- Inputs (`form_data`, photos) remain the verbatim source of truth on `case_tasks`/object storage (ADR-0057). The CASE_REPORT (aggregate client PDF/Word, ADR-0041) remains the separately-stored official deliverable.
- No route/permission change; the field-report endpoint stays `case.view`-gated + task-scope-guarded.
