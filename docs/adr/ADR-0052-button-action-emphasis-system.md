# ADR-0052: Button & action-emphasis system

- **Status:** Accepted (owner decision 2026-06-20)
- **Date:** 2026-06-20 (decision); refined 2026-06-22 (tonal secondary + review-panel fixes). Canonical reserved number per `docs/adr/README.md`.
- **Extends (additively):** ADR-0008 (design system) component layer + `docs/COLOR_SYSTEM_FREEZE.md`. Tokens/broader styling stay frozen — this only adds the missing button-variant tier.

## Context

`apps/web` has effectively two button styles (`apps/web/src/index.css:14-19`): `.btn` (filled blue, 48 uses) + `.btn-ghost` (thin grey border, ~50 uses), plus **21 files rendering real actions as bare `text-primary hover:underline` links** (row Edit/Deactivate/Activate). Owner-reported: with one blue + grey/text everywhere, users can't tell secondary/row controls are buttons. A ~200-button inventory ([BUTTON_INVENTORY.md](../design-audit-2026-06-19/BUTTON_INVENTORY.md)) confirmed the real gaps are **Edit** (11 bare text-links) and **Export** (4 different styles) — not red. The `secondary`/`destructive` tokens already exist (`packages/ui-theme/tailwind-preset.js:33-43`), so the fix is additive (no new colors).

## Decision

A shared `<Button variant size>` component (`apps/web/src/components/ui/Button.tsx`) backed by existing tokens. **Every actionable control has a button affordance** (background OR visible border + padding + hover + `:focus-visible` ring) — bare grey text is no longer an action style. **Four button looks + a text link** (visuals owner-approved from the sample mockup 2026-06-20):

1. **`primary`** — filled **blue** (`bg-primary`); the **one** main action per view (Create / + New / Add Task / Save).
2. **`secondary`** — **tonal blue** (`bg-primary-muted` soft-blue fill + blue text). Colored + clearly a button, sits *below* the solid-blue primary. Used for Edit / Export / Import / Activate; **Export vs Import are told apart by a label + a download/upload glyph (NOT a bare `↓`/`↑` arrow, which can read as a sort caret), not different colors**. **Dark-safe** via the `.dark` token swap (`--primary-muted`→deep navy, `--primary`→bright blue). **WCAG-AA contrast REQUIRED in BOTH modes (F7 ships a contrast-assertion test):** light text = AA-tuned blue `hsl(221 83% 45%)` (the `--st-in-progress` value, ~5.6:1 on blue-100); **in dark, `--primary` blue-500 on `--primary-muted` is only ~3.9:1 → FAILS AA, so dark tonal text MUST use a lighter blue (e.g. `--primary-hover` blue-400) or a darker `--primary-muted`** to clear 4.5:1 (Designer review 2026-06-22).
3. **`destructive`** — **filled red** (`bg-destructive`) for Delete/Deactivate/Revoke (rows + confirm dialog).
4. **`ghost`** — borderless, hover bg; toolbar/utility/icon only.
5. **`link`** — text-only; genuine inline links, never row actions.

Plus sizes (`sm`/`md`), icon-button (square, `aria-label`, ≥44px), and `disabled`/`loading` states. **Rule of one primary per view.**

**Palette decision (owner 2026-06-22):** keep the current **Blue + Slate** palette — no palette redesign; the button system uses only existing tokens (`--primary`, `--primary-muted`, `--destructive`). Color encodes **hierarchy + semantics, not per-action identity**. A distinct color per action (Export=amber, Import=sky, Save=green, …) was considered and **rejected**: amber/sky/green already carry status meanings (would fight the status chips), and too many button colors destroy hierarchy + the frozen "calm/professional" identity. Same-color actions are told apart by **icons** (e.g. `↓` Export vs `↑` Import).

### Action → variant mapping (locked, from the button inventory)
| Action | Variant |
|---|---|
| Create / New / Add Task / Save | `primary` (solid blue) |
| Edit · Export · Import · Activate | `secondary` (tonal blue; Export/Import differentiated by ↓/↑ icons) |
| Deactivate · Delete · Revoke | `destructive` (filled red) |
| Cancel · Columns · Views · pager · More · icon utilities | `ghost` |
| genuine inline text links only | `link` |

## Consequences
**Positive:** secondary/row actions are visibly buttons (fixes the complaint); one `<Button>` kills the 21 text-links + bespoke one-offs; consistent sizes/disabled/loading/focus; purely additive (reuses existing tokens, no new colors); also lifts row-action touch-target + focus gaps.
**Negative:** touches many files (~48 `.btn` + ~50 `.btn-ghost` + 21 text-link + bespoke) — mechanical but broad; over-use of `secondary` risks a wall of buttons → enforce rule-of-one in review.

## Alternatives Considered
- Strengthen `.btn-ghost` border only — half-measure, doesn't fix text-links; rejected.
- More primary-blue buttons — competing blues, worse hierarchy; rejected.
- A broad "all v2 styling" ADR — the color system is frozen (ADR-0008/COLOR_SYSTEM_FREEZE); a mega-ADR would conflict; rejected in favor of this focused additive ADR.

## Migration
Fix-plan **Foundation F7**: build `<Button>` (re-point `.btn`/`.btn-ghost` to it) → mechanical migration applying the mapping above (convert the 21 text-links + bespoke). Supersedes Wave-3 C3's "bespoke button → `.btn-ghost`" item.

## Related ADRs
ADR-0008 (design system — extended) · **ADR-0051** (inline-grid — sibling; record pages + editable grid consume this) · `COLOR_SYSTEM_FREEZE.md` (unchanged — tokens reused) · `UI_STANDARDS.md` / `RESPONSIVE_DESIGN_STANDARD.md` (document variants + touch targets).
