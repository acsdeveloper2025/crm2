# Layer 1 Audit — Mobile Capture Layer (CRM2 verification forms)

**Date:** 2026-06-22 · **Scope:** READ-ONLY audit of the React Native field-agent app
**Repo audited (separate, untouched):** `/Users/mayurkulkarni/Downloads/CRM-APP-MONOREPO-PROD/crm-mobile-native`
**Question answered:** For each of the 9 locked FIELD_VISIT verification types — what exact keyed field set does the app capture, what envelope does it POST, and do captured photos carry lat/long?

---

## 0. How forms are built, keyed, and the key contract

- **Field catalog source of truth:** `src/screens/forms/LegacyFormTemplateBuilders.ts` (7,760 lines). Templates are **bundled in the app**, not server-driven. `FormTemplateService.loadTemplate()` tries the bundled legacy template FIRST (`getLegacyTemplate`); only if absent does it fall back to a cached/`GET /forms/:type/template` template — and per ADR-0054 the v2 backend always returns `null` for that endpoint, so **the bundled legacy builders are what runs in production.** (`src/services/forms/FormTemplateService.ts:491-576`)
- **The submitted formData KEY is `field.name`** (falls back to `field.id` only when `name` is empty/blank). This is the canonical mapping: `DynamicFormBuilder.tsx:214-215` (`const valueKey = field.name && field.name.trim() !== '' ? field.name : field.id;`). Every key in this report is the exact `name:` string from the source.
- **Slug → canonical map:** `src/utils/formTypeKey.ts:24-34`. residence→RESIDENCE, residence-cum-office→RESIDENCE_CUM_OFFICE, office→OFFICE, business→BUSINESS, builder→BUILDER, noc→NOC, dsa-connector→DSA_CONNECTOR, property-individual→PROPERTY_INDIVIDUAL, property-apf→PROPERTY_APF.
- **Per-type/per-outcome structure:** each `buildLegacy<Type>Template(verificationType, outcome)` reads `legacy<Type>FieldsByOutcome[normalizedOutcome]` — an object keyed by the 5 outcomes **POSITIVE, SHIFTED, NSP, ENTRY_RESTRICTED, UNTRACEABLE** (APF has only POSITIVE/ENTRY_RESTRICTED/UNTRACEABLE; property-individual has POSITIVE/NSP/ENTRY_RESTRICTED/UNTRACEABLE). Each value is a field array. (`LegacyFormTemplateBuilders.ts:7728-7760` dispatch; builders at 1415/2352/3210/4078/4867/5607/6438/6998/7629.)
- **Globally injected field — `callConfirmation`:** after build, `injectCallConfirmationField()` inserts a `select` named **`callConfirmation`** immediately after EVERY `callRemark` field, in all 9 types × all outcomes that carry Call Remark. Gated `conditional`/`requiredWhen` on `callRemark === 'Pickup call & confirm'`. Options: Address is Shifted, Loan Cancel, Already Verification Done, Hold for Verification, Requested to Visit Another Address, Request to Visit Another Day, Currently Not Available. (`LegacyFormTemplateBuilders.ts:7698-7726`)
- **Outcome is NOT a form field.** No field is named `outcome`/`verificationOutcome`. The chosen outcome is a separate top-level envelope field (`verificationOutcome`). Any backend field literally named `outcome` is explicitly filtered out before render (`FormTemplateService.ts:401, 525`). The agent's verdict is captured in the in-form **`finalStatus`** select (options vary by outcome). APF POSITIVE uniquely emits a SECOND verdict key **`finalStatusNegative`** (see §7).
- **Verified field-key universe:** 107 distinct `name:` strings exist across the whole file (grep-confirmed). All are camelCase. **There is no snake_case key anywhere in the capture layer.** Down-stream CRM report templates that reference snake_case keys (`customer_name`, `tpc_name_1`, `door_color`, `address_structure`, …) DO NOT match the keys the app emits — the app emits `doorColor`, `addressStructure`, `tpcName1`, etc. (camelCase). This is the single biggest cross-layer risk and is flagged in §11.

`required` legend in tables: `true` = always required · `cond` = conditional via `requiredWhen` (gating noted) · `false` = optional.

---

## 1. RESIDENCE (slug `residence`)

Builder `buildLegacyResidenceTemplate` (`:1415`); map `legacyResidenceFieldsByOutcome` (`:~1404`). Outcomes: POSITIVE, SHIFTED, NSP, ENTRY_RESTRICTED, UNTRACEABLE.

**Verdict field:** `finalStatus` (select; POSITIVE allows Positive/Negative/Refer/Fraud; SHIFTED/UNTRACEABLE = Negative/Refer/Fraud; NSP = Negative/Fraud). No `outcome` field.

**POSITIVE core fields (representative):** addressLocatable, addressRating, houseStatus, callRemark(+callConfirmation), metPersonName, metPersonRelation, totalFamilyMembers, totalEarningMember, workingStatus, companyName, stayingPeriodValue, stayingPeriodUnit, stayingStatus, approxArea, documentShown, documentType, tpcMetPerson1/tpcName1/tpcConfirmation1, tpcMetPerson2/tpcName2/tpcConfirmation2, locality, addressStructure, addressFloor, addressStructureColor, doorColor, doorNamePlateStatus, nameOnDoorPlate, societyNamePlateStatus, nameOnSocietyBoard, landmark1, landmark2, politicalConnection, dominatedArea, feedbackFromNeighbour, otherObservation, finalStatus.
**SHIFTED adds:** shiftedPeriodValue, shiftedPeriodUnit, metPersonStatus, premisesStatus. **NSP adds:** stayingPersonName. **ENTRY_RESTRICTED adds:** metPersonType, metPersonConfirmation, applicantStayingStatus (drops houseStatus; callRemark required). **UNTRACEABLE:** contactPerson, callRemark, locality, landmark1-4, dominatedArea, otherObservation, finalStatus.

Conditional gating: callRemark visible/required when houseStatus='Closed'; metPerson/family/document fields gated on houseStatus='Open'; tpcName/tpcConfirmation gated on their tpcMetPerson being set; nameOnDoorPlate/nameOnSocietyBoard gated on the matching `*NamePlateStatus='SIGHTED'`.

**RESIDENCE union keys (49):**
`addressLocatable, addressRating, houseStatus, callRemark, callConfirmation, metPersonName, metPersonRelation, totalFamilyMembers, totalEarningMember, workingStatus, companyName, stayingPeriodValue, stayingPeriodUnit, stayingStatus, approxArea, documentShown, documentType, tpcMetPerson1, tpcName1, tpcConfirmation1, tpcMetPerson2, tpcName2, tpcConfirmation2, locality, addressStructure, addressFloor, addressStructureColor, doorColor, doorNamePlateStatus, nameOnDoorPlate, societyNamePlateStatus, nameOnSocietyBoard, landmark1, landmark2, landmark3, landmark4, politicalConnection, dominatedArea, feedbackFromNeighbour, otherObservation, finalStatus, shiftedPeriodValue, shiftedPeriodUnit, metPersonStatus, premisesStatus, stayingPersonName, metPersonType, metPersonConfirmation, applicantStayingStatus, contactPerson`

---

## 2. RESIDENCE_CUM_OFFICE (slug `residence-cum-office`)

Builder `:2352`; map `legacyResiCumOfficeFieldsByOutcome` (`:~2341`). Outcomes: POSITIVE, SHIFTED, NSP, ENTRY_RESTRICTED, UNTRACEABLE.

**Verdict field:** `finalStatus` (POSITIVE = Positive/Refer; SHIFTED/NSP/UNTRACEABLE = Negative/Refer/Fraud; ERT = Positive/Negative/Refer/Fraud).

POSITIVE captures both residence and business facets: addressLocatable, addressRating, resiCumOfficeStatus, callRemark(+callConfirmation), metPersonName, **relation** (note: NOT `metPersonRelation`), residenceSetup, businessSetup, stayingPeriodValue/Unit, stayingStatus, companyNatureOfBusiness, businessPeriodValue/Unit, businessStatus, businessLocation, businessOperatingAddress, tpc 1/2 triplets, approxArea, documentShown, documentType, locality, addressStructure, addressFloor, addressStructureColor, doorColor, doorNamePlateStatus, nameOnDoorPlate, societyNamePlateStatus, nameOnSocietyBoard, companyNamePlateStatus, nameOnBoard, landmark1/2, politicalConnection, dominatedArea, feedbackFromNeighbour, otherObservation, finalStatus.
SHIFTED adds shiftedPeriodValue/Unit, metPersonStatus. NSP adds addressTraceable, stayingPersonName. ERT adds metPersonType, metPersonConfirmation, applicantWorkingStatus, applicantStayingStatus, businessExistsStatus. UNTRACEABLE: contactPerson + landmark1-4 set.

**RESIDENCE_CUM_OFFICE union keys (58):**
`addressLocatable, addressRating, resiCumOfficeStatus, callRemark, callConfirmation, metPersonName, relation, residenceSetup, businessSetup, stayingPeriodValue, stayingPeriodUnit, stayingStatus, companyNatureOfBusiness, businessPeriodValue, businessPeriodUnit, businessStatus, businessLocation, businessOperatingAddress, tpcMetPerson1, tpcName1, tpcConfirmation1, tpcMetPerson2, tpcName2, tpcConfirmation2, approxArea, documentShown, documentType, locality, addressStructure, addressFloor, addressStructureColor, doorColor, doorNamePlateStatus, nameOnDoorPlate, societyNamePlateStatus, nameOnSocietyBoard, companyNamePlateStatus, nameOnBoard, landmark1, landmark2, landmark3, landmark4, politicalConnection, dominatedArea, feedbackFromNeighbour, otherObservation, finalStatus, addressTraceable, shiftedPeriodValue, shiftedPeriodUnit, metPersonStatus, stayingPersonName, metPersonType, metPersonConfirmation, applicantWorkingStatus, applicantStayingStatus, businessExistsStatus, contactPerson`

---

## 3. OFFICE (slug `office`)

Builder `:3210`; map `legacyOfficeFieldsByOutcome` (`:~3199`). Outcomes: POSITIVE, SHIFTED, NSP, ENTRY_RESTRICTED, UNTRACEABLE.

**Verdict field:** `finalStatus` (POSITIVE = Positive/Refer; others = Negative/Refer/Fraud).

POSITIVE: addressLocatable, addressRating, officeStatus, callRemark(+callConfirmation), metPersonName, metPersonDesignation, workingPeriodValue/Unit, applicantDesignation, workingStatus, applicantWorkingPremises, sittingLocation, officeType, companyNatureOfBusiness, staffStrength, staffSeen, officeApproxArea, companyNamePlateStatus, nameOnBoard, documentShown, tpc 1/2 triplets, establishmentPeriodValue/Unit, locality, addressStructure, addressFloor, addressStructureColor, doorColor, landmark1/2, politicalConnection, dominatedArea, feedbackFromNeighbour, otherObservation, finalStatus.
SHIFTED adds currentCompanyName, currentCompanyPeriodValue/Unit, oldOfficeShiftedPeriodValue/Unit. NSP adds officeExistence, currentCompanyName. ERT adds metPersonType, metPersonConfirmation, applicantWorkingStatus, officeExistsStatus. UNTRACEABLE: contactPerson + landmark1-4.

**OFFICE union keys (54):**
`addressLocatable, addressRating, officeStatus, callRemark, callConfirmation, metPersonName, metPersonDesignation, workingPeriodValue, workingPeriodUnit, applicantDesignation, workingStatus, applicantWorkingPremises, sittingLocation, officeType, companyNatureOfBusiness, staffStrength, staffSeen, officeApproxArea, companyNamePlateStatus, nameOnBoard, documentShown, tpcMetPerson1, tpcName1, tpcConfirmation1, tpcMetPerson2, tpcName2, tpcConfirmation2, establishmentPeriodValue, establishmentPeriodUnit, locality, addressStructure, addressFloor, addressStructureColor, doorColor, landmark1, landmark2, landmark3, landmark4, politicalConnection, dominatedArea, feedbackFromNeighbour, otherObservation, finalStatus, currentCompanyName, currentCompanyPeriodValue, currentCompanyPeriodUnit, oldOfficeShiftedPeriodValue, oldOfficeShiftedPeriodUnit, officeExistence, officeExistsStatus, metPersonType, metPersonConfirmation, applicantWorkingStatus, contactPerson`

---

## 4. BUSINESS (slug `business`)

Builder `:4078`; map `legacyBusinessFieldsByOutcome` (`:~4067`). Outcomes: POSITIVE, SHIFTED, NSP, ENTRY_RESTRICTED, UNTRACEABLE.

**Verdict field:** `finalStatus` (POSITIVE/SHIFTED/NSP/ERT = Positive/Negative/Refer/Fraud; UNTRACEABLE = Negative/Refer/Fraud).

POSITIVE: addressLocatable, addressRating, businessStatus, callRemark(+callConfirmation), metPersonName, metPersonDesignation, businessType, nameOfCompanyOwners, ownershipType, addressStatus, companyNatureOfBusiness, businessPeriodValue/Unit, officeApproxArea, staffStrength, staffSeen, companyNamePlateStatus, nameOnBoard, documentShown, tpc 1/2 triplets, locality, addressStructure, addressFloor, addressStructureColor, doorColor, landmark1/2, politicalConnection, dominatedArea, feedbackFromNeighbour, otherObservation, finalStatus.
SHIFTED adds premisesStatus, currentCompanyName, currentCompanyPeriodValue/Unit, oldOfficeShiftedPeriodValue/Unit. NSP adds businessExistance. ERT adds metPersonType, metPersonConfirmation, applicantWorkingStatus, businessExistsStatus. UNTRACEABLE: contactPerson + landmark1-4.

Conditional gating keys on `businessStatus` (Open shows met-person/business block, Closed shows callRemark).

**BUSINESS union keys (52):**
`addressLocatable, addressRating, businessStatus, callRemark, callConfirmation, metPersonName, metPersonDesignation, businessType, nameOfCompanyOwners, ownershipType, addressStatus, companyNatureOfBusiness, businessPeriodValue, businessPeriodUnit, officeApproxArea, staffStrength, staffSeen, companyNamePlateStatus, nameOnBoard, documentShown, tpcMetPerson1, tpcName1, tpcConfirmation1, tpcMetPerson2, tpcName2, tpcConfirmation2, locality, addressStructure, addressFloor, addressStructureColor, doorColor, landmark1, landmark2, landmark3, landmark4, politicalConnection, dominatedArea, feedbackFromNeighbour, otherObservation, finalStatus, premisesStatus, currentCompanyName, currentCompanyPeriodValue, currentCompanyPeriodUnit, oldOfficeShiftedPeriodValue, oldOfficeShiftedPeriodUnit, businessExistance, metPersonType, metPersonConfirmation, applicantWorkingStatus, businessExistsStatus, contactPerson`

> Note the misspelled key **`businessExistance`** (NSP existence flag) vs the distinct ERT key **`businessExistsStatus`** — both ship as-is.

---

## 5. BUILDER (slug `builder`)

Builder `:4867`; map `legacyBuilderFieldsByOutcome` (`:~4856`). Outcomes: POSITIVE, SHIFTED, NSP, ENTRY_RESTRICTED, UNTRACEABLE.

**Structurally near-identical to BUSINESS** but the status field is named **`officeStatus`** (not `businessStatus`), and POSITIVE/SHIFTED/NSP gate on `officeStatus`. Verdict field `finalStatus` (POSITIVE = Positive/Negative/Refer/Fraud; etc.).

**BUILDER union keys (52):**
`addressLocatable, addressRating, officeStatus, callRemark, callConfirmation, metPersonName, metPersonDesignation, businessType, nameOfCompanyOwners, ownershipType, addressStatus, companyNatureOfBusiness, businessPeriodValue, businessPeriodUnit, officeApproxArea, staffStrength, staffSeen, companyNamePlateStatus, nameOnBoard, documentShown, tpcMetPerson1, tpcName1, tpcConfirmation1, tpcMetPerson2, tpcName2, tpcConfirmation2, locality, addressStructure, addressFloor, addressStructureColor, doorColor, landmark1, landmark2, landmark3, landmark4, politicalConnection, dominatedArea, feedbackFromNeighbour, otherObservation, finalStatus, premisesStatus, currentCompanyName, currentCompanyPeriodValue, currentCompanyPeriodUnit, oldOfficeShiftedPeriodValue, oldOfficeShiftedPeriodUnit, businessExistance, metPersonType, metPersonConfirmation, applicantWorkingStatus, businessExistsStatus, contactPerson`

---

## 6. NOC (slug `noc`)

Builder `:5607`; map `legacyNocFieldsByOutcome` (`:~5598`). Outcomes: POSITIVE, SHIFTED, NSP, ENTRY_RESTRICTED, UNTRACEABLE.

**Verdict field:** `finalStatus` (POSITIVE = Positive/Refer; SHIFTED/UNTRACEABLE = Negative/Refer/Fraud; NSP/ERT = Positive/Negative/Refer/Fraud).

POSITIVE is NOC-specific: addressLocatable, addressRating, officeStatus, callRemark(+callConfirmation), metPersonName, metPersonDesignation, **authorisedSignature**, **nameOnNoc**, **flatNo**, locality, addressStructure, addressFloor, addressStructureColor, landmark1/2, politicalConnection, dominatedArea, feedbackFromNeighbour, otherObservation, finalStatus.
SHIFTED adds currentCompanyName, currentCompanyPeriodValue/Unit, oldOfficeShiftedPeriodValue/Unit, companyNamePlateStatus, nameOnBoard, tpc triplets, doorColor. NSP adds businessExistance, premisesStatus, currentCompanyName, companyNamePlateStatus, nameOnBoard, tpc triplets, doorColor. ERT adds metPersonType, metPersonConfirmation, officeExistsStatus. UNTRACEABLE: contactPerson + landmark1-4.

**NOC union keys (42):**
`addressLocatable, addressRating, officeStatus, callRemark, callConfirmation, metPersonName, metPersonDesignation, authorisedSignature, nameOnNoc, flatNo, locality, addressStructure, addressFloor, addressStructureColor, doorColor, landmark1, landmark2, landmark3, landmark4, politicalConnection, dominatedArea, feedbackFromNeighbour, otherObservation, finalStatus, companyNamePlateStatus, nameOnBoard, currentCompanyName, currentCompanyPeriodValue, currentCompanyPeriodUnit, oldOfficeShiftedPeriodValue, oldOfficeShiftedPeriodUnit, tpcMetPerson1, tpcName1, tpcConfirmation1, tpcMetPerson2, tpcName2, tpcConfirmation2, businessExistance, premisesStatus, metPersonType, metPersonConfirmation, officeExistsStatus, contactPerson`

---

## 7. PROPERTY_APF (slug `property-apf`)

Builder `:6998`; map `legacyPropertyApfFieldsByOutcome` (`:~6989`). **Outcomes: POSITIVE, ENTRY_RESTRICTED, UNTRACEABLE** (NO SHIFTED, NO NSP).

**Verdict handling — UNIQUE:** POSITIVE branches the verdict on `constructionActivity` (options SEEN / CONSTRUCTION IS STOP / PLOT IS VACANT) and emits **TWO** verdict keys, only one visible at a time (`:6793` and the block at `:~6840`):
- `finalStatus` — visible/required when `constructionActivity === 'SEEN'`.
- `finalStatusNegative` — visible/required when `constructionActivity !== 'SEEN'`.
Both offer Positive/Negative/Refer/Fraud. ENTRY_RESTRICTED & UNTRACEABLE use plain `finalStatus`. **Downstream consumers must read BOTH `finalStatus` and `finalStatusNegative` for APF.**

POSITIVE: addressLocatable, addressRating, constructionActivity, metPersonName, metPersonDesignation, buildingStatus, activityStopReason, projectName, projectStartedDate(date), projectCompletionDate(date), totalWing(number), totalFlats(number), projectCompletionPercent(number), staffStrength, staffSeen, tpc 1/2 triplets, locality, companyNamePlateStatus, nameOnBoard, landmark1/2, politicalConnection, dominatedArea, feedbackFromNeighbour, otherObservation, finalStatus, finalStatusNegative.
ERT adds callRemark(+callConfirmation), metPersonType, metPersonConfirmation, buildingStatus. UNTRACEABLE: contactPerson + landmark1-4.

> **Label/key swap quirk (source bug, ships as-is):** in APF, key `tpcMetPerson1` carries label "Third Party Confirmation 1" and key `tpcName1` carries label "TPC Met Person 1" — labels are crossed vs the other 8 types. The KEYS are still `tpcMetPerson1`/`tpcName1`/`tpcConfirmation1`, so data lands under the standard keys; only the on-screen labels are swapped. (`LegacyFormTemplateBuilders.ts:~6648-6700`)

**PROPERTY_APF union keys (38):**
`addressLocatable, addressRating, constructionActivity, metPersonName, metPersonDesignation, buildingStatus, activityStopReason, projectName, projectStartedDate, projectCompletionDate, totalWing, totalFlats, projectCompletionPercent, staffStrength, staffSeen, tpcMetPerson1, tpcName1, tpcConfirmation1, tpcMetPerson2, tpcName2, tpcConfirmation2, locality, companyNamePlateStatus, nameOnBoard, landmark1, landmark2, landmark3, landmark4, politicalConnection, dominatedArea, feedbackFromNeighbour, otherObservation, finalStatus, finalStatusNegative, callRemark, callConfirmation, metPersonType, metPersonConfirmation, contactPerson`

---

## 8. PROPERTY_INDIVIDUAL (slug `property-individual`)

Builder `:7629` (short — reuses its own `legacyPropertyIndividualFieldsByOutcome` at `:~7619`, distinct from APF). **Outcomes: POSITIVE, NSP, ENTRY_RESTRICTED, UNTRACEABLE** (NO SHIFTED).

**Verdict field:** `finalStatus` (POSITIVE = Positive/Refer; NSP/ERT/UNTRACEABLE = Negative/Refer/Fraud).

POSITIVE: addressLocatable, addressRating, buildingStatus, flatStatus, callRemark(+callConfirmation), metPersonName, **relationship** (note: NOT `relation` nor `metPersonRelation`), propertyOwnerName, approxArea, tpc 1/2 triplets (all required here), locality, addressStructure, addressFloor, addressStructureColor, doorColor, doorNamePlateStatus, nameOnDoorPlate, societyNamePlateStatus, nameOnSocietyBoard, landmark1/2, politicalConnection, dominatedArea, feedbackFromNeighbour, otherObservation, finalStatus.
NSP ≈ POSITIVE (flatStatus-gated). ERT adds metPersonType, metPersonConfirmation. UNTRACEABLE: contactPerson + landmark1-4.

**PROPERTY_INDIVIDUAL union keys (36):**
`addressLocatable, addressRating, buildingStatus, flatStatus, callRemark, callConfirmation, metPersonName, relationship, propertyOwnerName, approxArea, tpcMetPerson1, tpcName1, tpcConfirmation1, tpcMetPerson2, tpcName2, tpcConfirmation2, locality, addressStructure, addressFloor, addressStructureColor, doorColor, doorNamePlateStatus, nameOnDoorPlate, societyNamePlateStatus, nameOnSocietyBoard, landmark1, landmark2, landmark3, landmark4, politicalConnection, dominatedArea, feedbackFromNeighbour, otherObservation, finalStatus, metPersonType, metPersonConfirmation, contactPerson`

---

## 9. DSA_CONNECTOR (slug `dsa-connector`)

Builder `:6438`; map `legacyDsaFieldsByOutcome` (`:~6429`). Outcomes: POSITIVE, SHIFTED, NSP, ENTRY_RESTRICTED, UNTRACEABLE.

**Structurally near-identical to BUILDER** (status field `officeStatus`) but POSITIVE adds a DSA-only key **`activeClient`** (text, required). Verdict `finalStatus` (POSITIVE/NSP/ERT = Positive/Negative/Refer/Fraud; SHIFTED/UNTRACEABLE = Negative/Refer/Fraud).

**DSA_CONNECTOR union keys (52):**
`addressLocatable, addressRating, officeStatus, callRemark, callConfirmation, metPersonName, metPersonDesignation, businessType, nameOfCompanyOwners, ownershipType, addressStatus, companyNatureOfBusiness, businessPeriodValue, businessPeriodUnit, officeApproxArea, staffStrength, staffSeen, activeClient, companyNamePlateStatus, nameOnBoard, tpcMetPerson1, tpcName1, tpcConfirmation1, tpcMetPerson2, tpcName2, tpcConfirmation2, locality, addressStructure, addressFloor, addressStructureColor, doorColor, landmark1, landmark2, landmark3, landmark4, politicalConnection, dominatedArea, feedbackFromNeighbour, otherObservation, finalStatus, premisesStatus, currentCompanyName, currentCompanyPeriodValue, currentCompanyPeriodUnit, oldOfficeShiftedPeriodValue, oldOfficeShiftedPeriodUnit, businessExistance, businessExistsStatus, contactPerson`

---

## 10. Photo lat/long capture

**Status: PASS for all 9 types — geo is mandatory and structurally enforced.** Photo capture is type-agnostic (one camera pipeline for every verification type).

- **Capture pipeline:** `src/services/CameraService.ts`, `savePhoto()` (`:172-425`). GPS is acquired either from `options.locationOverride` (the WatermarkPreview caller acquires GPS up-front) or via `LocationService.getCurrentLocation()` capped at `GPS_SAVE_TIMEOUT_MS = 2000ms` (`:32, :251-269`).
- **GPS is MANDATORY — no GPS-less attachment can be persisted.** If neither override nor live fetch yields a numeric lat/long, the just-moved file + thumbnail are unlinked and the save throws `GPS_REQUIRED` (`:271-288`). The `CapturedPhoto` object carries `latitude`, `longitude`, `accuracy`, `timestamp` (`CapturedPhoto` interface `:79-91`; populated `:310-322`).
- **Where geo is stored on the photo:** persisted to the **`attachments` table** columns `latitude REAL`, `longitude REAL`, `accuracy REAL`, `location_timestamp TEXT` (schema `src/database/schema.ts:83-86`). Written via `AttachmentRepository.create({ latitude, longitude, accuracy, locationTimestamp, clientSha256, ... })` (`CameraService.ts:340-356`; repo binds `src/repositories/AttachmentRepository.ts:45-48`).
- **Geo also rides the attachment sync payload:** `SyncGateway.enqueueAttachment(...) { geoLocation: { latitude, longitude, accuracy, altitude, speed, heading, timestamp } }` (`CameraService.ts:378-388`).
- **Submission-time enforcement:** `SubmitVerificationUseCase.execute()` rejects submission unless ≥5 verification photos + ≥1 selfie AND **every** photo has geo — `toAttachmentGeoLocation()` returns null if lat/long missing and the map throws "All photos must include geo-location data before submission." (`SubmitVerificationUseCase.ts:57-69, 113-145`).
- **Watermark note:** photos are stored RAW (no on-device watermark composite as of 2026-05-31); the CRM web overlays address + GPS from the stored coords at view time. EXIF is stripped before upload; the lat/long lives in the DB/sync payload, NOT in EXIF (`CameraService.ts:224-238, 493-552`).

Per-photo fields captured: `latitude`, `longitude`, `accuracy`, `locationTimestamp` (+ `clientSha256` integrity hash, `size`, `componentType` photo|selfie). Altitude/speed/heading are carried in the sync `geoLocation` only (not all columns).

---

## 11. Envelope shape (what the app POSTs)

**Endpoint:** `POST /verification-tasks/:taskId/verification/<slug>` where `<slug>` ∈ {residence, office, business, residence-cum-office, dsa-connector, builder, property-individual, property-apf, noc} (`src/api/endpoints.ts:47-66`; dispatched per form type in `FormUploader.ts:288-302` and `SubmitVerificationUseCase.ts:26-36`).

**Body (built in `SubmitVerificationUseCase.ts:186-220`):**
```jsonc
{
  "submissionId":   "<uuid>",
  "localTaskId":    "<device task uuid>",
  "taskId":         "<backend task uuid>",
  "visitId":        "<backend task uuid>",   // == taskId
  "caseId":         "<case id string>",
  "verificationTaskId": "<backend task uuid>",
  "formType":       "RESIDENCE|OFFICE|...",  // canonical (toBackendFormType)
  "formData":       { /* the exact camelCase fieldKeys from §1-§9 */ },
  "attachmentIds":  ["<attachment uuid>", ...],
  "geoLocation":    { "latitude", "longitude", "accuracy", "timestamp" },  // from latest geo-photo
  "photos": [ { "attachmentId", "type":"verification|selfie",
                "geoLocation": {lat,long,accuracy,timestamp},
                "metadata": {fileSize, capturedAt} }, ... ],
  "metadata": { "submissionTimestamp", "deviceInfo":{platform,model,osVersion,appVersion},
                "networkInfo":{type}, "formVersion":"1.0", "validationStatus":"VALID",
                "submissionAttempts", "isOfflineSubmission":true,
                "totalImages", "totalSelfies", "verificationDate", "formType" },
  "verificationOutcome": "POSITIVE|SHIFTED|NSP|ENTRY_RESTRICTED|UNTRACEABLE" | undefined
}
```
- This **matches the expected `{ formData, verificationOutcome, photos?, attachmentIds?, geoLocation?, metadata? }`** shape, plus extra routing fields (submissionId/localTaskId/taskId/visitId/caseId/verificationTaskId/formType).
- **`verificationOutcome` is top-level**, NOT inside formData. The in-form verdict (`finalStatus`, and APF's `finalStatusNegative`) DOES live inside `formData`. (`FormSubmissionService.ts:74-82` passes `selectedOutcome` → `verificationOutcome`.)
- On sync, `FormUploader.upload()` re-hydrates `formData` from `tasks.form_data_json`, strips the internal `__submission` marker, resolves `attachmentIds` to backend ids, drops `images`, and POSTs with an idempotency key (`FormUploader.ts:137-365`). It logs the outgoing `formData` keys + `finalStatus` for diagnostics (`:319-333`).
- Success signal (ADR-0054): a bare `CaseTaskView` with an `id` — no `{success}` wrapper. Task is moved to **SUBMITTED** locally (two-stage completion; the office completes it later); the device NEVER writes COMPLETED (`FormUploader.ts:335-442`).

---

## 12. Cross-layer key-drift findings (for the downstream diff agent)

These are exact-key facts a report-template diff must account for:

1. **camelCase only.** The capture layer emits 107 camelCase keys. Any CRM report template keyed in snake_case (`door_color`, `address_structure`, `tpc_name_1`, `customer_name`, …) will NOT match by literal key. A mapping layer must exist server-side or templates will render blank.
2. **"Relationship" has THREE different keys across types:** `metPersonRelation` (RESIDENCE), `relation` (RESIDENCE_CUM_OFFICE), `relationship` (PROPERTY_INDIVIDUAL). Same concept, three keys.
3. **APF emits two verdict keys:** `finalStatus` (SEEN) and `finalStatusNegative` (non-SEEN). Every other type emits only `finalStatus`. APF reports must coalesce both.
4. **Existence flags are two distinct, partly-misspelled keys:** `businessExistance` (NSP, misspelled) and `businessExistsStatus` (ERT) — also `officeExistence` / `officeExistsStatus` for office/NOC.
5. **APF `tpcMetPerson1`/`tpcName1` labels are swapped** in source (data still lands under the standard keys; UI labels only are crossed).
6. **Status field name differs by type:** `houseStatus` (residence), `resiCumOfficeStatus` (RCO), `officeStatus` (office/builder/dsa/noc), `businessStatus` (business), `flatStatus` (property-individual), `constructionActivity` (APF).
7. **`callConfirmation`** is injected app-side after every `callRemark`; it will be present in submissions whenever callRemark='Pickup call & confirm'. Reports must expect it.

---

## 13. PASS / PARTIAL / FAIL self-assessment

Criterion: "does the app capture a clear, keyed field set + geo-tagged photos?"

| Type | Keyed field set | Geo photos | Verdict |
|------|-----------------|------------|---------|
| RESIDENCE | 49 keys, clean camelCase, 5 outcomes | mandatory, enforced | **PASS** |
| RESIDENCE_CUM_OFFICE | 58 keys, 5 outcomes | mandatory, enforced | **PASS** |
| OFFICE | 54 keys, 5 outcomes | mandatory, enforced | **PASS** |
| BUSINESS | 52 keys, 5 outcomes (note `businessExistance` typo) | mandatory, enforced | **PASS** |
| BUILDER | 52 keys, 5 outcomes | mandatory, enforced | **PASS** |
| NOC | 42 keys, 5 outcomes | mandatory, enforced | **PASS** |
| DSA_CONNECTOR | 52 keys, 5 outcomes (DSA-only `activeClient`) | mandatory, enforced | **PASS** |
| PROPERTY_APF | 38 keys, 3 outcomes; **dual verdict key + swapped tpc labels** | mandatory, enforced | **PARTIAL** — dual `finalStatus`/`finalStatusNegative` + label/key swap are downstream-drift traps |
| PROPERTY_INDIVIDUAL | 36 keys, 4 outcomes (`relationship` key) | mandatory, enforced | **PASS** |

**Layer verdict:** The mobile capture layer is sound — every type produces a clear, exact, camelCase keyed field set and geo-tagging is mandatory and structurally enforced (capture-time + submit-time). The only capture-layer caveats are PROPERTY_APF's dual verdict key and its swapped tpc labels, plus the cross-type key-naming inconsistencies in §12 that the downstream report-template layer must reconcile. **No FAIL.**
