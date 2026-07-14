# Kickoff — Rate Management: assign to a CPV GROUP (multi product × verification unit)

**Date:** 2026-07-15 · **Repo:** crm2 · **Status at handoff:** `main` == `prod` == `88fb3ac`, staging + prod green, working tree clean.

---

## 1. The owner's ask (verbatim, then decoded)

> "we want to fix rate management — in that we have missed multiple selection of product and verification type for one client. we have universal option but sometimes we have to assign rate and rate type for certain cpv group. it is currently missing — user can add one at a time but it's a lengthy process."

**Decoded.** For one client you can today target either **one exact** `(product, verification unit)` slot, or **Universal = ALL** products / ALL units. There is **no middle ground**: "apply this to *these 3 products × these 4 units*" — a **CPV group / subset**. Doing it today means adding each combination one at a time.

This affects **both** surfaces, and they must be treated together:
- **Rate Management** (`/admin/rates`) — the client bill amount at a slot.
- **Rate Type Assignments** (`/admin/rate-type-assignments`) — which rate types are offered at a slot.

## 2. What already exists (verify, do not re-derive)

Each surface already fans out — but on **one axis only**, and the product/unit fields are single-valued:

```ts
// packages/sdk/src/rates.ts — "ONE client bill-rate … fanned across MANY (pincode, …)"
BulkCreateRatesSchema = { clientId, productId: nullish, verificationUnitId: nullish,
                          clientRateType, amount, currency, effectiveFrom,
                          locationIds: array().min(1).max(MAX_BULK_RATE_LOCATIONS) }   // ← fans on LOCATIONS

// packages/sdk/src/rateTypeAssignments.ts
BulkCreateRateTypeAssignmentsSchema = { clientId, productId: nullable, verificationUnitId: nullable,
                                        rateTypeIds: array().min(1).max(MAX) }        // ← fans on RATE TYPES
```

`null` on `productId` / `verificationUnitId` means **Universal** (ADR-0071). **That is the whole gap: neither takes `productIds[]` / `verificationUnitIds[]`.**

Shipped and working — reuse, do not reinvent:
- `POST /rates/bulk` — SAVEPOINT-per-row, per-row `CREATED | EXISTS | ERROR`, EXISTS = skip-never-overwrite (ADR-0093, file-memory `project_rate_bulk_location_2026_07_11`).
- `POST /rate-type-assignments/bulk` — same shape; "slot once → tick many rate types" (file-memory `project_rate_type_assignments_multi_add_2026_07_13`). Its EXISTS check is a **pre-read of the slot's active set**, NOT the rates `23P01` trick — RTA create is an idempotent upsert. Don't cross the wires.
- The **muted "covered" chip** (resolver-mirror): warns when a broader/Universal parent already covers a slot. Same hint exists in the CPV picker (`26c51b6`). **Discriminator: UNION vs RANK resolver** — rate/commission are RANK (specific overrides Universal, so no bug); CPV/RTA are UNION.
- `GET /cases/available-units?clientId=&productId=` — the CPV-enabled units for a client+product (ADR-0074, Universal CPV ⇒ all units). Likely the basis for the group picker.

## 3. Frozen constraints — read before designing

- **ADR-0016/0018** — the rate model is a **flat one-table** `(client, product, VU, location, rate_type) → amount`, effective-dated. **A "group" is NOT a new row type.** It must fan into N real rows, exactly as `locationIds` does today. Do not invent a group entity.
- **ADR-0071** — Universal = NULL product/unit; the `*_no_overlap` EXCLUDE constraints `COALESCE(…, -1)`, so Universal and specific rows coexist by design. **This is why the fan-out is already legal with no migration** (ADR-0093 makes the same argument for locations — reuse that reasoning).
- **ADR-0093** — the **one-slot-one-type rule**: exactly ONE active rate per `(client, product, unit, location)`, enforced app-layer via `otherTypeAtSlot` on create/bulk/import/activate. **A product × unit fan-out multiplies the slots this must be checked against — this is the main correctness risk.**
- **ADR-0050** — resolution: client bill by location with `client_rate_type` **display-only**; commission by exact key incl. `field_rate_type`. Don't touch resolution.
- **docs/CREATE_PAGE_STANDARD.md** — the UI contract (step cards · pick-many hints · sticky bar · row-wise results · toast + inline). Ref: CommissionRateCreatePage. Both pages already follow it.
- Governance: additive only. A new pattern/entity/migration needs a superseding ADR + Impact/Alternatives/Migration + CTO. **Next free ADR = 0095, next mig = 0119.**

## 4. Design questions to settle FIRST (owner input likely needed)

1. **Cardinality.** `products × units × locations` explodes: 3 × 9 × 100 = 2,700 rows in one submit. Today's caps are per-axis (`MAX_BULK_RATE_LOCATIONS`). What is the total cap, and does the plan need a **preview/confirm** ("this will create N rows") before writing? The row-wise result grid already exists — reuse it.
2. **Is the group a full cross-product, or a picked set?** "these 3 products × these 4 units" = 12 combos — but some may not be CPV-enabled for that client. **Must the fan-out intersect the client's enabled CPV matrix** (skip/flag the disabled combos), or attempt all 12? Strong recommendation: intersect + report the skipped ones per-row, so the grid explains itself.
3. **Group + Universal interaction.** If a Universal row already covers the client, do the specific group rows still get created (RANK resolver says specific wins — so yes, and the "covered" chip should hint it)? Confirm the hint copy.
4. **Same shape for both surfaces?** Rates fans product × unit × **location**; RTA fans product × unit × **rate type**. Keep the two payloads symmetric (`productIds[]`, `verificationUnitIds[]`) so the pickers are one component.
5. **Import path.** `rates/import.ts` + `rateTypeAssignments/import.ts` exist. Does the workbook need the group too, or is the screen enough? (Probably screen-only; confirm.)

## 5. Where to look

- API: `apps/api/src/modules/rates/{routes,controller,service,repository,import}.ts` · `apps/api/src/modules/rateTypeAssignments/*` · `apps/api/src/modules/cpv/*` (client-products + cpv-units).
- SDK: `packages/sdk/src/rates.ts` · `packages/sdk/src/rateTypeAssignments.ts` (the two bulk schemas above).
- Web: the two CREATE pages under `apps/web/src/features/rates/*` and `.../rateTypeAssignments/*`.
- Tests: `rates.api.test.ts` · `rates.resolution.test.ts` · `rateTypeAssignments.integration.test.ts`.
- ADRs: 0016, 0018, 0048, 0050, 0068, 0071, **0093** (the closest precedent — read it first), 0074 (Universal CPV).
- File-memory: `project_rate_bulk_location_2026_07_11` · `project_rate_type_assignments_multi_add_2026_07_13` · `project_cpv_universal_2026_06_26`.

## 6. Standing rules for the session

- **Cave mode** (minimal tokens) · act as **CTO: decide + execute**, don't ask per-step — but **ask before push / deploy / tag / live-DB writes**.
- **Surgical, no guessing.** Default = reuse; ADR-0093's bulk is the template. If the answer is "add one array to a schema and one loop to a service", that IS the answer — don't build a group entity.
- **Test-first; a phase is done only when `pnpm verify` is green** (typecheck → lint → format → no-suppressions → boundaries → test → build). Integration tests need `DATABASE_URL` (pg on `:5433`, `LC_ALL=C`).
- **Every regression test must FAIL on revert** — verify it, don't assume. (This session caught three defects that way, incl. a test that passed against a **bogus permission**.)
- **UI work: don't stop at tests** — drive it in the browser preview and confirm it persisted.
- Lint bans the words `todo|fixme|hack|temp|xxx` **anywhere in comments** (case-insensitive) — it will fail the gate.
- Commits: author `Mayur Kulkarni <mayurkulkarni786@gmail.com>`, conventional, **no AI trailer**, never `--no-verify`, secret-sweep before push.
- Update `CRM2_MASTER_MEMORY.md` §8 + file-memory at ship.

## 7. Definition of done

One screen per surface where an admin picks a client, **multi-selects products and verification units** (plus the existing locations / rate types axis), sees **how many rows will be created before saving**, and gets the row-wise `CREATED | EXISTS | ERROR` grid — with the one-slot-one-type rule still enforced across every fanned slot, no migration, and `pnpm verify` green.

---

### Context from the session that produced this (2026-07-13 → 15)

Shipped and live on prod: mobile field-test fixes (mig 0117 consent-version, v1.0.80/81) · **mig 0118** (MANAGER + TEAM_LEADER wired CLIENT/PRODUCT = RESTRICT — scope was fail-OPEN on zero wiring) · masterdata exports re-gated to `page.masterdata` (`data.export` alone exfiltrated every client's rate card) · billing/commission task-grain predicate (a shadowed `ct` leaked another agent's commission) · field-monitoring counts capped by client/product · `denyElevatedTarget` (a non-admin with `user.manage` could reset the admin's password). **ADR-0094 is PROPOSED, not built** (scope caps WRITE / hierarchy governs READ) — awaiting CTO + Security sign-off.

**Known-open, unrelated to this kickoff:** the users list has **no hierarchy filter**, so granting `page.users` to a non-admin exposes the whole org directory + PII export. Fix that before any non-admin is given user visibility.
