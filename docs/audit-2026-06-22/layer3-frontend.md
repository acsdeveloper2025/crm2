# Layer-3 Frontend Display Audit — Verification Form Output (2026-06-22)

READ-ONLY audit of the **frontend display layer** for completed FIELD_VISIT tasks: the submitted
form fields, the FIELD_REPORT narrative, and the field photos (image + GPS + reverse-geocoded address).

Scope file: `apps/web/src/features/cases/CaseDetailPage.tsx` (the case-detail UI), with SDK contract
in `packages/sdk/src/cases.ts` and `packages/sdk/src/reportLayouts.ts`.

Backend read-models (already audited — used here as the contract the FE must consume):
- `GET /cases/:id/tasks/:taskId/field-report` → `{ formData, sections[], narrative, verificationType, layoutId, layoutName }`
- `GET /cases/:id/field-photos` → `CaseFieldPhoto[]` each with `geoLocation{latitude,longitude,accuracy,timestamp}` + `reverseGeocodedAddress`
- `GET /cases/:id/field-photos/:photoId/address` → `{ address, cached }` (on-view geocode fallback)

---

## 1. Form-field display (sections / formData)

**Path:** `MobileReportSection` (`CaseDetailPage.tsx:1710`) → `TaskFieldReport` (`:1736`) →
`FieldReportBody` (`:1775`).

- The FE renders the **generic `sections[]`** read-model, NOT raw `formData`. The SDK type
  `FieldReportView` (`packages/sdk/src/reportLayouts.ts:354-365`) **does not even declare `formData`** —
  the backend's full-jsonb field is dropped at the SDK boundary, by design. The FE binds only to
  `sections`, `narrative`, `verificationType`, `layoutName`.
- Every section, and every field within each section, is rendered uniformly:
  - `report.sections.map((section) => …)` (`CaseDetailPage.tsx:1783`)
  - `section.fields.map((f) => <Meta key={f.label} label={f.label} value={f.value} />)` (`:1789-1791`)
- `Meta` (`:2007-2014`) renders `label` (uppercase) over `value` as plain text in a `<div>` — no
  truncation, no clamping, no max-length. So **no fields are dropped on the FE**.
- **No per-type FE gating.** There is zero branching on `verificationType` for *which* fields to
  display. The renderer is type-agnostic: it iterates whatever sections/fields the backend produced.
  `verificationType` is referenced ONLY in the "no template configured for {type}" narrative-empty
  message (`:1803`). All 9 types (RESIDENCE, OFFICE, BUSINESS, RESIDENCE_CUM_OFFICE, DSA_CONNECTOR,
  BUILDER, PROPERTY_INDIVIDUAL, PROPERTY_APF, NOC) flow through the identical loop.
- Empty-state: `hasFields = report.sections.length > 0` (`:1776`); when no fields AND null narrative →
  "No field submission yet for this task." (`:1779-1780`). Otherwise the sections block always renders.

**VERDICT: PASS.** Every captured field renders, via the generic `sections[]` (not `formData`), for all
9 types uniformly, with no truncation or first-section limit. file:line: `CaseDetailPage.tsx:1783-1792`.

Minor note (not a defect): values are server-stringified into `FieldReportField.value`
(`reportLayouts.ts:339-342`), so the FE shows exactly what the backend flattened. If the backend
sections renderer ever skips a nested/non-primitive field, the FE has no second path (no `formData`
fallback) to surface it — but that is a backend (Layer-2) concern, already audited as
"generically flattens EVERY primitive form field."

---

## 2. FIELD_REPORT narrative

**Path:** `FieldReportBody` (`CaseDetailPage.tsx:1795-1806`).

- Heading: "Generated Report" + ` · {layoutName}` when a layout name is present (`:1796-1798`).
- When present: `report.narrative !== null` →
  `<p className="whitespace-pre-wrap text-sm text-foreground">{report.narrative}</p>` (`:1799-1800`).
  - **Plain-text, auto-escaped:** rendered as a JSX text child of `<p>`, so React HTML-escapes it.
    No `dangerouslySetInnerHTML`. `whitespace-pre-wrap` preserves the template's newlines/spacing
    (matches the prose contract). PASS on the output-encoding contract.
- When null (no template configured for the type): graceful fallback —
  "No report template configured for {report.verificationType}." (`:1801-1804`).
- Combined empty-state (no fields AND null narrative) short-circuits to a single
  "No field submission yet for this task." (`:1779-1780`), so a never-submitted task doesn't show an
  empty narrative shell.

**VERDICT: PASS.** Narrative is rendered when present (escaped plain text, newlines preserved) and
null-handled with a clear per-type message. file:line: `CaseDetailPage.tsx:1799-1804`.

---

## 3. Photo lat/long + resolved-address display

**Path:** `FieldPhotosSection` (`:1814`) → `FieldPhotosBody` (`:1833`) → `FieldPhotoThumb` (`:1850`).

For each photo, the thumb renders ALL THREE pieces in the DOM:

- **Image:** presigned URL fetched per-photo via `GET /cases/:id/attachments/:photoId/url`
  (`:1852-1855`), rendered as `<img src={data.url} … className="h-32 w-full object-cover" />`
  (`:1878-1882`), wrapped in an `<a target="_blank">` to open full-size (`:1876`). HexagonLoader
  placeholder until the URL resolves (`:1884-1886`). ✓ IMAGE IN DOM.
- **Latitude / Longitude:** `lat = photo.geoLocation?.latitude`, `lng = …longitude` (`:1856-1857`),
  `hasCoords` guard (`:1858`). Rendered as a Google-Maps link:
  `{lat!.toFixed(6)}, {lng!.toFixed(6)}` plus `(±{accuracy}m)` when accuracy present
  (`:1897-1908`, the coordinate text is at `:1905-1906`). ✓ LAT/LONG IN DOM (6-dp, clickable to
  `https://www.google.com/maps?q=${lat},${lng}` `:1873`).
- **Reverse-geocoded address:** `address = photo.reverseGeocodedAddress ?? addr?.address ?? null`
  (`:1870`). Rendered when non-null as `📍 {address}` in a `line-clamp-2` div with full-text
  `title` tooltip (`:1892-1896`). ✓ ADDRESS IN DOM.
- **Null-address fallback (on-view geocode):** when `!photo.reverseGeocodedAddress && hasCoords`
  the component calls `GET /cases/:id/field-photos/:photoId/address` (`:1860-1869`, `enabled` guard
  `:1867`, `staleTime: Infinity`) and folds the result into `address` (`:1870`). So a pending
  server-side geocode is resolved+frozen on first view. If both the stored address AND the fallback
  return null, the address line simply does not render (`:1892` `address ? … : null`) — graceful, no
  crash, coords still shown. ✓ FALLBACK PRESENT.
- Also shown: `photoType` (`:1890`), `unitName` (`:1891`), capture timestamp (`:1909-1911`).

Adversarial check (the common gap = "coords/address fetched but not rendered"): **both the
coordinate text AND the address text are real JSX children that hit the DOM**, not just fetched into
state. Confirmed at `:1905-1906` (coords) and `:1894` (address). Neither is conditionally hidden
behind a hover/tooltip-only path — the `title` on the address is *additional*, the visible `📍 {address}`
is the primary render.

**VERDICT: PASS.** Image ✓, lat/long ✓, address ✓ — all three actually in the DOM. On-view
null-address fallback call present and wired into the displayed value.

---

## 4. Per-type / state reachability

**Field Report card (`MobileReportSection`, `:1710`, mounted unconditionally at `:211`):**
- Always rendered on the case-detail page for everyone who can view the case (no permission gate on
  the card itself, no role check).
- Iterates **`tasks.map`** over ALL tasks on the case (`:1725`) — NO filter by visit type, status,
  or verification type. Every task gets a `TaskFieldReport` row regardless of being FIELD/OFFICE,
  COMPLETED or not, and regardless of which of the 9 types.
- The per-task report lazy-loads on expand (`enabled: open`, `:1741`). If the task has no submission,
  the body shows the empty-state (§1). So all 9 types AND all states are reachable; a not-yet-submitted
  task just shows "No field submission yet."

**Field Photos card (`FieldPhotosSection`, `:1814`, mounted unconditionally at `:213`):**
- Always rendered; case-scoped (`GET /cases/:id/field-photos`, `:1836`) — returns photos across the
  whole case, not per-task/per-type. No type/state gate on the FE. Empty → "No field photos uploaded."
  (`:1840`).

**No reachability gap found.** Both cards are mounted for the case unconditionally (`:211`, `:213`),
iterate all tasks/photos without type or status filtering, and degrade to empty-states rather than
hiding. There is no "COMPLETED-only" or "FIELD-only" client gate that would block any of the 9 types
or any task state from reaching this UI.

Caveat (data-availability, not a FE gate): a type/state only *shows content* if the device actually
submitted form_data / photos for it — but that is data presence, not a FE display restriction. The FE
itself reaches the UI for all 9 types and all states.

**VERDICT: PASS.**

---

## Summary table

| Area | Verdict | Evidence |
|---|---|---|
| Generic form-field display (sections, all 9 types, no drop) | PASS | `CaseDetailPage.tsx:1783-1792` |
| Renders from `sections` not raw `formData` | PASS (by design; SDK drops formData) | `reportLayouts.ts:354-365`, `CaseDetailPage.tsx:1776` |
| FIELD_REPORT narrative rendered + escaped + newline-preserved | PASS | `CaseDetailPage.tsx:1799-1800` |
| Narrative null-handled (per-type message) | PASS | `CaseDetailPage.tsx:1801-1804` |
| Photo image in DOM | PASS | `CaseDetailPage.tsx:1878-1882` |
| Photo lat/long in DOM | PASS | `CaseDetailPage.tsx:1905-1906` |
| Photo reverse-geocoded address in DOM | PASS | `CaseDetailPage.tsx:1892-1896` |
| Null-address on-view fallback call | PASS | `CaseDetailPage.tsx:1860-1870` |
| Reachable for all 9 types / all states | PASS | `CaseDetailPage.tsx:211,213,1725` |

**Overall: PASS across all four audited areas. No FE display gap found.**
