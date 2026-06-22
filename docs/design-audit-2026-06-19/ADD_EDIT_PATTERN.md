# D14 — Add / Edit Interaction Pattern (popup vs inline)

**Owner directive:** standardize add + edit to **INLINE forms — NO popup/modal/dialog forms.** This is a design-direction change: today the dialog-based CRUD (`MasterDataCrud` + the `*Dialog` components) is the de-facto standard, so **this requires a superseding ADR** (it changes the dialog CRUD pattern baked into the design system / `MANAGEMENT_LIST_STANDARD`).

**Scope of "form" (what must go inline):** entity **add/edit forms**. NOT in scope (these are not add/edit forms — keep as-is unless you say otherwise): action dialogs (Pipeline *Assign*, confirm/deactivate prompts), the **OCC `ConflictDialog`**, the **`ImportModal`**, history/preview viewers, and header **menus/popovers** (Jobs/Bell/Account).

_Skeptic re-verified every classification below at source — **0 overturned.**_

| Page | Add | Edit | Standardization gap |
|---|---|---|---|
| ClientsPage | 🔴 popup | 🔴 popup | GAP — both add and edit are popup modals; owner target is inline. Clients shares MasterDataCrud, so fixing the shared component fixes Clients + Products together. |
| ProductsPage | 🔴 popup | 🔴 popup | GAP — add+edit are popup modals (target=inline). Same shared MasterDataCrud as Clients. |
| DepartmentsPage | 🔴 popup | 🔴 popup | GAP — add+edit are popup modals (target=inline). |
| DesignationsPage | 🔴 popup | 🔴 popup | GAP — add+edit are popup modals (target=inline). |
| VerificationUnitsPage | 🔴 popup | 🔴 popup | GAP — add+edit are popup modals (target=inline). Largest form in the cluster (code/name/kind/category/form-code/description/date/PII checkbox). |
| LocationsPage | ✅ inline | 🔴 popup | GAP (split) — add is already inline (the reference pattern this cluster should converge on) but EDIT is a popup modal. Internally inconsistent within the same page; target = make e |
| RolesPage (Access Control) | 🔴 popup | 🔴 popup | GAP — both add and edit use a role=dialog/aria-modal popup (RolesPage.tsx:356-362). Owner target is inline-only; this large config form (code/name/hierarchy/password/idle/session/s |
| PoliciesPage | 🔴 popup | 🔴 popup | GAP — both add and edit use a role=dialog/aria-modal popup (PolicyDialog.tsx:50-57). Target is inline. Form (code/name/description/markdown content) should be an in-page inline for |
| TemplatesPage (Report Templates) | 🔴 popup | 🔴 popup | GAP — both add and edit use a role=dialog/aria-modal popup (TemplatesPage.tsx:229-235). Target is inline. Form (code/type/name/effectiveFrom/Handlebars body) should be an in-page i |
| ReportLayoutsPage (MIS Layouts) | 🔴 popup | 🔴 popup | GAP — both add and edit use a role=dialog/aria-modal popup (ReportLayoutsPage.tsx:278-285). This is the most complex designer in the cluster (max-w-4xl, dynamic column rows, FIELD_ |
| RateManagementPage | ✅ inline | 🔴 popup | Edit (Revise) is a popup modal (ReviseDialog role=dialog, RateManagementPage.tsx:551-643) — target is inline. Add is already inline (AddRateForm, the reference pattern). Note: Hist |
| CommissionRatesPage | 🔴 popup | 🔴 popup | BOTH add and edit are the same popup modal (CommissionRateDialog role=dialog, CommissionRatesPage.tsx:31-287) — target is inline for both. This is the worst-offender page in the cl |
| CpvPage | ✅ inline | 🔴 popup | Edit (RescheduleDialog, CpvPage.tsx:29-87, role=dialog) is a popup for both the link and the unit — target is inline. Add is inline in both spots (reference). Edit is narrow (only  |
| Users (User Management) | 🔴 popup | 🔴 popup | GAP — both ADD and EDIT use a modal dialog (UserDialog, role=dialog/aria-modal, UsersPage.tsx:459-840). Owner target is INLINE forms only. UserDialog is a large 2-tab (Profile/Acce |
| Reset Password (admin action dialog on Users) | – | – | N/A — action dialog, excluded from the inline add/edit standard. Listed only so it is not miscounted as an add/edit popup. |
| CasesPage (cases list) | 🟦 route | 🟦 route | NONE for the list itself — add/edit both route to full pages (no modal). Already conforms to no-popup. Route-to-page (vs inline) is the OWNER's accepted exception for cases (Zion-s |
| CaseCreatePage (new case) | ✅ inline | – | NONE — this is the REFERENCE inline add pattern (single continuous in-page flow, applicants stay visible). Conforms to the owner's inline target. Note its own bespoke `Field` wrapp |
| CaseDetailPage (case detail / edit surface) | ✅ inline | ✅ inline-row | NONE — this is the REFERENCE inline-row edit pattern and conforms to the owner target. The ONLY dialog here is ConflictDialog (731-744), an OCC ACTION dialog (Reload/Discard on 409 |
| PipelinePage | – | – | No add/edit-popup gap. The Assign… modal (PipelinePage.tsx:363-468) is an ACTION dialog explicitly out of scope for the inline-form standard; it is correctly a popup. Note it for k |
| DedupePage | – | – | No gap. Inline in-page form (DedupePage.tsx:123-172) — exemplary non-modal pattern, though it is a search not an entity CRUD. |
| FieldMonitoringPage | – | – | No add/edit-popup gap. No modal at all on this page. |
| DashboardPage | – | – | No gap. No add/edit forms on the dashboard. |
| BillingPage | – | – | No gap. No add/edit forms; uses the inline DataGrid accordion (renderExpanded) for detail, which aligns with the no-popup direction. |
| ProfilePage | – | ✅ inline | NONE — already matches the owner's inline target. This is a REFERENCE inline pattern (toggle-to-edit-in-place, Save/Cancel buttons ProfilePage.tsx:138-153). PolicyAcceptances is re |
| SecurityPage | ✅ inline | ✅ inline | NONE — already inline, matches target. Reference pattern for state-driven inline forms. |
| SystemPage | – | – | NONE — no add/edit surface exists, so no popup gap. |
| LoginPage | – | – | N/A — not an entity CRUD surface. |
| MustChangePasswordPage | – | – | N/A — not an entity CRUD surface. |
| MustAcceptPoliciesPage | – | – | N/A — not an entity CRUD surface. |

## Summary

- **11 pages use popup for BOTH add and edit** → full conversion to inline: Clients, Products, Departments, Designations, VerificationUnits, RolesPage (Access Control), Policies, TemplatesPage (Report Templates), ReportLayoutsPage (MIS Layouts), CommissionRates, Users (User Management).
- **3 pages are SPLIT (inline add / popup edit)** → convert the edit half: Locations, RateManagement, Cpv. These already prove the inline-add pattern works in-repo.
- **Reference inline implementations already in the codebase:** LocationsPage add (in-page card, `LocationsPage.tsx:198-294`), RateManagement `AddRateForm`, CPV inline link/enable forms, CaseCreatePage (full-page), CaseDetailPage edit (inline-row), ProfilePage edit (inline toggle). Converge the rest onto these.

## Recommended target standard (to lock in the ADR)

1. **Add** → an in-page form (expandable panel/section at the top of the list, like LocationsPage) — never a modal.
2. **Edit** → **inline-row edit** (edit-in-place in the DataGrid row) OR an in-page panel; never a modal.
3. Provide ONE shared inline-form primitive (so the 14 pages converge instead of each re-rolling) — e.g. extend `MasterDataCrud` to render its form inline instead of in `MasterDataDialog`, which fixes Clients/Products/Departments/Designations/VUs in one change.
4. Keep OCC, import, confirm, and menus as overlays (not forms) — out of scope.
