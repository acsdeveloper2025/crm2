# V1 Report Ground-Truth Mapping — for exact v2 reproduction (2026-06-16)

The owner asked us to map the v1 report engine **exactly** so v2 reproduces it 1:1. This doc is the
**verified ground truth**, pulled READ-ONLY from the **live v1 production server**
(`crm.allcheckservices.com` / `49.50.119.155`, deployed image `016d1e30`, `crm_postgres` = `acs_db`) on
2026-06-16, cross-checked against the deployed source (`CRM-BACKEND/src/services/TemplateReportService.ts`,
local HEAD `9d4a54e3`, whose templates match the prod rendered output byte-for-format). Backing audit of
the helper logic: `2026-06-16-field-report-v1-audit.md`. Drives **S3** (seed templates + grammar helpers).

> **DPDP / PII:** the real rendered narratives in prod `template_reports.report_content` contain live
> customer names/addresses — they are **NOT committed**. Only field-key sets (no PII) + the
> raw `{Placeholder}` templates (from code) are recorded here. Rendered samples were inspected live to
> confirm grammar, then discarded.

## 1. The 9 verification types × their EXACT field keys
Source: prod `form_submissions.submission_data` (the device's submitted form; **flat** — field keys are
top-level, with `form_type` a separate column). The complete per-type key set is committed as
**`v1-ground-truth/field-keys-by-type.tsv`** (one row per type, comma-separated keys). Prod submission
counts: RESIDENCE 28 · RES_CUM_OFFICE 18 · OFFICE 18 · BUSINESS 16 · DSA_CONNECTOR 15 · NOC 14 ·
BUILDER 13 · PROPERTY_INDIVIDUAL 11 · PROPERTY_APF 11.

**Shared spine (~all types):** addressLocatable, addressRating, addressStructure, addressStructureColor,
addressFloor, locality, landmark1-4, dominatedArea, feedbackFromNeighbour, politicalConnection,
metPersonName/Type/Confirmation, tpcName1/2 + tpcMetPerson1/2 + tpcConfirmation1/2, doorColor,
callRemark, otherObservation, finalStatus, verificationOutcome, contactPerson, premisesStatus, remarks.

**Type-specific highlights** (full list in the tsv):
- **RESIDENCE:** houseStatus, applicantStayingFloor/Status, stayingPeriod/Status/PersonName,
  totalFamilyMembers, totalEarningMember, metPersonRelation, doorNamePlateStatus/nameOnDoorPlate,
  societyNamePlateStatus/nameOnSocietyBoard, documentShown/Type, workingStatus, companyName, approxArea,
  shiftedPeriod, callConfirmation.
- **OFFICE:** applicantDesignation, officeStatus/Type/Existence/ExistsStatus, companyNatureOfBusiness,
  establishmentPeriod, workingPeriod, staffStrength/Seen, officeApproxArea, currentCompanyName/Period,
  oldOfficeShiftedPeriod, companyNamePlateStatus/nameOnBoard, applicantWorkingPremises/Status.
- **BUSINESS:** businessStatus/Type/Period/Existance/ExistsStatus, ownershipType, nameOfCompanyOwners,
  applicantExistance/WorkingStatus + the office spine.
- **BUILDER:** businessExistance/Period/Type, currentCompanyName/Period, metPersonDesignation,
  nameOfCompanyOwners, ownershipType, officeStatus/ApproxArea, staffStrength/Seen.
- **DSA_CONNECTOR:** activeClient + the business/office spine.
- **NOC:** officeExistsStatus, authorisedSignature, nameOnNoc, flatNo, currentCompanyName/Period.
- **RESIDENCE_CUM_OFFICE:** both residence (stayingPeriod/Status, doorNamePlate…) AND office
  (businessStatus/Location/OperatingAddress/Setup/Period, resiCumOfficeStatus, residenceSetup, relation).
- **PROPERTY_INDIVIDUAL:** flatStatus, propertyOwnerName, relationship, addressExistAt, buildingStatus,
  approxArea, doorNamePlateStatus, societyNamePlateStatus.
- **PROPERTY_APF:** projectName, buildingStatus, constructionActivity, activityStopReason,
  projectCompletionPercent, projectStartedDate/CompletionDate, totalFlats/Wing, staffStrength/Seen,
  finalStatusNegative (the APF-specific negative driver).

**⚠️ Envelope keys to SKIP** (present in `submission_data` but NOT agent fields):
`formType, formData, submissionId, submittedAt, submittedBy, verification, verificationImages,
geoLocation`. v2's `buildSections` SKIP_KEYS must cover these (currently skips photos/attachments/geo/
metadata/formdata — **extend with formType/submissionId/submittedAt/submittedBy/verification/
verificationImages** in S2b/S3). **OPEN for the ingest slice:** prod v1 stores `submission_data` FLAT;
v2's verification-tasks ingest comment assumes nested `form_data[slug].formData`. Decide v2's stored
shape and align buildSections — if v2 ends up flat-per-slug, the nested-fallback already handles it, but
the skip-list must match.

## 2. The EXACT (type × outcome) matrix
Source: prod `template_reports` (verification_type, outcome) — **66 live combos**. Outcome strings are the
human labels the engine keys on:
- **7 standard types** (RESIDENCE, OFFICE, BUSINESS, RESIDENCE_CUM_OFFICE, BUILDER, NOC, DSA_CONNECTOR) —
  **8 outcomes each:** `Positive & Door Open`, `Positive & Door Locked`, `Shifted & Door Open`,
  `Shifted & Door Locked`, `NSP & Door Open`, `NSP & Door Locked`, `ERT`, `Untraceable`.
- **PROPERTY_INDIVIDUAL — 6:** Positive/NSP × Door Open/Locked, `ERT`, `Untraceable` (NO Shifted).
- **PROPERTY_APF — 4:** `Positive`, `Negative`, `ERT`, `Untraceable` (no door variants; `Negative` is the
  APF split, driven by `constructionActivity`/`finalStatusNegative`).

## 3. The template structure (raw `{Placeholder}` form)
Source: `TemplateReportService.ts` (e.g. `RESIDENCE_TEMPLATES.POSITIVE_DOOR_OPEN` at lines 38-57) —
matches the prod rendered output exactly. Every narrative is a fixed **6-section** body:
```
<Type> Remark: <OUTCOME>.

VERIFICATION DETAILS:    Visited at {Customer_Address} for {Customer_Name} ({Applicant_Type}) … rated as
                         {Address_Rating} … met with {Met_Person_Name} ({Met_Person_Relation}) … staying
                         {Staying_Period} {Staying_Status}.
PROPERTY & PERSONAL DETAILS:  area {Approx_Area_Sq_Feet}, family {Total_Family_Members}/{Total_Earning_
                         Members}, {Working_Profile_Text} door nameplate {Door_Name_Plate_Text} …
LOCALITY INFORMATION:    locality {Locality}, structure G+{Address_Structure_G_Plus}, floor {Applicant_
                         Staying_Floor}, colors … {Document_Shown_Sentence}
THIRD PARTY CONFIRMATION: TPC {TPC_1_Label} {TPC_Confirmation_1} … {TPC_2_Label} {TPC_Confirmation_2} …
AREA ASSESSMENT:         landmarks {Landmark_1}/{Landmark_2}, {Dominated_Area_Text}, {Feedback_from_
                         Neighbour} feedback, {Political_Connection_Text} …
CONCLUSION:              Field Executive Observation: {Other_Observation}. Hence the profile is marked as
                         {Final_Status}.
```
The other 8 types follow the same section skeleton with type-specific clauses (office → employment/firm;
property → construction/ownership). Placeholders use `{Pascal_Snake}` tokens; outcome variants change the
clause wording (door open vs locked, shifted, NSP, ERT, untraceable).

## 4. field key → `{Placeholder}` mapping + grammar helpers
The mapping from the flat `submission_data` keys (camelCase) → the template `{Placeholders}` is
`mapFormDataToTemplateVariables` (`TemplateReportService.ts:2046-3220`), via `safeGet` (tries
key/lowercase/snake) with `|| ''` defaults + a whitespace-collapse pass (`:1420-1422`). Beyond direct
substitution, **~30 grammar helpers produce grammatically-correct clauses** (full inventory in
`2026-06-16-field-report-v1-audit.md §C3`):
- **value transforms:** ordinal (floors), lc/capFirst (mobile sends Title-case), pluralizePeriod
  ("5 Year"→"5 Years"), formatIsoDate (local, not UTC), formatAreaSqFeet ("N sq. feet"/"Not provided").
- **all-or-nothing composites (render '' unless all inputs present):** Working_Profile_Text,
  Current_Company_Operating_Sentence, staying+working join.
- **enum→prose mappers:** Call_Remark, Document_Shown_Sentence, Dominated_Area_Text,
  Political_Connection_Text, Met_Person_Confirmation, nameplate sighted/not (`shows the name "X"` /
  `is not sighted`), setup, business/sitting-location.
- **graceful TPC joins:** TPC_1/2_Label (no dangling " and ", no "Not provided Not provided").
- **APF verdict-coherence:** Activity_Verdict_Sentence + Verdict_Override_Note (reconcile agent verdict
  vs construction reality).
- `getCustomerName` test-data guard; `Final_Status` = finalStatus || verificationOutcome || 'Positive'.

## 5. S3 build plan (exact reproduction)
1. **Seed ~9 FIELD_REPORT templates** (one per type) in `report_layouts` as Handlebars, the §3 6-section
   skeleton, with `{{#eq outcome "Positive & Door Open"}}…{{/eq}}` branches covering each type's outcome
   set (§2). Port the raw `{Placeholder}` text from `TemplateReportService.ts`, converting `{Token}` →
   `{{token}}` and the helper-derived placeholders → helper calls (§4).
2. **Port the ~30 grammar helpers** as a versioned Handlebars helper library + a `COMPUTED` catalog
   source for the multi-field composites (the slice-1 SOURCE carry).
3. **Bind the variable-catalog columns** (FORM_DATA_PATH) to the real per-type field keys (the tsv) — e.g.
   `Customer_Name` ← form-data customerName/metPersonName guard; `Staying_Period` ← pluralizePeriod(
   stayingPeriod). One catalog per type.
4. **Outcome normalizer:** map the device `verificationOutcome` string → the stable outcome token the
   `{{#eq}}` branches test (config, NOT v1's 480-line re-parser).
5. Extend `buildSections` SKIP_KEYS with the §1 envelope keys.

## Extraction provenance
Read-only via `ssh root@49.50.119.155:2232` → `docker exec crm_postgres psql $DATABASE_URL` — SELECT
only, no writes. Field-key sets: `field-keys-by-type.tsv` (committed). Outcome matrix + rendered grammar:
verified live, PII not committed.
