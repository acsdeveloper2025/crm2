-- 0074 — per-task dispatch coordinates (latitude/longitude) for the task's address.
--
-- v1 parity: v1 carried cases.latitude/longitude on the CASE (alongside cases.address). v2 moved the
-- dispatch address onto the TASK (case_tasks.address), so the coordinates live on the task too, next
-- to the address they pin. Optional — populated from the case feed / create API when known; null
-- otherwise (exactly as v1, which had no geocode-on-create). Emitted to the field app in
-- GET /sync/download so the device can show a map pin / compute distance. ADR-0011 additive.

ALTER TABLE case_tasks ADD COLUMN IF NOT EXISTS latitude numeric(10, 8);
ALTER TABLE case_tasks ADD COLUMN IF NOT EXISTS longitude numeric(11, 8);
