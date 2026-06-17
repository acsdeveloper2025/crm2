# Zion Lifecycle Audit — what the competitor does simpler/better

**Date:** 2026-06-15 · **Mode:** READ-ONLY audit. No Zion system accessed, no CRM2 code touched.
**Method:** synthesis of the 2026-06-04 Zion reverse-engineering audit series (5 docs). Every claim cites `doc · section`.
**Sources (relative to `docs/acs-simplification-audit-2026-06-04/`):**
- **[ZRE]** `ZION_CRM_REVERSE_ENGINEERING_AUDIT_2026-06-04.md`
- **[WRA]** `ACS_VS_ZION_WORKFLOW_REPLACEMENT_AUDIT_2026-06-04.md`
- **[OOA]** `ACS_2.0_VS_ZION_OPERATIONAL_OWNERSHIP_AUDIT_2026-06-04.md`
- **[PBP]** `ACS_VS_ZION_PAGE_BY_PAGE_AUDIT_2026-06-04.md`
- **[WCA]** `ZION_INSPIRED_WORKSPACE_CONSOLIDATION_AUDIT_2026-06-04.md`

**Subject (verified):** "ZION GROUP" CRM — ASP.NET WebForms + Cordova field-verification/background-check system (v12.1, 2022-2023), plain HTTP at `103.44.51.72`/`ziongroup.co.in`; captured as single back-office account `AXISUSER` [ZRE · header + §Platform/version facts]. Vendor = RTONS [ZRE · Addendum §Org].

---

## 1. CASE / VISIT LIFECYCLE STATE MACHINE (reconstructed)

**The entire lifecycle is a flat 3-bucket pipeline shown as live header counters on every authenticated page:**

```
CASE BUCKET ──assign docs──▶ CASE ASSIGN ──field submit + FINAL STATUS + CASE REPORT──▶ CASE COMPLETED
   (new, unassigned)            (dispatched)                                              (closed + PDF)
        └────────────────── DELETE CASE ──▶ TRASH (recoverable via RECOVER) ──────────────────┘
```
[ZRE · §4 Status Lifecycle Diagram; §Platform/version facts confirms counters live on every page, values drifted bucket 0 / assign 9–15 / completed 8–13]

**Three states. That is the whole state machine.** Everything else is a **flat attribute/tag, not a transition-guarded status** [ZRE · §4]:
- **VISIT TYPE** per document: `NEW VISIT | RE VISIT | SAME VISIT | NO VISIT` (NO VISIT = desk/office verification) [ZRE · §4; Addendum §Operational ownership — desk-vs-field split].
- **DISTANCE:** `LOCAL | OGL1 | OGL2`; **BILL:** `YES | NO` [ZRE · §4].
- **ROW/CASE STATUS tag:** blank | `CREDIT REFER` [ZRE · §4].
- **DEDUPE:** `NO MATCH FOUND | NEUTRAL | RECOMMENDED` [ZRE · §4].
- **PRODUCT TAG:** AXIS MIS / AXIS REFER MIS / … (~20) [ZRE · §4].

**Who moves it / screens involved** [ZRE · §3 Backend workflow; OOA · §QC model; OOA · NEW PRIMARY EVIDENCE activity log]:
- **BUCKET → ASSIGN:** the single **back-office operator** (`AXISUSER` / "GUJWALA SHINDE" in the log) creates the case on `NewDataEntry.aspx` (mandatory dedupe → `NEW CASE ENTRY` mints `DataEntryMainId` → add N documents), then on `NewDataQC.aspx` clicks per-document **ASSIGN** ⇒ `CASE ASSIGN++`.
- **ASSIGN → field work:** field executives (Chaitanya, Arun) do per-document site visits on the Cordova app, capture geotagged watermarked photos, submit back [ZRE · §2; OOA · NEW PRIMARY EVIDENCE].
- **ASSIGN → COMPLETED:** the **same back-office operator** writes the remark, picks **FINAL STATUS**, clicks **CASE REPORT** ⇒ `CASE COMPLETED++` + client PDF, all on `NewDataQC.aspx` [ZRE · §3; PBP · Phase 1 row 4].

**Screens that touch the lifecycle:**
- **`NewDataQC.aspx`** = the master work surface and true operational center — data entry, document assignment, photo receipt, remark, FINAL STATUS, CASE REPORT, dedupe, activity log, all save-gated top-to-bottom on ONE page [ZRE · §1 row 4, §Addendum full panel inventory; OOA · §Operational center].
- **`BVisitsApprove.aspx` (Case Visits):** visit-level list — `CASE NAME | VISIT | CASE EXECUTIVE | CASE VISIT FOR`, per-visit NEW/RE/SAME · LOCAL · SOURCE=SYSTEM · `STATUS=COMPLETE`. A **visit tracking/approval list, not a separate approval gate** [ZRE · §1 row 6, §Addendum Supporting screens].
- **`CaseQCList.aspx` (Case Trash List):** soft-deleted cases `DATE | CUSTOMER | PAN | BRANCH | STATUS | RECOVER` — DELETE CASE → Trash → RECOVER, with a hard "never delete visit-completed cases" guard from the notice board [ZRE · §1 row 10, §7, §Addendum].
- **SHOW HISTORY:** inline activity log `timestamp · executive · "<customer> <event>"` (e.g. "CASE ASSIGN", "OFFICE PROFILE … REPORT SUBMITTED") — the audit trail [ZRE · §3, §Addendum §Operational ownership].

**Unit of work = the DOCUMENT, not the case.** Case = customer + N documents; each document is independently assigned (a 5-doc case = 5 assign panels) and the document is the unit of billing/visit-count [ZRE · §7; WRA · §1]. `VISIT COUNT` (field-visited docs) < `TOTAL PROFILE & DOCS` because NO-VISIT desk docs (ITR, FINANCIALS, PAN-with-photo → "OFFICE EXECUTIVE") aren't site visits [ZRE · Addendum §desk-vs-field split].

---

## 2. RESULT MODEL — one field, one operator, one QC page

**Exactly ONE result field: `FINAL STATUS`** (e.g. POSITIVE; implied NEGATIVE/REFER), a dropdown in the `NewDataQC` footer set at report-generation time [ZRE · §4, §5; PBP · Phase 4 Critical]. Per-document there is also a `CASE STATUS` dropdown in each remark-format block, but the **case-level FINAL STATUS is the single official result printed on the client PDF** [ZRE · §Addendum NewDataQC panel inventory + CPV/LRV report].

**Where recorded / who records it:** the back-office operator picks FINAL STATUS and clicks CASE REPORT on the same `NewDataQC` page they built and assigned the case on. **One human in the result loop; no second-person review/approve/reject step exists** [ZRE · §3, §7; OOA · NEW PRIMARY EVIDENCE + §QC model]. The sealed PDF carries the result + **named verifier + agency name + authorized-signatory seal + bottom-watermarked geo photos** [ZRE · §5, §Addendum CPV/LRV report] — legal attribution CRM2 lacks.

**Coherence by construction:** the report's STATUS and FINAL STATUS agree because the operator sets one value once. **One result, printed once** [ZRE · §5].

**Contrast — our result-fragmentation problem:** CRM2 carries **four** result columns — `verification_reports.final_status` (FE, immutable), `task_backend_reviews.backend_final_result` (company, append-only), `verification_tasks.verification_outcome` (read-mirror), `cases.verification_outcome` (stale, rogue). The client report prints the **stale `cases.verification_outcome`**, proven divergent in prod on VT-000199 (FE *Refer* / company *Positive* / case-header *Untraceable*) [WRA · §3; ZRE · §8 Result row, §"Q6"]. The bank's own MIS export confirms a richer-but-still-coherent three-tier status (CPV status · document/LRV status · OVERALL CASE STATUS) [ZRE · Addendum §SECOND PASS .xls 95-col schema] — Zion maps all three off the same operator decision; CRM2 lets four columns drift.

**Minimum architecture (audit verdict):** CRM2 needs only **TWO** — the immutable FE opinion (dispute evidence, which Zion lacks) + **one official result** (backend-else-FE) that the report prints. Zion's single coherent result is the goal; CRM2 should keep the FE evidence layer Zion never had [WRA · §3].

---

## 3. REVISIT / RECHECK / REWORK EQUIVALENT

- **Revisit = add another document to the same case.** No cloned task, no separate lifecycle — explicitly per the on-screen notice board ("add new document in same case for REVISIT") [ZRE · §4, §7, §Addendum §Operational ownership]. The bank MIS even has a `REVISIT` document-count column [ZRE · Addendum §SECOND PASS .xls].
- **Recheck / reassignment = re-open the document's ASSIGN panel and pick a different executive** (per-document); set `VISIT TYPE = RE VISIT | SAME VISIT` [ZRE · §7; OOA · §QC model].
- **No rework/return loop.** "Refer" is **not** a rework state — it is a routing/billing tag: the `CREDIT REFER` per-document tag and the `AXIS REFER MIS` product bucket. Cases still flow assign → submit → report; REFER never blocks completion [ZRE · §4, §7; OOA · §QC model].
- **Client-side taxonomy** (from bank MIS `CASE TYPE`): `FRESH / CREDIT REFER / RE-VERIFICATION / RENEWAL` — Zion's revisit/recheck vocabulary, which CRM2 maps to NORMAL/REVISIT/recheck [ZRE · Addendum §SECOND PASS implication 2].

**Contrast:** CRM2 revisit = **clone-to-new-task** (`parent_task_id` lineage, own rate snapshot, own result). The audits judge **CRM2's model genuinely BETTER** for audit/billing/commission/dispute (a revisit is a separately provable, separately billable record; prod has 4 REVISIT tasks, 127 commission calcs) — borrow only Zion's *one-click ergonomics*, not its add-a-document model [WRA · §4; OOA · §Top-50-keep #5].

---

## 4. BILLING / MIS TOUCHPOINT IN THE LIFECYCLE

- **Billing is derived inline at assignment/QC time — there is no separate billing step or rate engine.** Choosing a Case Area autocompletes → derives `LOCAL/OGL1/OGL2` + visit type + billable distance; per-document `BILL Y/N` + `ADD FOR BILLING` + visit-count columns sit right on the `NewDataQC` assign grid; data-entry fields flagged pink = "USED FOR BILLING MIS" [ZRE · §3, §5, §7, §Addendum NewDataQC inventory; OOA · NEW PRIMARY EVIDENCE].
- **MIS/Billing = one-click Excel exports**, separate from the lifecycle: `ExportTrigger.aspx` (company + date → DOWNLOAD MIS) and `ExportReport.aspx` (portfolio + multi-branch → DOWNLOAD MIS) [ZRE · §1 rows 8–9, §5]. `VisitCounts.aspx` reconciles per-executive LOCAL/OGL1/OGL2 visit billing [ZRE · §Addendum Supporting screens].
- **The bank-mandated MIS schema = 95 columns** incl. TWO TAT pairs (CPV initiation→revert, sampling→revert), three-tier status, CPC CENTRE/CITY/REGION/ZONE geography, LOS APPLICATION ID, named verifier ×2, + ~45 per-document count columns — Zion exports exactly this off the same operator data [ZRE · Addendum §SECOND PASS .xls schema].
- **Because billing is computed from the operational action, MIS and finance cannot diverge** [ZRE · §8 Billing/MIS rows].

**Contrast:** CRM2 has a `rates × rate_type_assignments × service_zone_rules` engine (area→rate_type indirection) + commission + an **invoice/GST layer that has NEVER been used (invoices = 0, invoice_items = 0)** [WRA · §5]. Verdict: keep rate *resolution* (feeds commission + MIS), but adopt Zion's direct area→billing derivation to cut config steps, and treat invoicing as opt-in [WRA · §5, §8].

---

## 5. TOP SIMPLIFICATIONS TO ADOPT — and what NOT to copy

### ADOPT (for v2's lifecycle)
1. **One coherent official result, printed once.** Collapse the 4-column result to FE-opinion + one official result (backend-else-FE); make the report print *that*, not `cases.verification_outcome` [WRA · §3; ZRE · §"Q7" #1–2]. **Single highest-value lifecycle fix.**
2. **One save-gated finalize-and-report work surface** (Zion's `NewDataQC` → the Verification Workspace): data → assign → photos → remark → result → **report button as the last control**. Today CRM2 spreads this across mobile-submit → SFR → `/backend-review` queue → finalize → separate report dialog (Backend Review scored **E/fragmented**, ~300 ctx-switches/day at 100/day) [WCA · §A; PBP · Phase 5, Phase 12; OOA · §Phase 6]. Pure FE composition — every block already exists as a React component [WCA · §THE ONE IDEA].
3. **Persistent pipeline counter bar on every page** (Bucket/Assign/Review/Completed) — one mental model, zero status glossary; present the 6 CRM2 states as a pipeline, the rest as tags [ZRE · §6; WRA · §2; PBP · Phase 6].
4. **Revisit/recheck as one-click action** (keep CRM2's billable clone-to-new-task underneath; borrow only Zion's ergonomics — one click, stay-or-jump) [WRA · §4; WCA · §5 block #7].
5. **Billing derived from the operational action** — area-tag carries LOCAL/OGL + bill-Y/N; dedupe a universal hard gate before create AND assign; AUTO-EXECUTIVE auto-allocation [ZRE · §7, §"Q4"; WRA · §5; PBP · Phase 4].
6. **Sealed, attributed report:** named verifier + agency seal + geo-watermarked photos on a vtype-aware template (Zion's CPV/LRV gold standard CRM2 lacks) [ZRE · §5, §Addendum CPV/LRV; WRA · §6].

### DO NOT COPY
- **Operator-finalizes-own-case with no review** — CRM2's separation of duties (immutable FE opinion + append-only backend decision) is genuine dispute-defense governance Zion lacks; keep it, just present it on one surface [ZRE · §8 Review row, §"Q5"; WRA · §3; OOA · Phase 8 #3].
- **WebForms full-page postbacks, plain HTTP, no real RBAC separation** — adopt Zion's UX, never its platform [ZRE · §6, §"Q5"; PBP · MOST IMPORTANT QUESTION].
- **Baking client×product into ~20 hardcoded "portfolios"** instead of a config layer [ZRE · §"Q5", §Addendum §Org].
- **KYC running through the same generic QC flow** — CRM2 rightly keeps KYC a distinct billable cycle engine; unify only at the UI level [OOA · Phase 7 (KYC ownership = High gap), Phase 8 #3].
- ALL-CAPS dense tables; the second-era "Sophie Group" bolted-on dedupe sub-app [ZRE · §6].

---

*Audit only. Zion was reverse-engineered in the cited 2026-06-04 docs from screenshots/recordings; no Zion system was accessed and no CRM2 code/DB/API was read or modified for this synthesis.*
