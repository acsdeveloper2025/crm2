# Plan / Kickoff Prompt — Excel + CSV import/export coverage audit (2026-06-22)

Status: **NOT STARTED** — ready-to-run multi-agent kickoff prompt. Paste the block below into a
fresh session (or execute via the CRM2 multi-agent build method). Goal: audit + fix Excel (.xlsx)
and CSV import/export coverage across the entire platform (frontend + backend + DB), page by page,
starting with admin/master-data pages, so every add/edit field is both importable and exportable.

> Link from PROJECT_INDEX.md when this work is picked up. Owner-requested; cross-checks parallel
> sessions throughout (shared `main` checkout).

---

```
Audit and fix Excel (.xlsx) + CSV import/export coverage across the ENTIRE platform
(frontend + backend + DB), page by page, starting with the admin / master-data pages.
As the codebase grew, import/export was never re-checked per page — so for every page that
has (or should have) import/export, EVERY field used to ADD or EDIT a record must be both
importable and exportable, with correct headers, validation, case handling, escaping, and a
lossless round-trip. Build via the CRM2 multi-agent method (act as CTO + spawn specialist
subagents with the Agent tool).

═══ 0. READ FIRST (in order) — do not skip ═══
- CLAUDE.md → PROJECT_INDEX.md → CRM2_MASTER_MEMORY.md (§8 live status) → SESSION_KICKOFF.md.
- Claude file-memory: MEMORY.md + the 5 always-load rule files (lazy-load). Route to relevant
  entries: import/export, MIS export (G-9 formula-escape), billing/clients/users CSV exports,
  MasterDataCrud, and the just-shipped ADR-0058 input-uppercase (origin/main 6e1a144).
- ADRs related to: master-data CRUD / management lists, OCC (concurrency), effective-from,
  MIS/export generation, and ADR-0058 (input-uppercase). Read the freeze docs
  (DESIGN_AND_STACK_FREEZE, ENGINEERING_STANDARDS, CI_CD_STANDARDS) and governance/.
- Existing import/export infra to REUSE, never reinvent — locate and read before touching:
  packages/sdk/src/import.ts + export.ts (toXlsx, escapeCsvCell, formula-injection guard),
  apiExport, apps/web/src/components/import/ImportModal.tsx, components/MasterDataCrud.tsx,
  and each module's existing CSV export + import endpoint/tests under apps/api/src/modules/*.
- Constraints (machine-enforced, do not violate): /api/v2 is additive-only; raw SQL only in
  repositories + migrations; FE talks to the API via @crm2/sdk only; no any / ts-suppressions /
  eslint-disable / console.*; never break the mobile contract (ADR-0054). No new pattern/
  package without a superseding ADR.
- CROSS-CHECK ADR-0058: import paths MUST go through the SDK create/update schemas (which now
  apply the toUpper transform to display-text fields and preserve codes/emails/usernames);
  export must reflect the stored (uppercased) values. Verify import does not bypass the schema.

═══ 1. ALWAYS CROSS-CHECK — parallel sessions share this main checkout ═══
We are continuously developing in parallel sessions on the SAME local `main`. EVERY step:
- `git fetch origin && git status` first; rebase your work onto origin/main; if origin moved
  mid-task, re-pull and re-run the gate.
- NEVER stage/commit files you didn't change — other sessions have uncommitted WIP. Stage your
  audit/fix files explicitly (git add <paths>), verify the staged set, and exclude anything
  foreign. Check `git log origin/main..HEAD` for foreign commits before any push.
- Re-derive next-free ADR + migration numbers from disk (`ls docs/adr`, `ls db/v2/migrations`) —
  do NOT trust a number quoted in a memory note; a concurrent session may have taken it.
- Commits: author Mayur Kulkarni <mayurkulkarni786@gmail.com>, conventional, NO AI /
  Co-Authored-By trailer, never --no-verify, commit only at a green gate. Ask before push/
  deploy/tag/merge/live-DB writes (push→main auto-deploys to prod).

═══ 2. SCOPE — page by page, admin/master-data first ═══
Enumerate EVERY page with a data list. Admin first (under /admin/*): verification-units,
clients, products, cpv, rates, commission-rates, report-layouts, locations, users, departments,
designations, rbac/roles, templates, policies, system. Then the rest: cases, pipeline, mis,
billing, field-monitoring, dedupe, etc.
For EACH page/entity build a FIELD MATRIX — every field used to add/edit a record (derived from
the create/update form + the SDK Create/Update schema + the DB columns), each row scored:
  field | required? | DB column | SDK schema field | transform (uppercase/code/enum/none) |
  IMPORT supported? (header, mapping, validation) | EXPORT supported? (header, value, escaping)

IMPORT first, then EXPORT, page by page:
- IMPORT: does the page have import? Does it accept BOTH .xlsx and .csv? Does it cover EVERY
  add/edit field (no silently-dropped columns)? Correct header→field mapping; per-row validation
  with clear error reporting; upsert/dedupe + OCC + effective-from semantics; RBAC gating;
  formula-injection-safe parsing; goes through the SDK schema (case transforms applied). Fix gaps.
- EXPORT: does export emit the SAME full matrix? Correct headers; stored case (post-ADR-0058);
  CSV + xlsx escaping (escapeCsvCell + toXlsx formula guard, per G-9); respects active filters /
  selected-rows mode; RBAC on sensitive/money/PII columns (mirror MIS G-4 server-side drop). Fix gaps.
- ROUND-TRIP: export → re-import must be lossless for all editable fields.

═══ 3. MULTI-AGENT EXECUTION ═══
- Phase A (audit, read-only): fan out Explore/audit subagents, one per page-group on DISJOINT
  files, each returning its page FIELD MATRIX + prioritized gap list + the exact files. Barrier:
  collect, dedupe, rank (P0 = a required add/edit field that import or export drops).
- Phase B (fix): fan out fix subagents on disjoint modules — IMPORT gaps first, then EXPORT.
  Edit SHARED infra (sdk import.ts/export.ts, ImportModal, MasterDataCrud) INLINE yourself (not
  in parallel agents) to avoid conflicts; use worktree isolation only if agents must edit shared
  files concurrently. TDD: extend sdk + api tests for every import/export (round-trip,
  escaping, validation, RBAC, OCC). Additive-only; reuse infra; no new patterns w/o ADR.

═══ 4. VERIFY (gate must be green before review) ═══
- `pnpm verify` (typecheck → lint → format → no-suppressions → boundaries → test → build).
- API integration tests need DATABASE_URL (ephemeral Postgres on :5433, LC_ALL=C). If running
  test subagents concurrently, give each its OWN database (vitest globalSetup rebuilds the
  template per run and collides on a shared db).
- THEN run/confirm the CI workflow (ci.yml) AND Playwright e2e green — e2e is NOT in pnpm verify.
- Browser-verify (preview MCP) a representative import + export on 1–2 pages: upload a sample
  .xlsx and .csv → confirm rows created with all fields + correct case; export → confirm the file
  has every column with correct values + escaping. Confirm persisted, not just tests.

═══ 5. REVIEW PANEL (after green) ═══
Spawn 4 independent review subagents; adversarially verify each finding before acting:
- CEO: coverage completeness vs business need (no page/field missed), real value.
- CTO: architecture, reuse-vs-reinvent, additive-only /api/v2, test rigor, migration re-run
  safety (DROP+ADD CHECK must be a superset — the 0037/0083 trap).
- Design: import/export UX, error reporting, consistency, a11y of the flows.
- Security: CSV/xlsx formula injection, escaping, RBAC on export of money/PII/sensitive columns,
  file-upload validation/size/type, no SQL injection via interpolated refs.
Disposition EVERY finding FIXED / DEFERRED / RATCHET / WONTFIX in docs/COMPLIANCE_GAPS_REGISTRY.md.

═══ 6. DELIVERABLES ═══
- Coverage-matrix doc under docs/audit-<YYYY-MM-DD>/ (page × field × import/export, before→after).
- Code fixes + tests; gate green; CI + Playwright green; browser-verified.
- COMPLIANCE_GAPS_REGISTRY dispositions; ADR if any frozen decision changes; memory updated each
  phase. Do NOT push/deploy without explicit owner OK; if you ship, leave a heads-up note for
  parallel sessions (origin moved → rebase; which files are yours).
```
