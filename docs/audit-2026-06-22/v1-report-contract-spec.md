# v1 Report-Generation Contract — extraction for the CRM2 v2 FIELD_REPORT port

**Date:** 2026-06-22 · **Mode:** READ-ONLY audit of v1 · **Scope:** outcome-label derivation, period handling, field mapping, APF/PIV body selection.

**v1 source (READ-ONLY):** `/Users/mayurkulkarni/Downloads/CRM-APP-MONOREPO-PROD/CRM-BACKEND/src`
**v2 port:** `apps/api/src/modules/fieldReports/helpers.ts` (grammar helpers) · `packages/sdk/src/fieldReportDefaults.ts` (default templates + column catalogs) · `apps/api/src/modules/fieldReports/render.ts` (renderer).

---

## 0 — THE CENTRAL FACT (read this before anything else)

**In v1 the `outcome` passed to the template engine is the FULL VERBOSE LABEL, not a code.** The mobile app wrote the verbose string (e.g. `"Positive & Door Open"`, `"Shifted & Door Locked"`, `"NSP & Door Locked"`, `"ERT"`, `"Untraceable"`, `"Positive"`/`"Negative"` for APF) straight into `verification_reports.verification_outcome`, and the report controller reads it back verbatim:

- `controllers/templateReportsController.ts:129` — `let outcome = caseData.verificationOutcome;`
- then per type it is overwritten from the report row, e.g. `:156` `outcome = residenceData.verificationOutcome;`, `:236` office, `:324` business, etc.
- that `outcome` flows into `services/TemplateReportService.ts:1397` `getTemplate(...)` and `:1456`/`:1507` `getTemplateKey(verificationType, outcome, formData)`.

`getTemplateKey` (`TemplateReportService.ts:1507-1987`) therefore does **string matching on the verbose label first** (`outcomeNormalized.includes('door open')` / `includes('door lock')` / `includes('positive')`…). The `houseStatus`/`officeStatus`/`businessStatus`/`flatStatus`/`resiCumOfficeStatus` reads are only **fallbacks** that fire when the verbose label does NOT already carry "Door Open"/"Door Locked".

**Where v1 *did* derive the verbose label from (code + status field):** `utils/formTypeDetection.ts` → `detectFormTypeEnhanced` (`:446-554`), "Method 1: Direct outcome mapping". Given a code-ish `outcome` and the per-type door field, it produces the verbose label:

- `formTypeDetection.ts:469-479` — the canonical per-type door-field map (THE key table, reproduced below).
- `:482` `isOpened = statusField.toLowerCase() === 'open'`.
- `:484-501` — `POSITIVE`+open → `"Positive & Door Open"`, else `"Positive & Door Locked"`; same for `SHIFTED`/`NSP`. (`ERT`/`UNTRACEABLE`/`NEGATIVE` carry no door variant.)

**v2 port status:** the v2 default templates (`fieldReportDefaults.ts`) branch on `{{#eq outcome "Positive & Door Open"}}` — i.e. they ALSO expect the verbose label — and the `outcome` column is bound to `sourceRef: '<slug>.verificationOutcome'` (`fieldReportDefaults.ts:67-73`, `96-102`). **But the v2 device now submits a 5-value CODE (`POSITIVE`/`SHIFTED`/`NSP`/`ENTRY_RESTRICTED`/`UNTRACEABLE`) in `verificationOutcome` plus a per-type status field.** So unless the v2 backend derives the verbose label, EVERY `{{#eq}}` branch misses → blank narrative. **THIS IS THE GAP TO FIX.** The derivation rule below is exactly v1's `detectFormTypeEnhanced` Method 1 + `getTemplateKey` fallback.

---

## 1 — CROSS-TYPE "Open/Closed driver field per type" SUMMARY (THE #1 deliverable)

The single field per type that carries Open vs Closed/Locked, and its literal values. Source: `formTypeDetection.ts:469-479` (and re-asserted at `:532-541`), cross-checked against `getTemplateKey` fallbacks.

| Type | Door/status field (camelCase device key) | snake fallback v1 also reads | Literal value meaning "Door Open" | Any other value (incl. absent) ⇒ |
|---|---|---|---|---|
| RESIDENCE | `houseStatus` | `house_status` | `"Open"` (case-insensitive `=== 'open'`) | Door Locked |
| OFFICE | `officeStatus` | `office_status` | `"Open"` | Door Locked |
| BUSINESS | `businessStatus` | `business_status` | `"Open"` | Door Locked |
| BUILDER | `officeStatus` | `office_status` | `"Open"` | Door Locked |
| NOC | `officeStatus` | `office_status` | `"Open"` | Door Locked |
| DSA_CONNECTOR | `officeStatus` | `office_status` | `"Open"` | Door Locked |
| RESIDENCE_CUM_OFFICE | `resiCumOfficeStatus` (Method-1 map) — and in the `getTemplateKey` fallback EITHER `houseStatus` OR `officeStatus`, each also falling back to `resiCumOfficeStatus` | `resi_cum_office_status`/`house_status`/`office_status` | `"Open"` on the resolved field | Door Locked |
| PROPERTY_INDIVIDUAL | `flatStatus` (Method-1 map) — `getTemplateKey` reads `flatStatus \|\| premises_status` | `premises_status` | `"Open"` | Door Locked |
| PROPERTY_APF | **NO door field** — split is by `constructionActivity`, see §APF | — | — | — |

**Literal values:** the only "open" literal is `"Open"` (compared lowercased: `=== 'open'`). Everything else — `"Closed"`, `"Locked"`, missing, empty — maps to the **Locked** branch. (Mobile emits `"Open"` / `"Closed"`; the v1 code comments at `:1934-1937`,`:1960-1962` warn that comparing to `"opened"` was a bug — it's `"open"`.)

> **v2 build note:** `formTypeDetection.ts:469-479` deliberately does NOT use a generic `houseStatus || officeStatus || businessStatus` chain, because RC's `businessStatus` carries an ENTITY TYPE (`'Self Employee - Proprietorship'`), not a door state (comment at `:466-468`). Port the per-type map EXACTLY; never `||`-chain across types.

---

## 2 — OUTCOME → VERBOSE LABEL DERIVATION RULE (port this to the v2 backend)

Pseudocode, faithful to `detectFormTypeEnhanced` Method 1 (`formTypeDetection.ts:460-507`) + the `getTemplateKey` type fallbacks:

```
deriveOutcomeLabel(type, code, formData):
  C = code.toUpperCase()                       # POSITIVE|SHIFTED|NSP|ENTRY_RESTRICTED|UNTRACEABLE (+NEGATIVE for APF/PIV)

  if type == PROPERTY_APF:                      # no door; 4 template branches
     if C in {ENTRY_RESTRICTED}            -> "ERT"
     if C == UNTRACEABLE                   -> "Untraceable"
     if C == NEGATIVE                      -> "Negative"   # VACANT vs STOP split happens INSIDE the template via apfVacant(construction_activity)
     else                                  -> "Positive"

  if type == PROPERTY_INDIVIDUAL:              # 4 outcomes, NO Shifted
     if C == ENTRY_RESTRICTED              -> "ERT"
     if C == UNTRACEABLE                   -> "Untraceable"
     doorOpen = (formData.flatStatus ?? formData.premises_status).toLowerCase() == 'open'
     if C == NSP                           -> doorOpen ? "NSP & Door Open"      : "NSP & Door Locked"
     else (POSITIVE)                       -> doorOpen ? "Positive & Door Open" : "Positive & Door Locked"

  else (the 7 "door" families: RESIDENCE, OFFICE, BUSINESS, BUILDER, NOC, DSA_CONNECTOR, RESIDENCE_CUM_OFFICE):
     if C == ENTRY_RESTRICTED              -> "ERT"
     if C == UNTRACEABLE                   -> "Untraceable"
     doorField = DOOR_FIELD_BY_TYPE[type]              # see §1 table
     doorOpen  = (formData[doorField]).toLowerCase() == 'open'   # RCO: open if house OR office resolves to 'open'
     if C == POSITIVE                      -> doorOpen ? "Positive & Door Open" : "Positive & Door Locked"
     if C == SHIFTED                       -> doorOpen ? "Shifted & Door Open"  : "Shifted & Door Locked"
     if C == NSP                           -> doorOpen ? "NSP & Door Open"      : "NSP & Door Locked"
```

**Exact verbose strings the v2 templates `{{#eq}}` against** (must match byte-for-byte — `fieldReportDefaults.ts`):
`"Positive & Door Open"`, `"Positive & Door Locked"`, `"Shifted & Door Open"`, `"Shifted & Door Locked"`, `"NSP & Door Open"`, `"NSP & Door Locked"`, `"ERT"`, `"Untraceable"` — plus APF's `"Positive"` / `"Negative"`.

> ⚠️ **String-casing trap:** v1's `getVerificationOutcome`/`UNIVERSAL_OUTCOME_MAPPING` used the abbreviations `"Shifted & Door Lock"` and `"NSP & Door Lock"` (without the trailing **-ed**) in several low-confidence paths (`formTypeDetection.ts:104,120-130,163-180,241,690-692`). **The v2 default templates use the `…Door Locked` (with -ed) spelling** (`fieldReportDefaults.ts:216,253,408,...`). When you derive labels for v2, ALWAYS emit `Locked` (with -ed) — do not copy the `Lock` abbreviation.

### Branch coverage per type (what the v2 templates contain — all already present)
- RESIDENCE / OFFICE / BUSINESS / BUILDER / DSA_CONNECTOR / NOC / RESIDENCE_CUM_OFFICE → **8 branches**: Positive·DoorOpen/Locked, Shifted·DoorOpen/Locked, NSP·DoorOpen/Locked, ERT, Untraceable.
- PROPERTY_INDIVIDUAL → **6 branches**: Positive·DoorOpen/Locked, NSP·DoorOpen/Locked, ERT, Untraceable (NO Shifted).
- PROPERTY_APF → **4 branches**: Positive, Negative (vacant/stop chosen inside the template), ERT, Untraceable.

---

## 3 — PERIOD HANDLING

**v1 stored periods as a SINGLE combined string** like `"6 Year"` (value + space + unit) in `stayingPeriod`/`workingPeriod`/`businessPeriod`/`shiftedPeriod`/`oldOfficeShiftedPeriod`/`currentCompanyPeriod`/`establishmentPeriod` etc. There was **no value/unit split on the v1 device.** The only transform was a pluralization tidy at render time.

**v1 join/pluralize rule — `pluralizePeriod` (`TemplateReportService.ts:2469-2479`):**
```
input "6 year"  -> "6 Years"
input "1 year"  -> "1 Year"
input "6 Years" -> "6 Years"   (idempotent)
regex: /^(\d+(?:\.\d+)?)\s+(year|month|day|week)s?$/i
  -> "<num> <Unit>" if num == 1 else "<num> <Units>"  (Unit = capitalized)
  -> if NO match, return the raw string unchanged.
```
Applied at `:2580` (Staying_Period), `:2717` (Shifted_Period), `:2753` (Working_Period), `:2885` (Old_Office_Shifted_Period), `:2894`/`:2905` (Current_Company_Period), `:3078` (Business_Period), `:3095` (Old_Business_Shifted_Period), `:3100` (Establishment_Period).

**v2 port status:** `pluralize` helper at `helpers.ts:26-34` is byte-identical to `pluralizePeriod`. Templates call `{{pluralize staying_period}}` etc.

**v2 RECOMBINE REQUIREMENT (the device changed):** the v2 device now submits **split** `<period>Value` + `<period>Unit`. The catalog columns bind to the COMBINED key (`stayingPeriod`, `shiftedPeriod`, `workingPeriod`, `businessPeriod`, `oldOfficeShiftedPeriod`, `currentCompanyPeriod`, …). So the v2 backend must **recombine `value + ' ' + unit` into the combined key BEFORE render**, e.g. `stayingPeriod = `${stayingPeriodValue} ${stayingPeriodUnit}``, then `pluralize` finishes the job (`"6 year"`→`"6 Years"`). Do NOT pluralize/normalize the unit yourself — feed the raw `"<value> <unit>"` and let `pluralize` do it. Empty value ⇒ leave the combined key empty (render shows nothing, v1 parity).

---

## 4 — FIELD-MAPPING ANOMALIES the v2 port must replicate

All v1 mappings live in `TemplateReportService.mapFormDataToTemplateVariables` (`~:2540-3170`); each token uses `safeGet(formData, primary) || safeGet(formData, alias)`.

### 4.1 Floor field (the floor clause)
- **RESIDENCE / RESIDENCE_CUM_OFFICE** → primary key **`applicantStayingFloor`** (fallbacks `addressFloor` → `floor` → `'Ground'`). v1 `Applicant_Staying_Floor` = `ordinal(applicantStayingFloor || addressFloor || floor || 'Ground')` (`:2628-2633`).
- **OFFICE / BUSINESS / BUILDER / NOC / DSA / PROPERTY_INDIVIDUAL** → primary key **`addressFloor`**. The floor SENTENCE token `Address_Floor_Sentence` = `addressFloorSentence(addressFloor || applicantStayingFloor || floor)` (`:2724-2729`, helper `:2249-2257`).
- `addressFloor`/`addressFloorSentence` helper: empty → `''` (omit, no fabricated "Ground"); `"Ground"`/`"G"`/`"0"` → `"ground floor"`; numeric → `ordinal` (`helpers.ts:177-183`).
- **v2 parity: MATCHES.** RESIDENCE/RCO templates feed `applicant_staying_floor` (`fieldReportDefaults.ts:174,208,769,...`); OFFICE/BUSINESS/PI/NOC/DSA feed `address_floor` (`:352,545,942,1405,1588,...`). The catalog binds the right per-type key (`F('applicant_staying_floor',…,'applicantStayingFloor')` `:128`; `FD(slug,'address_floor',…,'addressFloor')` `:324,518,921,...`). No change needed.

### 4.2 callConfirmation / callRemark pairing (Untraceable + Door-Locked telephonic clauses)
- v1 token `Call_Remark` = `callRemarkText(callRemark || phoneCallRemark, callConfirmation) || 'the call did not go through'` (`:2699-2703`).
- The pairing: `callRemark` is the dial result; when it is `"Pickup Call ..."`, the prose is taken from **`callConfirmation`** (the second field). See v1 `callRemarkText`/`callConfirmationText` ≙ ported `callRemark`+`callConfirmation` helpers (`helpers.ts:195-222`): `callRemark` starts-with `'pickup call'` ⇒ delegates to `callConfirmation(confirmation)`; empty ⇒ `'the call did not go through'`.
- **v2 parity: MATCHES** — helper is ported; templates call `{{callRemark call_remark call_confirmation}}` (e.g. `fieldReportDefaults.ts:1607`). Both `call_remark` (`callRemark`) and `call_confirmation` (`callConfirmation`) catalog columns exist (`:138-139`). **Ensure both device keys reach formData** — the derivation must NOT drop `callConfirmation`.

### 4.3 APF verdict fields (finalStatus / finalStatusNegative / constructionActivity)
- `Construction_Activity` = `constructionActivity || construction_activity` (`:3128-3129`).
- `Activity_Verdict_Sentence` (POSITIVE template, SEEN path) = `activityVerdictSentence(constructionActivity, finalStatus || final_status || finalStatusNegative, metPersonName, metPersonDesignation||designation, otherObservation)` (`:3133-3143`).
- `Verdict_Override_Note` (NEGATIVE_STOP + NEGATIVE_VACANT) = `verdictOverrideNote(constructionActivity, finalStatus || final_status || finalStatusNegative, otherObservation)` (`:3147-3153`).
- **Key insight:** the APF verdict is read from **`finalStatus` (alias `final_status`), and if absent `finalStatusNegative`.** Both Positive-form and Negative-form verdict fields collapse into one resolved value. Values are lowercased and compared to `positive`/`negative`/`refer`/`fraud` (helpers `activityVerdict` `:250-272`, `verdictOverride` `:275-290`).
- **v2 parity: helpers ported** (`activityVerdict`, `verdictOverride` in `helpers.ts`). The APF template feeds `{{activityVerdict construction_activity final_status met_person_name met_person_designation other_observation}}` and `{{verdictOverride construction_activity final_status other_observation}}` (`fieldReportDefaults.ts:~1093,~1108`). **GAP TO CHECK:** v2's APF catalog must bind `final_status` so it resolves from `finalStatus || finalStatusNegative` (the device may send `finalStatusNegative` on a Negative). If the catalog only binds `finalStatus`, a Negative-form verdict could be lost — verify the APF column catalog includes a `final_status` column whose source falls back to `finalStatusNegative`, or fold that fallback into the pre-render formData normalization.

### 4.4 Other token-name ≠ raw-key notables (replicate via aliases)
- `House_Status` = `houseStatus || resiCumOfficeStatus || doorStatus` (`:2712-2716`).
- `Office_Status` = `officeStatus || resiCumOfficeStatus || office_status` (`:2739-2743`).
- `Locality` = `locality || localityType` (`:2624`).
- TPC: `TPC_Met_Person_1` = `tpcMetPerson1 || tpcMetPerson` (`:2645`); same first/second pairing for names/confirmations. Direct property access (not `safeGet`) so the `||` alias chain can reach (comment `:2641-2643`).
- Nameplate booleans keyed off `/^sighted/i` of `doorNamePlateStatus` / `companyNamePlateStatus` / `societyNamePlateStatus` (`:2597-2621`).
- Most of these are already covered by the ported helpers + catalog. The load-bearing one for the OUTCOME derivation is `House_Status`/`Office_Status`'s `resiCumOfficeStatus` fallback (RCO).

---

## 5 — APF & PROPERTY_INDIVIDUAL BODY SELECTORS (precise)

### PROPERTY_APF — `getTemplateKey` `:1518-1544`
Order of checks (on the verbose/normalized `outcome`):
1. `outcome` contains `ert` / `=== 'ert'` / contains `restrict` → **ERT**.
2. contains `untraceable` → **UNTRACEABLE**.
3. contains `negative` → split by **`constructionActivity` (alias `construction_activity`), uppercased**:
   - `.includes('VACANT')` → **NEGATIVE_VACANT** (`:1537-1538`).
   - else (incl. `CONSTRUCTION IS STOP` and any unspecified) → **NEGATIVE_STOP** (`:1540-1541`).
4. otherwise → **POSITIVE**.

**Driver field for the Negative split = `constructionActivity` (NOT finalStatus).** `finalStatus`/`finalStatusNegative` only tune the *prose* (verdict-coherence note), never which body is selected.

**v2 port:** folds VACANT/STOP into ONE `"Negative"` template branch, choosing inside via `{{#if (apfVacant construction_activity)}}` (`helpers.ts:300`, `fieldReportDefaults.ts:~1107`). So v2 only needs the 4 labels `Positive`/`Negative`/`ERT`/`Untraceable`; the vacant-vs-stop choice is template-internal and keyed on the same `constructionActivity.includes('VACANT')` rule. **MATCHES** — just make sure `construction_activity` reaches the context for both the `apfVacant` `#if` and the `activityVerdict`/`verdictOverride` helpers.

### PROPERTY_INDIVIDUAL — `getTemplateKey` `:1547-1591`
1. `ert`/`restrict` → **ERT**. 2. `untraceable` → **UNTRACEABLE**.
3. `nsp`: if outcome says `door open`→NSP_DOOR_OPEN; `door lock`/`door locked`→NSP_DOOR_LOCKED; **else fallback on `flatStatus || premises_status` (`=== 'open'` → open, else locked)** (`:1560-1574`).
4. `positive`: same door-open/locked string check, **else fallback on `flatStatus || premises_status`** (`:1575-1588`).
5. default → POSITIVE_DOOR_OPEN.
**No SHIFTED branch.** Driver door field = **`flatStatus`** (fallback `premises_status`). **v2 templates: 6 branches, no Shifted — MATCHES.**

---

## 6 — PER-TYPE QUICK REFERENCE (outcome-derivation · period join · field notes)

For every type: the verbose-label derivation is §2; the period join is §3 (`pluralize`, recombine split value+unit); floor key is §4.1. Type-specific door field is §1.

| Type | # branches | Door field | Floor key | Period keys present | v2 status |
|---|---|---|---|---|---|
| RESIDENCE | 8 | `houseStatus` | `applicantStayingFloor` | `stayingPeriod`,`shiftedPeriod` | templates+helpers MATCH; needs label-derive + period-recombine |
| OFFICE | 8 | `officeStatus` | `addressFloor` | `workingPeriod`,`oldOfficeShiftedPeriod`,`currentCompanyPeriod` | MATCH; needs derive+recombine |
| BUSINESS | 8 | `businessStatus` | `addressFloor` | `businessPeriod`,`oldBusinessShiftedPeriod`,`establishmentPeriod` | MATCH; needs derive+recombine |
| BUILDER | 8 | `officeStatus` | `addressFloor` | office/builder periods | MATCH; needs derive+recombine |
| NOC | 8 | `officeStatus` | `addressFloor` | office periods | MATCH; needs derive+recombine |
| DSA_CONNECTOR | 8 | `officeStatus` | `addressFloor` | business/office periods | MATCH; needs derive+recombine |
| RESIDENCE_CUM_OFFICE | 8 | `resiCumOfficeStatus` (house OR office open) | `applicantStayingFloor` | `stayingPeriod`,`businessPeriod`,shifted | MATCH; **RCO open = house OR office**; needs derive+recombine |
| PROPERTY_APF | 4 (Pos/Neg/ERT/Untrace; Neg split internal) | none → `constructionActivity` | `addressFloor` | n/a | MATCH; verify `final_status` falls back to `finalStatusNegative` |
| PROPERTY_INDIVIDUAL | 6 (no Shifted) | `flatStatus` (`premises_status`) | `address_floor` | n/a | MATCH; needs derive (no recombine) |

---

## 7 — NET PORT WORK (what's missing in v2 vs v1)

1. **[CRITICAL] Verbose-label derivation.** The v2 device sends a CODE in `verificationOutcome`; the templates expect the verbose label. Implement `deriveOutcomeLabel(type, code, formData)` per §2 on the CRM backend and make the `outcome` column resolve to the derived label (either: derive into formData before render so `<slug>.verificationOutcome` becomes verbose, or add a derived column). Port the per-type door-field map from `formTypeDetection.ts:469-479` verbatim. Always emit `…Door Locked` (with -ed).
2. **[CRITICAL] Period recombination.** Device now splits `<period>Value`+`<period>Unit`; templates bind the combined key. Recombine `value + ' ' + unit` into the combined key before render; `pluralize` then finishes. (§3)
3. **[VERIFY] APF `final_status` fallback.** Ensure the APF render context resolves `final_status` from `finalStatus || finalStatusNegative` so a Negative-form verdict isn't lost (§4.3).
4. **[VERIFY] callConfirmation reaches context** alongside callRemark (§4.2).
5. Everything else — grammar helpers, floor per-type keys, TPC pairing, nameplate booleans, APF vacant/stop internal split, PIV no-Shifted — is **already a faithful port** in `helpers.ts` + `fieldReportDefaults.ts`. No change.
