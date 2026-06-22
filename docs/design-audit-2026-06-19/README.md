# V2 Frontend Design Audit — `apps/web`

**Authorized audit (2026-06-19 → 2026-06-22), AUDIT-ONLY.** Multi-agent (24+ agents across 4 workflows) + live browser verification + adversarial skeptic passes. This branch persists the deliverable (the working-tree copy was wiped by a parallel `main` reset on 2026-06-22).

## Documents
| File | Contents |
|---|---|
| [CHECKLIST.md](./CHECKLIST.md) | Canonical 13-dimension PASS-rule + reuse-primitive checklist |
| [MATRIX.md](./MATRIX.md) | Page × dimension compliance heat-map (22 × 13) |
| [FINDINGS.md](./FINDINGS.md) | All 126 findings P0→P3, file:line + additive fix |
| [PER_PAGE.md](./PER_PAGE.md) | Per-page dimension verdicts + evidence |
| [CROSS_SWEEPS.md](./CROSS_SWEEPS.md) | Whole-app sweeps: tokens · tables · a11y · reuse |
| [SKEPTIC.md](./SKEPTIC.md) | Adversarial re-verification (17 verdicts re-checked; 2 refinements) |
| [ADD_EDIT_PATTERN.md](./ADD_EDIT_PATTERN.md) | D14 — popup vs inline add/edit (→ ADR-0051) |
| [KEYBOARD_NAV.md](./KEYBOARD_NAV.md) | D15 — keyboard navigation (5 P1 blockers) |
| [BUTTON_INVENTORY.md](./BUTTON_INVENTORY.md) | ~200 buttons → variant mapping (→ ADR-0052) |
| [THEME_AUDIT.md](./THEME_AUDIT.md) | Light + dark theme / token system audit |
| [../../adr/ADR-0051-inline-grid-editing-no-modal-forms.md](../../adr/ADR-0051-inline-grid-editing-no-modal-forms.md) | Decision: Twenty-style inline-grid add/edit |
| [../../adr/ADR-0052-button-action-emphasis-system.md](../../adr/ADR-0052-button-action-emphasis-system.md) | Decision: button variant system |
| [../../plans/2026-06-20-frontend-design-compliance-fix-plan.md](../../plans/2026-06-20-frontend-design-compliance-fix-plan.md) | Multi-agent fix plan (Foundation → Waves 1–4 + K) |

## Headline
- **Design compliance:** 286 cells → 131 PASS · 88 PARTIAL · 34 FAIL · 32 N/A. **0 P0 · 25 P1 · 56 P2 · 45 P3.** Admin-CRUD + Universal DataGrid are the gold standard; gaps are primitive-adoption on newer pages.
- **Top P1 patterns:** RBAC-UI client-gating leaks (Cases `+New`, Rate Mgmt — seeded-role-reachable); bespoke dialogs/popovers not focus-trapped; non-standard loading/error states; 2 token slips.
- **Theme (the big one):** FE is **~100% token-driven**; `tokens.css` is a complete light + **dark** palette. Whole-tree sweep of 83 files = ZERO hardcoded colors except 2. **Dark mode already works end-to-end (live-proven) — it only lacks a toggle.** An awesome redesign = editing one file (`tokens.css`).
- **Decisions (owner-accepted):** add/edit → **inline-grid + record pages, no modal forms** (ADR-0051); buttons → **primary/secondary/destructive/ghost/link** variant system (ADR-0052).

## Status
AUDIT + PLAN + DECISIONS only — no app code changed. Build sequenced in the fix plan. Note: these docs were re-numbered (ADR-0051/0052 → 0051/0052) after parallel sessions shipped through ADR-0059.
