# Layer 4 — FIELD_REPORT Template ⇄ Mobile Field-Key Mapping Audit

**Date:** 2026-06-22 · **Scope:** read-only audit (no source edited) · **Status:** COMPLETE

## What this audit checks

The mobile app submits each verification form as a jsonb blob stored **verbatim** by the
backend under `case_tasks.form_data[<slug>] = { formData: { <camelCaseKey>: value, … },
verificationOutcome: <value>, … }`. The CRM FIELD_REPORT engine renders prose by resolving
each template column's `sourceRef` (e.g. `residence.formData.doorColor`) via **plain dot-path
property access** — no snake↔camel normalization. So the **final segment of every
`sourceRef`** must equal the mobile camelCase key EXACTLY, or the value resolves to `''` and the
clause silently drops.

### Verified plumbing (file:line evidence)

| Hop | Evidence | Verdict |
|---|---|---|
| Resolver does plain property access, no normalization | `apps/api/src/modules/fieldReports/render.ts:15-23` (`walkPath` = `cur[seg]` per `.`-split segment); `:30-31` `FORM_DATA_PATH → walkPath(ctx.formData, ref)` | CONFIRMED |
| Missing/null → `''` (empty clause, not "undefined") | `render.ts:45-52` (`buildContext`), `:54-62` (`cleanWhitespace`) | CONFIRMED |
| Blob stored verbatim under the slug key, no key transform | `apps/api/src/modules/cases/repository.ts:1413-1418` — `jsonb_set(form_data, ARRAY[$4]=formType, $5=body, true)` | CONFIRMED |
| Submission schema is fully permissive (no key coercion) | `apps/api/src/modules/verification-tasks/service.ts:54` — `z.record(z.string(), z.unknown())` | CONFIRMED |
| Slugs match template `FD(slug,…)` exactly | `service.ts:40-50` `FORM_TYPE_SLUGS = [residence, office, business, residence-cum-office, dsa-connector, builder, property-individual, property-apf, noc]` | CONFIRMED |
| Render context loads `formData` = raw `ct.form_data`; `outcome` ref = `<slug>.verificationOutcome` | `apps/api/src/modules/fieldReports/repository.ts:52` (`'formData', ct.form_data`); `fieldReportDefaults.ts:96-102` (`OUT(slug)` → `${slug}.verificationOutcome`) | CONFIRMED |
| Mobile body has top-level `formData` + `verificationOutcome` (so `<slug>.formData.<k>` / `<slug>.verificationOutcome` are correct paths) | `crm-mobile-native/.../FormSubmissionService.ts:74-82`; `usecases/SubmitVerificationUseCase.ts:186-220` | CONFIRMED |
| `verificationOutcome` = the outcome **CODE**, not a label | `FormSubmissionService.ts:81` (`verificationOutcome: selectedOutcome`); `VerificationFormScreen.tsx:603` passes `selectedOutcome: LegacyOutcome`; `LegacyFormTemplateBuilders.ts:8-13,7662` `LegacyOutcome = 'POSITIVE'\|'SHIFTED'\|'NSP'\|'ENTRY_RESTRICTED'\|'UNTRACEABLE'` | CONFIRMED |

`columnKey` (the `{{variable}}`) is INTERNAL and may be snake_case — that is fine and correct.
Only the **sourceRef final segment** is checked against the mobile key below.

---

## ★ HEADLINE FINDING

**There is NO systemic snake_case-vs-camelCase drift in the `sourceRef` segments.**
Every `F(columnKey,label,ref)` / `FD(slug,columnKey,label,ref)` builder
(`fieldReportDefaults.ts:60-66, 89-95`) hard-codes the **`ref` (4th/3rd arg) in camelCase** — it
is `door_color`/`doorColor` shaped as `columnKey=door_color, ref='doorColor'`. The catalog was
authored with this distinction deliberately. So the feared "template reads `door_color` but app
emits `doorColor`" class of bug **does NOT exist** — the per-key camelCase match rate is ~100%.

**However, two REAL P0 defects break the report anyway, and they are systemic:**

1. **P0-A — Composite period keys never resolve.** The mobile splits every "period" field into
   two keys `<period>Value` + `<period>Unit` (e.g. `stayingPeriodValue`, `stayingPeriodUnit`),
   but the template reads a **single** `<period>` key (`stayingPeriod`, `shiftedPeriod`,
   `businessPeriod`, `workingPeriod`, `establishmentPeriod`, `currentCompanyPeriod`,
   `oldOfficeShiftedPeriod`). The single key is absent from the blob → resolves to `''` →
   `{{pluralize ''}}` renders empty. **Affects 8 of 9 types** (every type that prints a tenure).

2. **P0-B — Outcome branch strings never match.** The template branches on verbose labels
   (`{{#eq outcome "Positive & Door Open"}}`, `"Positive & Door Locked"`, `"Shifted & Door Open"`,
   `"NSP & Door Locked"`, `"ERT"`, `"Untraceable"`, `"Positive"`, `"Negative"`). The mobile stores
   one of **5 UPPERCASE codes** (`POSITIVE`/`SHIFTED`/`NSP`/`ENTRY_RESTRICTED`/`UNTRACEABLE`).
   `{{#eq}}` is strict `===` (`helpers.ts:306-310`). **No branch ever matches → the ENTIRE
   narrative renders empty for EVERY task of EVERY type.** This is the single worst defect found.

> Net effect: even though the field-key camelCase mapping is essentially perfect, the report body
> for a real device submission renders as **empty** (P0-B), and even if a branch were forced to
> match, every tenure sentence would be blank (P0-A). The mapping layer is sound; the **outcome
> vocabulary and the period-key arity** are the breakages.

---

## Drift taxonomy (legend)

- **MATCH** — template `sourceRef` segment === a mobile field `name`.
- **DRIFT** — template segment ≠ mobile key, but a near-equivalent mobile key exists (named).
- **MISSING-IN-MOBILE** — template reads a key the mobile form never emits for that type.
- **NOT-CONSUMED** — mobile emits a key the template prose never reads (low severity: the generic
  raw-section flattener still surfaces it on the web `#6` card; flagged only when it omits
  narrative signal).

Note: `outcome` (the `OUTCOME`/`OUT(slug)` column) and the APP/TASK columns (`customer_address`,
`customer_name`, `applicant_type`) are NOT formData — excluded from the per-key match table;
`outcome` is covered in each type's Outcome-Branch Check.

---

## 1. RESIDENCE — `fieldReportDefaults.ts:105-295`

**Mobile keys (49):** addressLocatable, addressRating, houseStatus, callRemark, callConfirmation,
metPersonName, metPersonRelation, totalFamilyMembers, totalEarningMember, workingStatus,
companyName, **stayingPeriodValue, stayingPeriodUnit**, stayingStatus, approxArea, documentShown,
documentType, tpcMetPerson1/2, tpcName1/2, tpcConfirmation1/2, locality, addressStructure,
addressFloor, addressStructureColor, doorColor, doorNamePlateStatus, nameOnDoorPlate,
societyNamePlateStatus, nameOnSocietyBoard, landmark1-4, politicalConnection, dominatedArea,
feedbackFromNeighbour, otherObservation, finalStatus, **shiftedPeriodValue, shiftedPeriodUnit**,
metPersonStatus, premisesStatus, stayingPersonName, metPersonType, metPersonConfirmation,
applicantStayingStatus, contactPerson.

| Template sourceRef segment | columnKey (internal) | Mobile key | Verdict | Note |
|---|---|---|---|---|
| addressRating | address_rating | addressRating | MATCH | |
| metPersonName | met_person_name | metPersonName | MATCH | |
| metPersonRelation | met_person_relation | metPersonRelation | MATCH | |
| metPersonStatus | met_person_status | metPersonStatus | MATCH | |
| metPersonType | met_person_type | metPersonType | MATCH | |
| metPersonConfirmation | met_person_confirmation | metPersonConfirmation | MATCH | |
| houseStatus | house_status | houseStatus | MATCH | |
| **stayingPeriod** | staying_period | stayingPeriodValue + stayingPeriodUnit | **DRIFT (P0-A)** | line 117. Mobile splits into Value+Unit; single `stayingPeriod` absent → `{{pluralize staying_period}}` empty |
| stayingStatus | staying_status | stayingStatus | MATCH | |
| stayingPersonName | staying_person_name | stayingPersonName | MATCH | |
| **shiftedPeriod** | shifted_period | shiftedPeriodValue + shiftedPeriodUnit | **DRIFT (P0-A)** | line 120 |
| approxArea | approx_area | approxArea | MATCH | |
| totalFamilyMembers | total_family_members | totalFamilyMembers | MATCH | |
| totalEarningMember | total_earning_members | totalEarningMember | MATCH | columnKey plural, ref singular — ref matches mobile |
| workingStatus | working_status | workingStatus | MATCH | |
| companyName | company_name | companyName | MATCH | |
| locality | locality | locality | MATCH | |
| addressStructure | address_structure | addressStructure | MATCH | |
| **applicantStayingFloor** | applicant_staying_floor | *(none)* | **MISSING-IN-MOBILE** | line 128. Mobile emits `addressFloor`, not `applicantStayingFloor`. Used by `{{ordinal applicant_staying_floor}}` and `{{addressFloor applicant_staying_floor}}` → empty |
| applicantStayingStatus | applicant_staying_status | applicantStayingStatus | MATCH | column present but NOT referenced in RESIDENCE_BODY (NOT-CONSUMED narrative) |
| addressStructureColor | address_structure_color | addressStructureColor | MATCH | |
| doorColor | door_color | doorColor | MATCH | the canonical "door_color vs doorColor" case — ref IS camelCase, MATCH |
| doorNamePlateStatus | door_nameplate_status | doorNamePlateStatus | MATCH | |
| nameOnDoorPlate | name_on_door_plate | nameOnDoorPlate | MATCH | |
| societyNamePlateStatus | society_nameplate_status | societyNamePlateStatus | MATCH | |
| nameOnSocietyBoard | name_on_society_board | nameOnSocietyBoard | MATCH | |
| documentShown | document_shown | documentShown | MATCH | |
| documentType | document_type | documentType | MATCH | |
| callRemark | call_remark | callRemark | MATCH | |
| callConfirmation | call_confirmation | callConfirmation | MATCH | |
| tpcName1 / tpcMetPerson1 / tpcConfirmation1 | tpc_*_1 | tpcName1 / tpcMetPerson1 / tpcConfirmation1 | MATCH | |
| tpcName2 / tpcMetPerson2 / tpcConfirmation2 | tpc_*_2 | tpcName2 / tpcMetPerson2 / tpcConfirmation2 | MATCH | |
| landmark1-4 | landmark_1..4 | landmark1-4 | MATCH | |
| dominatedArea | dominated_area | dominatedArea | MATCH | |
| feedbackFromNeighbour | feedback_from_neighbour | feedbackFromNeighbour | MATCH | |
| politicalConnection | political_connection | politicalConnection | MATCH | |
| contactPerson | contact_person | contactPerson | MATCH | |
| otherObservation | other_observation | otherObservation | MATCH | |
| finalStatus | final_status | finalStatus | MATCH | (also note P0-B: even when present, branch never reached) |

**NOT-CONSUMED mobile keys:** `addressLocatable` (prose hard-codes "is locatable"),
`premisesStatus`, `applicantStayingStatus`. Low severity.

**Outcome-Branch Check (P0-B):** branches = `"Positive & Door Open"`, `"Positive & Door Locked"`,
`"Shifted & Door Open"`, `"Shifted & Door Locked"`, `"NSP & Door Open"`, `"NSP & Door Locked"`,
`"ERT"`, `"Untraceable"` (lines 165-295). Mobile emits `POSITIVE`/`SHIFTED`/`NSP`/`ENTRY_RESTRICTED`/
`UNTRACEABLE`. **ZERO overlap → no branch renders.** Even the door-open/locked split has no mobile
analog (mobile has one `POSITIVE`, not two). FAIL.

**Verdict: FAIL** (1 period DRIFT, 1 floor MISSING, total outcome-branch break).

---

## 2. OFFICE — `fieldReportDefaults.ts:298-487`

**Mobile keys (53):** addressLocatable, addressRating, officeStatus, callRemark, metPersonName,
metPersonDesignation, **workingPeriodValue/Unit**, applicantDesignation, applicantWorkingPremises,
sittingLocation, officeType, companyNatureOfBusiness, **establishmentPeriodValue/Unit**,
staffStrength, staffSeen, officeApproxArea, companyNamePlateStatus, nameOnBoard, documentShown,
locality, addressStructure, addressFloor, addressStructureColor, doorColor,
**oldOfficeShiftedPeriodValue/Unit**, currentCompanyName, **currentCompanyPeriodValue/Unit**,
metPersonType, metPersonConfirmation, officeExistsStatus, officeExistence, applicantWorkingStatus,
workingStatus, contactPerson, tpc{Name,MetPerson,Confirmation}{1,2}, landmark1-4, dominatedArea,
feedbackFromNeighbour, politicalConnection, otherObservation, finalStatus.

| Template sourceRef segment | columnKey | Mobile key | Verdict | Note |
|---|---|---|---|---|
| addressRating | address_rating | addressRating | MATCH | |
| officeStatus | office_status | officeStatus | MATCH | |
| metPersonName | met_person_name (+ name_of_met_person at :328) | metPersonName | MATCH | two columns both ref `metPersonName` (ERT alias) |
| metPersonDesignation | designation | metPersonDesignation | MATCH | columnKey `designation`, ref camelCase |
| **workingPeriod** | working_period | workingPeriodValue + workingPeriodUnit | **DRIFT (P0-A)** | line 307 |
| applicantDesignation | applicant_designation | applicantDesignation | MATCH | |
| applicantWorkingPremises | applicant_working_premises | applicantWorkingPremises | MATCH | |
| sittingLocation | sitting_location | sittingLocation | MATCH | |
| officeType | office_type | officeType | MATCH | |
| companyNatureOfBusiness | company_nature_of_business | companyNatureOfBusiness | MATCH | |
| **establishmentPeriod** | establishment_period | establishmentPeriodValue + establishmentPeriodUnit | **DRIFT (P0-A)** | line 313 |
| staffStrength / staffSeen | staff_strength / staff_seen | staffStrength / staffSeen | MATCH | |
| officeApproxArea | office_approx_area | officeApproxArea | MATCH | |
| companyNamePlateStatus / nameOnBoard | company_name_plate_status / name_on_board | companyNamePlateStatus / nameOnBoard | MATCH | |
| documentShown | document_shown | documentShown | MATCH | |
| locality / addressStructure / addressStructureColor / doorColor | … | (all present) | MATCH | |
| addressFloor | address_floor | addressFloor | MATCH | |
| **oldOfficeShiftedPeriod** | old_office_shifted_period | oldOfficeShiftedPeriodValue + …Unit | **DRIFT (P0-A)** | line 325 |
| currentCompanyName | current_company_name | currentCompanyName | MATCH | |
| **currentCompanyPeriod** | current_company_period | currentCompanyPeriodValue + …Unit | **DRIFT (P0-A)** | line 327 |
| metPersonType / metPersonConfirmation | met_person_type / met_person_confirmation | (present) | MATCH | |
| officeExistsStatus | office_exists_status | officeExistsStatus | MATCH | |
| applicantWorkingStatus | applicant_working_status | applicantWorkingStatus | MATCH | |
| callRemark / contactPerson | … | (present) | MATCH | |
| tpc* / landmark* / dominatedArea / feedbackFromNeighbour / politicalConnection / otherObservation / finalStatus | … | (present) | MATCH | |

**NOT-CONSUMED mobile keys:** `addressLocatable`, `officeExistence` (template reads
`officeExistsStatus`, not `officeExistence` — distinct key; the latter is unused),
`workingStatus` (template uses `applicantWorkingStatus` in ERT). Low severity.

**Outcome-Branch Check (P0-B):** branches = 8 verbose labels (Positive/Shifted/NSP ×Open/Locked,
ERT, Untraceable). Mobile = 5 codes. **No match → FAIL.**

**Verdict: FAIL** (4 period DRIFTs, total outcome-branch break).

---

## 3. BUSINESS — `fieldReportDefaults.ts:490-680`

**Mobile keys (51):** addressLocatable, addressRating, businessStatus, businessType, ownershipType,
addressStatus, **businessPeriodValue/Unit**, premisesStatus, **businessExistance** (misspelled),
businessExistsStatus, metPersonName, metPersonDesignation, metPersonType, metPersonConfirmation,
companyNatureOfBusiness, officeApproxArea, nameOfCompanyOwners, companyNamePlateStatus, nameOnBoard,
staffStrength, staffSeen, documentShown, currentCompanyName, **currentCompanyPeriodValue/Unit**,
**oldOfficeShiftedPeriodValue/Unit**, applicantWorkingStatus, callRemark, contactPerson, locality,
addressStructure, addressStructureColor, doorColor, addressFloor, tpc*, landmark1-4, dominatedArea,
feedbackFromNeighbour, politicalConnection, otherObservation, finalStatus.

| Template sourceRef segment | columnKey | Mobile key | Verdict | Note |
|---|---|---|---|---|
| addressRating / businessStatus / businessType / ownershipType | … | (present) | MATCH | |
| metPersonName / designation→metPersonDesignation | met_person_name / designation | metPersonName / metPersonDesignation | MATCH | |
| **businessPeriod** | business_period | businessPeriodValue + …Unit | **DRIFT (P0-A)** | line 499 |
| companyNatureOfBusiness | company_nature_of_business | companyNatureOfBusiness | MATCH | |
| **approxArea** | business_approx_area | approxArea | MATCH | line 503 — columnKey `business_approx_area`, ref `approxArea` matches mobile. ✓ (no drift) |
| **nameOfCompanyOwners** | business_owner_name | nameOfCompanyOwners | MATCH | line 504 — ref camelCase matches |
| companyNamePlateStatus / nameOnBoard | … | (present) | MATCH | |
| staffStrength / staffSeen / documentShown | … | (present) | MATCH | |
| premisesStatus | premises_status | premisesStatus | MATCH | |
| currentCompanyName | current_company_name | currentCompanyName | MATCH | |
| **currentCompanyPeriod** | current_company_period | currentCompanyPeriodValue + …Unit | **DRIFT (P0-A)** | line 512 |
| **oldOfficeShiftedPeriod** | old_business_shifted_period | oldOfficeShiftedPeriodValue + …Unit | **DRIFT (P0-A)** | line 513 — columnKey says "business" but ref is the office key; mobile DOES emit `oldOfficeShiftedPeriod*` → so the drift is ONLY the Value/Unit split, the stem is right |
| locality / addressStructure / addressStructureColor / doorColor / addressFloor | … | (present) | MATCH | |
| callRemark / contactPerson | … | (present) | MATCH | |
| metPersonName (ERT name_of_met_person) / metPersonType / metPersonConfirmation | … | (present) | MATCH | |
| businessExistsStatus | business_exists_status | businessExistsStatus | MATCH | (mobile ALSO has misspelled `businessExistance`, NOT read by template → harmless NOT-CONSUMED) |
| applicantWorkingStatus | applicant_working_status | applicantWorkingStatus | MATCH | |
| tpc* / landmark* / dominatedArea / feedbackFromNeighbour / politicalConnection / otherObservation / finalStatus | … | (present) | MATCH | |

**NOT-CONSUMED mobile keys:** `addressLocatable`, `addressStatus` (BUSINESS template never prints
premises-held status — it is consumed in BUILDER/DSA), `businessExistance` (misspelled twin of the
read `businessExistsStatus`). Low severity.

**Outcome-Branch Check (P0-B):** 8 verbose labels vs 5 codes → no match → FAIL.

**Verdict: FAIL** (3 period DRIFTs, total outcome-branch break).

---

## 4. RESIDENCE_CUM_OFFICE — `fieldReportDefaults.ts:683-896`

**Mobile keys (58):** addressLocatable, addressRating, addressTraceable, resiCumOfficeStatus,
metPersonName, **relation**, metPersonStatus, metPersonType, metPersonConfirmation,
**stayingPeriodValue/Unit**, stayingStatus, stayingPersonName, **shiftedPeriodValue/Unit**,
addressFloor, applicantStayingStatus, applicantWorkingStatus, residenceSetup, businessStatus,
**businessPeriodValue/Unit**, businessSetup, businessLocation, businessOperatingAddress,
businessExistsStatus, companyNatureOfBusiness, approxArea, locality, addressStructure,
addressStructureColor, doorColor, doorNamePlateStatus, nameOnDoorPlate, societyNamePlateStatus,
nameOnSocietyBoard, companyNamePlateStatus, nameOnBoard, documentShown, documentType, callRemark,
tpc*, landmark1-4, dominatedArea, feedbackFromNeighbour, politicalConnection, contactPerson,
otherObservation, finalStatus.

| Template sourceRef segment | columnKey | Mobile key | Verdict | Note |
|---|---|---|---|---|
| addressRating / addressTraceable | … | (present) | MATCH | |
| **resiCumOfficeStatus** | house_status | resiCumOfficeStatus | MATCH | line 690 — columnKey `house_status`, ref `resiCumOfficeStatus` matches mobile ✓ |
| metPersonName | met_person_name | metPersonName | MATCH | |
| **relation** | met_person_relation | relation | MATCH | line 692 — ref is `relation` (RCO mobile uses `relation`, not `metPersonRelation`) ✓ |
| metPersonStatus / metPersonType / metPersonConfirmation | … | (present) | MATCH | |
| **stayingPeriod** | staying_period | stayingPeriodValue + …Unit | **DRIFT (P0-A)** | line 696 |
| stayingStatus / stayingPersonName | … | (present) | MATCH | |
| **shiftedPeriod** | shifted_period | shiftedPeriodValue + …Unit | **DRIFT (P0-A)** | line 699 |
| **applicantStayingFloor** | applicant_staying_floor | *(none — mobile emits `addressFloor`)* | **MISSING-IN-MOBILE** | line 700. `{{ordinal applicant_staying_floor}}` + `{{addressFloor applicant_staying_floor}}` → empty |
| applicantStayingStatus / applicantWorkingStatus | … | (present) | MATCH | consumed in ERT branch |
| residenceSetup / businessSetup | … | (present) | MATCH | |
| businessStatus | business_status | businessStatus | MATCH | |
| **businessPeriod** | business_period | businessPeriodValue + …Unit | **DRIFT (P0-A)** | line 715 |
| businessLocation | business_location_value | businessLocation | MATCH | columnKey `business_location_value`, ref matches |
| businessOperatingAddress | business_operating_address | businessOperatingAddress | MATCH | |
| businessExistsStatus | business_exists_status | businessExistsStatus | MATCH | consumed in ERT |
| companyNatureOfBusiness / approxArea | … | (present) | MATCH | |
| locality / addressStructure / addressStructureColor / doorColor | … | (present) | MATCH | |
| doorNamePlateStatus / nameOnDoorPlate / societyNamePlateStatus / nameOnSocietyBoard / companyNamePlateStatus / nameOnBoard | … | (present) | MATCH | |
| documentShown | document_shown | documentShown | MATCH | |
| callRemark / contactPerson | … | (present) | MATCH | |
| tpc* / landmark* / dominatedArea / feedbackFromNeighbour / politicalConnection / otherObservation / finalStatus | … | (present) | MATCH | |

**NOT-CONSUMED mobile keys:** `addressLocatable`, `documentType` (RCO body calls
`documentShownSentence document_shown ""` with empty doc-type arg — the captured `documentType` is
unused). Low severity.

**Outcome-Branch Check (P0-B):** 8 verbose labels vs 5 codes → no match → FAIL.

**Verdict: FAIL** (3 period DRIFTs, 1 floor MISSING, total outcome-branch break).

---

## 5. PROPERTY_INDIVIDUAL — `fieldReportDefaults.ts:899-1039`

**Mobile keys (36):** addressLocatable, addressRating, buildingStatus, flatStatus, metPersonName,
**relationship**, metPersonType, metPersonConfirmation, propertyOwnerName, approxArea,
doorNamePlateStatus, nameOnDoorPlate, societyNamePlateStatus, nameOnSocietyBoard, locality,
addressStructure, addressStructureColor, doorColor, addressFloor, callRemark, contactPerson, tpc*,
landmark1-4, dominatedArea, feedbackFromNeighbour, politicalConnection, otherObservation, finalStatus.

| Template sourceRef segment | columnKey | Mobile key | Verdict | Note |
|---|---|---|---|---|
| addressRating / buildingStatus | … | (present) | MATCH | |
| metPersonName (+ ERT name_of_met_person) | met_person_name | metPersonName | MATCH | |
| **relationship** | met_person_relation | relationship | MATCH | line 907 — ref is `relationship` (PI mobile key) ✓ |
| metPersonType / metPersonConfirmation | … | (present) | MATCH | |
| propertyOwnerName | property_owner_name | propertyOwnerName | MATCH | |
| approxArea | approx_area | approxArea | MATCH | |
| doorNamePlateStatus / nameOnDoorPlate / societyNamePlateStatus / nameOnSocietyBoard | … | (present) | MATCH | |
| locality / addressStructure / addressStructureColor / doorColor / addressFloor | … | (present) | MATCH | |
| callRemark / contactPerson | … | (present) | MATCH | |
| tpc* / landmark* / dominatedArea / feedbackFromNeighbour / politicalConnection / otherObservation / finalStatus | … | (present) | MATCH | |

**No period keys in PI → no P0-A drift.** Clean per-key map (all MATCH).

**NOT-CONSUMED mobile keys:** `addressLocatable`, `flatStatus` (template prints hard-coded "the
flat was open/closed" per branch — `flatStatus` capture is unused). Low severity.

**Outcome-Branch Check (P0-B):** template branches = `"Positive & Door Open"`,
`"Positive & Door Locked"`, `"NSP & Door Open"`, `"NSP & Door Locked"`, `"ERT"`, `"Untraceable"`
(6 outcomes, NO Shifted). Mobile PI outcomes (`LegacyFormTemplateBuilders.ts:139-144`) =
`NSP`/`ENTRY_RESTRICTED`/`POSITIVE`/`UNTRACEABLE`. **No string overlap → FAIL.**

**Verdict: FAIL** (per-key map is PASS-clean, but total outcome-branch break).

---

## 6. PROPERTY_APF — `fieldReportDefaults.ts:1044-1152`

**Mobile keys (38):** addressLocatable, addressRating, constructionActivity, activityStopReason,
buildingStatus, projectName, projectStartedDate, projectCompletionDate, totalWing, totalFlats,
projectCompletionPercent, staffStrength, staffSeen, metPersonName, metPersonDesignation,
metPersonType, metPersonConfirmation, companyNamePlateStatus, nameOnBoard, callRemark, contactPerson,
tpcName1/2, tpcMetPerson1/2, tpcConfirmation1/2, locality, landmark1-4, dominatedArea,
feedbackFromNeighbour, politicalConnection, otherObservation, finalStatus, **finalStatusNegative**.

| Template sourceRef segment | columnKey | Mobile key | Verdict | Note |
|---|---|---|---|---|
| addressRating | address_rating | addressRating | MATCH | |
| constructionActivity | construction_activity | constructionActivity | MATCH | (drives `apfVacant`/`activityVerdict`) |
| activityStopReason | activity_stop_reason | activityStopReason | MATCH | |
| buildingStatus | building_status | buildingStatus | MATCH | |
| projectName | project_name | projectName | MATCH | |
| projectStartedDate / projectCompletionDate | project_started_date / project_completion_date | (present) | MATCH | |
| totalWing / totalFlats / projectCompletionPercent | … | (present) | MATCH | |
| staffStrength / staffSeen | … | (present) | MATCH | |
| metPersonName (+ ERT name_of_met_person) / metPersonDesignation / metPersonType / metPersonConfirmation | … | (present) | MATCH | |
| companyNamePlateStatus / nameOnBoard | … | (present) | MATCH | |
| callRemark / contactPerson | … | (present) | MATCH | |
| tpcName1/2 / tpcMetPerson1/2 | … | (present) | MATCH | APF uses `tpcPair`/`tpcName`/`tpcMetPerson` (no `tpcConfirmation` in body — those keys captured but NOT-CONSUMED) |
| locality / landmark1-4 / dominatedArea / feedbackFromNeighbour / politicalConnection / otherObservation / finalStatus | … | (present) | MATCH | |

**No period keys → no P0-A drift.** Per-key map all MATCH.

**NOT-CONSUMED mobile keys:** `addressLocatable`, `finalStatusNegative` (mobile-only; the template
reads `finalStatus` for the Negative verdict branch, never `finalStatusNegative` → the negative
verdict's nuance is captured but dropped from narrative — flag as a **narrative omission, P2**),
`tpcConfirmation1/2` (captured, not read by APF body).

**Outcome-Branch Check (P0-B + extra mismatch):** template branches = `"Positive"`, `"Negative"`,
`"ERT"`, `"Untraceable"` (lines 1090-1152). Mobile APF outcomes (`:145`) =
`UNTRACEABLE`/`ENTRY_RESTRICTED`/`POSITIVE` — **NO `Negative` code at all** (the APF label map at
`:88-92` even relabels POSITIVE → "Positive & Negative"). So besides the case/format mismatch, the
template's entire **Negative** branch (the construction-stopped/vacant prose, the richest part of
APF) is **structurally unreachable** — there is no negative outcome code. The `{{#if (apfVacant)}}`
split inside Negative is dead. FAIL.

**Verdict: FAIL** (per-key map clean; outcome-branch totally broken AND a missing Negative outcome).

---

## 7. BUILDER — `fieldReportDefaults.ts:1155-1347`

**Mobile keys (51):** addressLocatable, addressRating, **officeStatus**, metPersonName,
metPersonDesignation, **businessPeriodValue/Unit**, businessType, ownershipType,
companyNatureOfBusiness, officeApproxArea, addressStatus, nameOfCompanyOwners, staffStrength,
staffSeen, companyNamePlateStatus, nameOnBoard, documentShown, locality, addressStructure,
addressStructureColor, doorColor, addressFloor, callRemark, **oldOfficeShiftedPeriodValue/Unit**,
premisesStatus, currentCompanyName, **currentCompanyPeriodValue/Unit**, metPersonType,
metPersonConfirmation, businessExistsStatus, **businessExistance**, applicantWorkingStatus,
contactPerson, tpc*, landmark1-4, dominatedArea, feedbackFromNeighbour, politicalConnection,
otherObservation, finalStatus. (No `callConfirmation` in mobile — see DRIFT below.)

| Template sourceRef segment | columnKey | Mobile key | Verdict | Note |
|---|---|---|---|---|
| addressRating | address_rating | addressRating | MATCH | |
| officeStatus | office_status | officeStatus | MATCH | BUILDER uses `officeStatus` (not `businessStatus`) — matches mobile ✓ |
| metPersonName / designation→metPersonDesignation | … | (present) | MATCH | |
| **businessPeriod** | business_period | businessPeriodValue + …Unit | **DRIFT (P0-A)** | line 1164 |
| **businessType** | builder_type | businessType | MATCH | columnKey `builder_type`, ref `businessType` matches mobile ✓ |
| ownershipType / companyNatureOfBusiness / officeApproxArea | … | (present) | MATCH | |
| addressStatus | address_status | addressStatus | MATCH | "premises held" status — consumed |
| **nameOfCompanyOwners** | builder_name | nameOfCompanyOwners | MATCH | columnKey `builder_name`, ref matches |
| staffStrength / staffSeen / companyNamePlateStatus / nameOnBoard / documentShown | … | (present) | MATCH | |
| locality / addressStructure / addressStructureColor / doorColor / addressFloor | … | (present) | MATCH | |
| **callConfirmation** | call_confirmation | *(none)* | **MISSING-IN-MOBILE** | line 1182. BUILDER body calls `{{callRemark call_remark call_confirmation}}` (2-arg) but mobile BUILDER form does NOT emit `callConfirmation` → the "pickup call" sub-branch of `callRemark` (helpers.ts:220) can't fire. Low-impact (only the picked-up path), flag P2 |
| **oldOfficeShiftedPeriod** | old_office_shifted_period | oldOfficeShiftedPeriodValue + …Unit | **DRIFT (P0-A)** | line 1183 |
| premisesStatus | premises_status | premisesStatus | MATCH | |
| currentCompanyName | current_company_name | currentCompanyName | MATCH | |
| **currentCompanyPeriod** | current_company_period | currentCompanyPeriodValue + …Unit | **DRIFT (P0-A)** | line 1186 |
| metPersonType / metPersonConfirmation / businessExistsStatus / applicantWorkingStatus | … | (present) | MATCH | ERT branch |
| callRemark / contactPerson | … | (present) | MATCH | |
| tpc* / landmark* / dominatedArea / feedbackFromNeighbour / politicalConnection / otherObservation / finalStatus | … | (present) | MATCH | |

**NOT-CONSUMED mobile keys:** `addressLocatable`, `businessExistance` (misspelled twin). Low severity.

**Outcome-Branch Check (P0-B):** 8 verbose labels vs 5 codes → no match → FAIL.

**Verdict: FAIL** (3 period DRIFTs, 1 `callConfirmation` MISSING, total outcome-branch break).

---

## 8. DSA_CONNECTOR — `fieldReportDefaults.ts:1349-1537`

**Mobile keys (51):** addressLocatable, addressRating, officeStatus, metPersonName,
metPersonDesignation, **businessPeriodValue/Unit**, businessType, ownershipType,
companyNatureOfBusiness, nameOfCompanyOwners, addressStatus, officeApproxArea, staffStrength,
staffSeen, **activeClient**, companyNamePlateStatus, nameOnBoard, locality, addressStructure,
addressStructureColor, doorColor, addressFloor, callRemark, **oldOfficeShiftedPeriodValue/Unit**,
premisesStatus, currentCompanyName, **currentCompanyPeriodValue/Unit**, metPersonType,
metPersonConfirmation, businessExistsStatus, **businessExistance**, contactPerson, tpc*, landmark1-4,
dominatedArea, feedbackFromNeighbour, politicalConnection, otherObservation, finalStatus.

| Template sourceRef segment | columnKey | Mobile key | Verdict | Note |
|---|---|---|---|---|
| addressRating / officeStatus | … | (present) | MATCH | |
| metPersonName / designation→metPersonDesignation | … | (present) | MATCH | |
| **businessPeriod** | business_period | businessPeriodValue + …Unit | **DRIFT (P0-A)** | line 1359 |
| businessType / ownershipType / companyNatureOfBusiness | … | (present) | MATCH | |
| **nameOfCompanyOwners** | business_owner_name | nameOfCompanyOwners | MATCH | columnKey `business_owner_name`, ref matches |
| addressStatus | address_status | addressStatus | MATCH | premises-held — consumed |
| officeApproxArea / staffStrength / staffSeen | … | (present) | MATCH | |
| **activeClient** | active_client | activeClient | MATCH | the DSA-distinguishing field — consumed in Positive ✓ |
| companyNamePlateStatus / nameOnBoard | … | (present) | MATCH | |
| locality / addressStructure / addressStructureColor / doorColor / addressFloor | … | (present) | MATCH | |
| callRemark | call_remark | callRemark | MATCH | DSA body uses 1-arg `{{callRemark call_remark}}` — no callConfirmation needed ✓ |
| **oldOfficeShiftedPeriod** | old_office_shifted_period | oldOfficeShiftedPeriodValue + …Unit | **DRIFT (P0-A)** | line 1377 |
| premisesStatus / currentCompanyName | … | (present) | MATCH | |
| **currentCompanyPeriod** | current_company_period | currentCompanyPeriodValue + …Unit | **DRIFT (P0-A)** | line 1380 |
| metPersonType / metPersonConfirmation / businessExistsStatus | … | (present) | MATCH | ERT |
| contactPerson / tpc* / landmark* / dominatedArea / feedbackFromNeighbour / politicalConnection / otherObservation / finalStatus | … | (present) | MATCH | |

**NOT-CONSUMED mobile keys:** `addressLocatable`, `businessExistance` (misspelled twin),
`applicantWorkingStatus` is NOT a DSA mobile key and the DSA ERT branch does not read it (consistent).
Low severity.

**Outcome-Branch Check (P0-B):** 8 verbose labels vs 5 codes → no match → FAIL.

**Verdict: FAIL** (3 period DRIFTs, total outcome-branch break).

---

## 9. NOC — `fieldReportDefaults.ts:1539-1708`

**Mobile keys (42):** addressLocatable, addressRating, officeStatus, metPersonName,
metPersonDesignation, **nameOnNoc**, **flatNo**, **authorisedSignature**, locality, addressStructure,
addressStructureColor, doorColor, addressFloor, callRemark, **oldOfficeShiftedPeriodValue/Unit**,
currentCompanyName, **currentCompanyPeriodValue/Unit**, companyNamePlateStatus, nameOnBoard,
premisesStatus, metPersonType, metPersonConfirmation, officeExistsStatus, **businessExistance**,
contactPerson, tpc*, landmark1-4, dominatedArea, feedbackFromNeighbour, politicalConnection,
otherObservation, finalStatus. (No `callConfirmation` key — see DRIFT below.)

| Template sourceRef segment | columnKey | Mobile key | Verdict | Note |
|---|---|---|---|---|
| addressRating / officeStatus | … | (present) | MATCH | |
| metPersonName / designation→metPersonDesignation | … | (present) | MATCH | |
| nameOnNoc | name_on_noc | nameOnNoc | MATCH | NOC-specific — consumed in Positive ✓ |
| flatNo | flat_no | flatNo | MATCH | |
| authorisedSignature | authorised_signature | authorisedSignature | MATCH | |
| locality / addressStructure / addressStructureColor / doorColor / addressFloor | … | (present) | MATCH | |
| **callConfirmation** | call_confirmation | *(none)* | **MISSING-IN-MOBILE** | line 1558. NOC body uses 2-arg `{{callRemark call_remark call_confirmation}}` but mobile NOC form does NOT emit `callConfirmation` → "pickup call" sub-branch can't fire. Flag P2 |
| **oldOfficeShiftedPeriod** | old_office_shifted_period | oldOfficeShiftedPeriodValue + …Unit | **DRIFT (P0-A)** | line 1559 |
| currentCompanyName | current_company_name | currentCompanyName | MATCH | |
| **currentCompanyPeriod** | current_company_period | currentCompanyPeriodValue + …Unit | **DRIFT (P0-A)** | line 1561 |
| companyNamePlateStatus / nameOnBoard | … | (present) | MATCH | |
| premisesStatus | premises_status | premisesStatus | MATCH | |
| metPersonType / metPersonConfirmation / officeExistsStatus | … | (present) | MATCH | ERT |
| contactPerson / tpc* / landmark* / dominatedArea / feedbackFromNeighbour / politicalConnection / otherObservation / finalStatus | … | (present) | MATCH | |

**NOT-CONSUMED mobile keys:** `addressLocatable`, `businessExistance` (misspelled, unused in NOC).
Low severity.

**Outcome-Branch Check (P0-B):** 8 verbose labels vs 5 codes → no match → FAIL.

**Verdict: FAIL** (2 period DRIFTs, 1 `callConfirmation` MISSING, total outcome-branch break).

---

## Cross-cutting summary

| Type | Columns* | MATCH | DRIFT (P0-A periods) | MISSING-IN-MOBILE | Outcome-branch | Verdict |
|---|---|---|---|---|---|---|
| RESIDENCE | 42 fd | 39 | 2 (stayingPeriod, shiftedPeriod) | 1 (applicantStayingFloor) | FAIL (8 labels vs 5 codes) | **FAIL** |
| OFFICE | 50 fd | 46 | 4 (working/establishment/oldOfficeShifted/currentCompany Period) | 0 | FAIL | **FAIL** |
| BUSINESS | 50 fd | 47 | 3 (business/currentCompany/oldOfficeShifted Period) | 0 | FAIL | **FAIL** |
| RESIDENCE_CUM_OFFICE | 56 fd | 52 | 3 (staying/shifted/business Period) | 1 (applicantStayingFloor) | FAIL | **FAIL** |
| PROPERTY_INDIVIDUAL | 32 fd | 32 | 0 | 0 | FAIL (6 labels vs 4 codes) | **FAIL** |
| PROPERTY_APF | 36 fd | 36 | 0 | 0 | FAIL (no `Negative` code; Negative branch dead) | **FAIL** |
| BUILDER | 50 fd | 46 | 3 (business/oldOfficeShifted/currentCompany Period) | 1 (callConfirmation) | FAIL | **FAIL** |
| DSA_CONNECTOR | 50 fd | 47 | 3 (business/oldOfficeShifted/currentCompany Period) | 0 | FAIL | **FAIL** |
| NOC | 38 fd | 35 | 2 (oldOfficeShifted/currentCompany Period) | 1 (callConfirmation) | FAIL | **FAIL** |

\* "fd" = FORM_DATA_PATH columns only (the `outcome` + 3 APP/TASK columns excluded from MATCH math;
they resolve from case/applicant/task rows, not formData).

### The two systemic defects (both P0)

**P0-A — Composite period-key arity mismatch (DRIFT).** Mobile splits tenure into
`<period>Value` + `<period>Unit`; the template reads a single `<period>`. The single key is never
present → `{{pluralize <period>}}` renders empty. 7 distinct period stems, 20 DRIFT instances across
8 types:

| Template key (singular) | Mobile keys (split) | Types affected |
|---|---|---|
| `stayingPeriod` | `stayingPeriodValue` + `stayingPeriodUnit` | RESIDENCE, RCO |
| `shiftedPeriod` | `shiftedPeriodValue` + `shiftedPeriodUnit` | RESIDENCE, RCO |
| `businessPeriod` | `businessPeriodValue` + `businessPeriodUnit` | BUSINESS, RCO, BUILDER, DSA |
| `workingPeriod` | `workingPeriodValue` + `workingPeriodUnit` | OFFICE |
| `establishmentPeriod` | `establishmentPeriodValue` + `establishmentPeriodUnit` | OFFICE |
| `currentCompanyPeriod` | `currentCompanyPeriodValue` + `currentCompanyPeriodUnit` | OFFICE, BUSINESS, BUILDER, DSA, NOC |
| `oldOfficeShiftedPeriod` | `oldOfficeShiftedPeriodValue` + `oldOfficeShiftedPeriodUnit` | OFFICE, BUSINESS, BUILDER, DSA, NOC |

> Likely intended: mobile renders the pair as one display string (Value + " " + Unit). Either the
> backend must compose `<period>` = `<period>Value + ' ' + <period>Unit` before render, OR the
> template must read both keys (e.g. `{{pluralize (concat <period>Value " " <period>Unit)}}` — but
> there is no `concat` helper; see `helpers.ts:312-344`). Needs an owner decision; not fixable by a
> sourceRef rename alone (one ref can't read two keys).

**P0-B — Outcome vocabulary mismatch (branch break).** `{{#eq outcome "<verbose label>"}}` is strict
`===` (`helpers.ts:306-310`) against the mobile-stored code (`POSITIVE`/`SHIFTED`/`NSP`/
`ENTRY_RESTRICTED`/`UNTRACEABLE`). **No branch in any type ever matches → every report body renders
empty.** Two compounding sub-problems:
- **Granularity:** templates split each outcome into Door-Open vs Door-Locked (and APF into
  Positive vs Negative), but mobile collapses to a single code per outcome — so even a
  code→label map can't pick Open-vs-Locked without an extra signal (e.g. `houseStatus`/`officeStatus`).
- **APF has no `Negative`:** the richest APF branch is structurally unreachable (mobile APF outcomes
  are only POSITIVE/ENTRY_RESTRICTED/UNTRACEABLE; the negative narrative keys off `finalStatus`/
  `finalStatusNegative` which the branch selector never consults).

### Lower-severity findings
- **`applicantStayingFloor` MISSING** (RESIDENCE, RCO) — template reads `applicantStayingFloor` but
  mobile emits `addressFloor`. Floor sentence (`{{ordinal …}}`, `{{addressFloor …}}`) renders empty.
  Looks like a simple `ref` typo: should be `addressFloor`. **P1** (easy fix, isolated).
- **`callConfirmation` MISSING** (BUILDER, NOC) — body passes a 2-arg `callRemark` but these mobile
  forms don't emit `callConfirmation`; only the "pickup call" sub-path is lost. **P2**.
- **`finalStatusNegative` NOT-CONSUMED** (APF) — mobile captures a distinct negative-verdict string
  the narrative never prints. **P2** (narrative omission).
- **Misspelled `businessExistance` NOT-CONSUMED** (BUSINESS, BUILDER, DSA, NOC) — harmless twin of
  the read `businessExistsStatus`; no action needed (informational).
- **`addressLocatable`, `documentType` (RCO), `flatStatus` (PI), `officeExistence` (OFFICE)** —
  captured but never read by prose; the generic `#6` raw-section flattener still shows them.
  Informational, not defects.

### Bottom line
The per-key camelCase **mapping is sound** (the `sourceRef` segments are correctly camelCase and
match the mobile keys ~100%) — the headline fear of snake_case drift is FALSE. But the report is
**non-functional end-to-end** because of two orthogonal P0s that live outside the per-key mapping:
the **outcome branch vocabulary** (every body empty) and the **period-key arity** (every tenure
sentence empty). Both must be resolved by an owner decision (code→label + Open/Locked signal for
P0-B; period composition for P0-A) before any FIELD_REPORT renders correctly for a real device
submission. All 9 types = **FAIL**.
