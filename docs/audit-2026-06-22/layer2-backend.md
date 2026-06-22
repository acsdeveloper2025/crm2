# Layer 2 — Backend contract + storage audit (verification forms)

**Scope:** the 9 locked FIELD_VISIT verification types → `POST /api/v2/verification-tasks/:id/verification/:formType`, their storage under `case_tasks.form_data`, the web + mobile read-models, and the photo→reverse-geocode chain (ADR-0032/0034/0035/0040).
**Mode:** READ-ONLY. Evidence is the actual SQL / Zod / migration definitions on `origin/main`, not comments.

---

## Submit + storage (verbatim round-trip) — **PASS**

**Entry point.** Route `POST /:id/verification/:formType` → `c.submitForm` → `verificationTaskService.submitForm` (`apps/api/src/modules/verification-tasks/routes.ts:35`, `controller.ts:48-55`, `service.ts:174-185`).

**Slug gate (fail-closed).** `service.ts:175-176` — `if (!(FORM_TYPE_SLUGS as readonly string[]).includes(formType)) throw AppError.badRequest('UNKNOWN_FORM_TYPE')`. `FORM_TYPE_SLUGS` (`service.ts:40-50`) is exactly the 9 locked slugs: `residence, office, business, residence-cum-office, dsa-connector, builder, property-individual, property-apf, noc`. An unknown slug → 400 *before any write* (proven `verification-tasks.api.test.ts:393-397`, `/verification/bogus` → 400).

**Inner-shape validation = fully permissive.** `service.ts:54` — `const FormSubmissionSchema = z.record(z.string(), z.unknown())`. This accepts any JSON object and applies **no per-field schema, no per-type schema, no transform, no field-dropping, no rename**. The body is parsed only to confirm it is an object (`service.ts:177`).

**Size guard.** `service.ts:178-179` — `const json = JSON.stringify(body); if (json.length > MAX_FORM_BYTES) throw AppError.badRequest('FORM_TOO_LARGE')`. `MAX_FORM_BYTES = 262_144` (256 KiB) (`service.ts:55`).

**Store path (verbatim).** `service.ts:181` → `repo.submitVerificationForm(caseId, taskId, actor.userId, formType, json)`.
The write is **`apps/api/src/modules/cases/repository.ts:1413-1418`**:
```sql
UPDATE case_tasks
   SET form_data = jsonb_set(COALESCE(form_data, '{}'::jsonb), ARRAY[$4], $5::jsonb, true), ...
 WHERE id = $1 AND case_id = $2 AND status IN ('ASSIGNED','IN_PROGRESS','SUBMITTED','COMPLETED')
```
`$4 = formType` (the slug, the jsonb path), `$5 = json` (the **stringified body, cast `::jsonb` and stored unchanged**). So the entire submitted object lands verbatim under `form_data[slug]`. No server-side key is read, mutated, or dropped on the way in.

**Proven round-trip.** `verification-tasks.api.test.ts:376-391`: posting `{ formData:{addressConfirmed:true}, verificationOutcome:'POSITIVE' }` to `/verification/residence`, then `SELECT form_data` shows `fd['residence'].formData.addressConfirmed === true` **and** `fd['residence'].verificationOutcome === 'POSITIVE'` — both the keyed fields and the envelope's `verificationOutcome` are stored byte-for-byte in the blob.

**`verificationOutcome` is evidence-only (not the official result).** Even though the device's `verificationOutcome` is stored verbatim in the blob, it never becomes `case_tasks.verification_outcome` — the API returns `verificationOutcome: null` on the task view (`test:382`; D1 single-layer-verdict, ADR-0032).

**Could a field be silently dropped/renamed server-side on ingest?** No. The only key referenced by name in the store path is the slug (the jsonb path), and `jsonb_set` with `create_missing=true` inserts/overwrites that one slug key with the full blob. There is **no allow-list, no `pick`, no field rename** anywhere between the controller and the SQL.

**Idempotency.** A resubmit overwrites `form_data[slug]` (same `jsonb_set`) and re-runs the task transition; returns 200 (`test:398-406`). DESTRUCTIVE NOTE (not a defect, but a property): a resubmit **replaces** the slug object wholesale — it does not deep-merge, so a second submit with fewer keys for the same slug loses the earlier keys for that slug. This matches the locked v1 contract (the device always posts the complete blob).

**One doc-drift (NOT a contract bug).** `service.ts:168-173` + `repository.ts` comments still say "submit==complete → COMPLETED". The actual code calls `repo.submitTaskByDevice` (`service.ts:182`) and the task lands **SUBMITTED** (ADR-0047 two-stage), proven `test:381,417`. Storage behavior is unaffected — flagging the stale comment only.

---

## Web read-model (form_data + photos + address) — **PASS**

The web case-detail does **not** ship `form_data` on the task-view row. `TASK_VIEW_COLS` (`apps/api/src/modules/cases/repository.ts:241-275`) deliberately omits `ct.form_data`. Instead the web reads the submitted form through **two dedicated read-models**, both `case.view`-gated:

### (a) Submitted form fields → `GET /api/v2/cases/:id/tasks/:taskId/field-report`
- Route `cases/routes.ts:61-65` → `fieldReportController.getFieldReport` → `fieldReportService.render`.
- `fieldReports/repository.ts:46-99` `loadContext` selects **`'formData', ct.form_data`** inside a `json_build_object` (`repository.ts:52`) — the **full `form_data` jsonb** is returned to the renderer (camelize only touches top-level columns; nested json keys survive verbatim).
- `fieldReports/service.ts:27` → `buildSections(ctx.formData)` renders **every top-level slug** and **every primitive agent field** (`sections.ts:82-99`).
- **Display-time field-dropping (not storage):** `sections.ts:18-31` `SKIP_KEYS` and `sections.ts:61-69` `toValue` skip envelope/bulky keys (`photos, attachments, geoLocation, metadata, …`) and drop nested objects / arrays-of-objects from the *rendered* sections. Per the in-code audit note (`sections.ts:46-59`, verified against 93 v1 `form_submissions` + 92 `verification_data` blobs) the agent-answer leaves are exclusively primitives / lists-of-primitives, so **this projection only ever drops metadata, never a submitted agent field**. The raw blob remains intact in the DB and is fully available to `loadContext`. Verdict: **PASS** — every renderable agent field is exposed; dropped keys are metadata surfaced elsewhere (Field Photos card). (If a future template ever uses an object/group field, it would not render — tracked as a WONTFIX in code, low-risk given the flat catalog.)

### (b) Field photos w/ lat/long + resolved address → `GET /api/v2/cases/:id/field-photos`
- Route `cases/routes.ts:53` → `c.listFieldPhotos` → `service.ts:475-478` → `repo.listFieldPhotos`.
- SELECT **`apps/api/src/modules/cases/repository.ts:1604-1614`**:
  ```sql
  SELECT ca.id, ca.task_id AS "taskId", vu.name AS "unitName", ca.photo_type AS "photoType",
         ca.original_name AS "originalName", ca.geo_location AS "geoLocation",
         ca.reverse_geocoded_address AS "reverseGeocodedAddress", ca.created_at AS "createdAt"
  FROM case_attachments ca ... WHERE ca.kind = 'FIELD_PHOTO' AND ca.deleted_at IS NULL ...
  ```
- **lat/long: YES** — exposed via `ca.geo_location` (the jsonb `{latitude, longitude, accuracy, timestamp}`); SDK type `CaseFieldPhoto.geoLocation` (`packages/sdk/src/cases.ts:604`).
- **resolved address: YES** — `ca.reverse_geocoded_address AS "reverseGeocodedAddress"` (`repository.ts:1607`); SDK type `CaseFieldPhoto.reverseGeocodedAddress: string | null` (`packages/sdk/src/cases.ts:605-607`). Null → the gallery lazily resolves via `GET /:id/field-photos/:attachmentId/address` (`cases/routes.ts:55-59`, on-view fallback).

| Web concern | Exposed? | file:line |
|---|---|---|
| full `form_data` jsonb | **yes** (via field-report read-model) | `fieldReports/repository.ts:52` |
| field photos | **yes** | `cases/repository.ts:1604`, `cases/routes.ts:53` |
| photo latitude/longitude | **yes** (`geo_location` jsonb) | `cases/repository.ts:1606`, `sdk/cases.ts:604` |
| photo resolved address | **yes** (`reverse_geocoded_address`) | `cases/repository.ts:1607`, `sdk/cases.ts:605-607` |

---

## Mobile sync read-model — **PASS**

Down-sync `GET …/sync` → `syncService.download` → `syncRepository.downloadForUser`.

- **Full `form_data` jsonb:** `SYNC_SELECT` selects **`ct.form_data`** (`apps/api/src/modules/sync/repository.ts:61`), typed `formData: Record<string, unknown> | null` (`repository.ts:39`), mapped onto the task **only when present**: `...(r.formData ? { formData: r.formData } : {})` (`sync/service.ts:39`). The whole blob round-trips back to the device unchanged.
- **`verification_outcome`** is also returned (`repository.ts:61`, `service.ts:38`).
- **Task lat/long:** `ct.latitude, ct.longitude` (the **task's** coordinates, ADR-0074 `0074_case_task_coordinates`) are selected (`repository.ts:62`) and mapped (`service.ts:27-28`). NOTE: these are the *task/case* coordinates, not the *photo* geo — photo geo is not part of the sync task shape (the device owns the photos it captured).
- Field photos themselves are **not** re-listed in the sync task shape; only `attachmentCount` is returned (`repository.ts:71-73`, `service.ts:51`). This is by design (the device captured the photos; sync is task metadata + form blob).

Verdict: the mobile read-model exposes the **full `form_data`** so the device can re-render every submitted field; **PASS**.

---

## Photo → reverse-geocode chain (with migration columns) — **PASS (with documented null-address modes)**

**1. Upload → DB.** `verificationTaskService.uploadAttachments` (`service.ts:193-292`):
- `parseGeo` (`service.ts:84-98`) keeps geo **only when both `latitude` and `longitude` are numbers**, else `null` (a no-GPS `{lat:null,lng:null}` is normalized to null so it doesn't violate the geo CHECK).
- `processFieldPhoto` (`platform/photo.ts:25-44`) EXIF/GPS-strips + auto-orients via `sharp.rotate()` and produces a thumbnail (best-effort). The **stripped image carries no embedded GPS** — the only lat/long persisted is the device-sent `geo_location`.
- Row insert `repo.insertFieldAttachment` (`cases/repository.ts:1505-1553`): `INSERT INTO case_attachments (... kind='FIELD_PHOTO', geo_location $11::jsonb ...)`. **lat/long are stored inside the `geo_location` jsonb, not as separate columns.**

**2. Storage columns (migrations):**
- `db/v2/migrations/0055_field_photo_attachments.sql:28` — `geo_location jsonb` (holds `{latitude, longitude, accuracy, timestamp}`).
- `0065_field_photo_reverse_geocode.sql:15-16` — `reverse_geocoded_address text` (the resolved address).
- `0065:19-29` — CHECK `chk_case_attachments_geo_location_shape`: geo is NULL **or** carries numeric `latitude` + `longitude`.
- `0065:31-50` — **freeze trigger** `trg_case_attachments_freeze_address`: once `reverse_geocoded_address` is non-NULL it is **immutable** (any NULL→addr is allowed once; addr→different or addr→NULL raises — evidence integrity).
- `0065:54-68` — `reverse_geocode_dlq` table (DLQ; one open row per attachment via `uq_reverse_geocode_dlq_open WHERE replayed_at IS NULL`).

**3. Enqueue.** After the row(s) are stored, `service.ts:285-289` — if `geo.latitude`/`geo.longitude` are numbers, for each stored row `void enqueueReverseGeocode({ attachmentId, lat, lng })` (fire-and-forget; never blocks/fails the upload).

**4. Worker / processor.** `enqueueReverseGeocode` (`platform/geocode/queue.ts:83-112`):
- With `REDIS_QUEUE_URL` → BullMQ `add('reverse', …)` `jobId: attach:<id>` (dedup), 3 attempts, exp backoff; consumed by `startReverseGeocodeWorker` (`queue.ts:116-139`).
- Without Redis → runs **in-process after the HTTP response**, single attempt; on failure → DLQ.
- Processor wired at boot `registerJobs.ts:45` → `caseService.reverseGeocodeFieldPhotoJob`; DLQ writer wired `registerJobs.ts:46-48` → `geocodeRepository.insertReverseGeocodeDlq`.

**5. Resolve + write-back.** `caseService.reverseGeocodeFieldPhotoJob` (`cases/service.ts:508-518`):
- Skips if the row is gone or already frozen (`service.ts:509-510`, idempotent).
- `geocodeService.reverse(lat,lng)` → Google `formatted_address` or null (`platform/geocode/index.ts:57-77`).
- On a resolved address → `repo.setFieldPhotoReverseGeocodedAddress` writes **`UPDATE case_attachments SET reverse_geocoded_address = $2 WHERE id=$1 AND kind='FIELD_PHOTO' AND reverse_geocoded_address IS NULL`** (`cases/repository.ts:1729-1734`) → **the column that holds the resolved address is `case_attachments.reverse_geocoded_address`** (freeze-safe: only NULL→addr).
- If unresolved **but a key IS configured** → `throw AppError.internal('GEOCODE_UNRESOLVED')` (`service.ts:516`) → BullMQ retries → DLQ on exhaustion.
- If unresolved **because no key is configured** → silent no-op (`service.ts:517`); the on-view fallback resolves once a key lands.

**6. On-view fallback (Slice A).** `GET /:id/field-photos/:attachmentId/address` → `caseService` (`service.ts:490-501`) resolves + freezes any photo the worker missed (Valkey outage / pre-feature rows). Returns cached if already frozen.

**7. Exposure.** The frozen `reverse_geocoded_address` is exposed by both the list read-model (`cases/repository.ts:1607`) and the on-view endpoint, and is **immutable evidence** (0065 trigger). **PASS.**

**Null-address failure modes (address stays null — all degrade gracefully, never break the page):**
1. No `GOOGLE_GEOCODING_API_KEY` provisioned → disabled geocoder returns null (`geocode/index.ts:16-18,38-41`); worker no-ops; on-view also returns null until a key lands. The UI degrades to raw coords + a Maps link.
2. Photo captured with no GPS (`geo_location` null) → never enqueued (`service.ts:287` guard); address permanently null (no coords to resolve). Expected.
3. Google miss / non-OK / timeout with a key configured → job throws → 3 retries → **DLQ** (`0065` table); attachment stays address-less, admin-replayable; on-view fallback also re-tries.
4. Valkey/Redis down → in-process single attempt (or enqueue-failed fallback `queue.ts:98-109`); a failure dead-letters; on-view fallback recovers later.

---

## Per-type uniformity — **PASS (fully uniform; zero per-type divergence)**

All 9 slugs flow through the **identical** code path:
- One route, one handler: `POST /:id/verification/:formType` → `submitForm` (`routes.ts:35`). `:formType` is data, never branched on by type.
- The slug is validated **only** by set-membership in `FORM_TYPE_SLUGS` (`service.ts:40-50,175`); there is **no per-slug `switch`, no per-type schema, no per-type table**.
- One permissive body schema for all types (`z.record(z.string(), z.unknown())`, `service.ts:54`).
- One store statement for all types — the slug is just the `jsonb_set` path key (`cases/repository.ts:1414`).
- The web renderer iterates slugs generically (`sections.ts:85` `for (const [slug, raw] of Object.entries(formData))`) — no per-type rendering branch.

No slug is missing from `FORM_TYPE_SLUGS`, no slug is special-cased, no slug has a divergent table/column/validation. **Confirmed uniform.**

---

## Summary verdicts

| Concern | Verdict |
|---|---|
| Verbatim jsonb round-trip (no per-type transform/drop/rename) | **PASS** |
| Web read-model exposes full form_data | **PASS** (`fieldReports/repository.ts:52`) |
| Web read-model exposes photos w/ lat/long + resolved address | **PASS** (`cases/repository.ts:1604-1614`) |
| Mobile sync read-model exposes full form_data | **PASS** (`sync/repository.ts:61`, `sync/service.ts:39`) |
| Photo → reverse-geocode chain persists + exposes address | **PASS** (`reverse_geocoded_address`; DLQ + on-view fallback) |
| Per-type backend uniformity | **PASS** (zero divergence) |

**Non-blocking notes:** (1) stale "submit==complete → COMPLETED" doc comments in `verification-tasks/service.ts:168-173` and the cases repo — code is ADR-0047 SUBMITTED, storage unaffected. (2) Resubmit overwrites `form_data[slug]` wholesale (no deep-merge) — matches the locked contract (device posts the full blob). (3) Render-time `SKIP_KEYS`/nested-object drop is display-only; the raw blob is intact in the DB and fully available to the read-model.
