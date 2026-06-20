# ADR-0052: Button & action-emphasis system

- **Status:** Accepted (owner decision 2026-06-20)
- **Date:** 2026-06-20
- **Extends (additively):** ADR-0008 (design system) component layer + `docs/COLOR_SYSTEM_FREEZE.md`. The color tokens and broader styling stay frozen — this ADR only adds the missing **button-variant / action-emphasis** tier.

## Context

`apps/web` has effectively **two** button styles today (`apps/web/src/index.css:14-19`):
- `.btn` — filled brand/primary (`bg-primary` blue), 48 uses.
- `.btn-ghost` — a **thin grey border** (`border border-input … hover:bg-accent`), ~50 uses.

Plus **21 files render real actions as bare text links** (`text-primary hover:underline`, e.g. the row `Edit`/`Deactivate`/`Activate` controls) with no background, border, or padding.

Result (owner-reported): when a page has many actions, only **one** control is blue and everything else is grey-bordered or plain text, so **users can't tell the secondary/row controls are buttons.** There is no mid-emphasis "secondary" button, no destructive variant, no icon-button standard, no shared `<Button>` component, and no consistent sizes — the design audit's reuse sweep also flagged bespoke one-off buttons. The semantic tokens needed to fix this (`secondary` + `secondary-foreground` + `secondary-hover`, `destructive`, `accent`, `success/warning/info`) **already exist** (`packages/ui-theme/tailwind-preset.js:33-43`) — they are simply not wired into a button hierarchy.

## Decision

We will define a **button hierarchy with clear affordance at every emphasis level**, as a single shared `<Button variant size>` component (in `apps/web/src/components/ui/Button.tsx`) backed by the existing tokens, and migrate all buttons to it. **Every actionable control must have a button affordance** — a background OR a visible border, plus padding, hover, and a visible `:focus-visible` ring. Bare grey text is no longer an action style.

Variants — **four button looks + a text link** (visual choices owner-approved 2026-06-20 from the sample mockup):
1. **`primary`** — filled brand (`bg-primary`, **blue**), the **one** main action per view (today's `.btn`).
2. **`secondary`** — **bordered neutral button** (`bg-background` + a clear `border-input` border + hover, NOT a faint grey hairline). The **missing mid tier**: clearly a button, used for the common actions and **row Edit/Export/Import/Activate** so they stop looking like text. (The earlier "outline" idea is folded into this single bordered secondary to avoid two near-identical bordered styles.)
3. **`destructive`** — **filled red** (`bg-destructive`, white text) for Delete/Deactivate/Revoke — on table rows AND in the confirm dialog (owner-approved as in the sample).
4. **`ghost`** — no border, hover background only; **toolbar/utility/icon use only** (Cancel, Columns, Views, pager, More), never a standalone row action.
5. **`link`** — text-only; reserved for genuine inline text links, NOT table/row actions.

Also: **sizes** (`sm`/`md`), a dedicated **icon-button** form (square, `aria-label`, ≥44px touch target per `RESPONSIVE_DESIGN_STANDARD`), and consistent **disabled + loading** (spinner + disabled) states. All variants get the global `:focus-visible` ring (already in `tokens.css:238-240`).

**Rule of one:** exactly one `primary` (blue) per view/region; everything else is `secondary`/`destructive`/`ghost` — but always with a button affordance, never bare grey text.

### Action → variant mapping (locked, from the [button inventory](../design-audit-2026-06-19/BUTTON_INVENTORY.md) of ~200 buttons)
| Action | Variant |
|---|---|
| Create / New / **Save** | `primary` (blue) |
| **Edit · Export · Import · Activate** | `secondary` (bordered — all identical) |
| **Deactivate · Delete · Revoke** | `destructive` (filled red) |
| Cancel · Columns · Views · pager · More · icon utilities | `ghost` |
| genuine inline text links only | `link` |

The inventory showed the real gaps were **Edit** (11 bare text-links) and **Export** (4 different styles) — both become the single bordered `secondary`; red is reserved for the small destructive set.

## Consequences

### Positive
- Secondary and row actions are **visibly buttons** → fixes the owner's core complaint.
- One shared `<Button>` → kills the 21 bare-text-link actions and the bespoke one-off buttons (design-audit reuse finding); consistent sizes/disabled/loading/focus.
- Purely **additive to the frozen color system** — reuses existing `secondary`/`destructive` tokens; no new colors, no token changes.
- Also lifts the row-action **touch-target** + **focus-visible** gaps from the keyboard/responsive audits.

### Negative / Risks
- Touches **many** files (≈48 `.btn` + ≈50 `.btn-ghost` + 21 text-link + bespoke). Mechanical but broad — do it as one focused migration with a codemod-style pass + review.
- Risk of over-using `secondary` (everything mid-emphasis) → enforce the **rule of one primary** in review; lean on `outline`/`ghost` for dense toolbars so pages don't become a wall of filled buttons.
- `.btn`/`.btn-ghost` CSS classes stay as thin aliases during migration to avoid a big-bang break, then are removed.

## Alternatives Considered
- **Just darken/strengthen `.btn-ghost`'s border** — cheapest, but still no real secondary tier and doesn't fix the 21 text-link actions; **rejected** as a half-measure.
- **Make more buttons primary-blue** — would create many competing blue buttons (worse hierarchy); **rejected**.
- **A broad "all v2 styling" ADR** — the color/typography/spacing system is already frozen (ADR-0008 + COLOR_SYSTEM_FREEZE + tokens); a mega-ADR would conflict with the freeze. **Rejected** in favor of this focused, additive button-system ADR.

## Migration
Per the fix plan: a Foundation task builds `<Button>` (+ variants/sizes/icon/loading) and re-points `.btn`/`.btn-ghost` to it; then a migration task converts row actions to `secondary`/`outline`, destructive actions to `destructive`, and the 21 bare text-links to real buttons — TDD/visual + `pnpm verify` + browser-verify. Folds into and supersedes Wave-3 task C3's "bespoke button → `.btn-ghost`" item.

## Related ADRs
- **ADR-0008** (design system) — extended (component/button layer).
- **ADR-0051** (inline-grid editing) — sibling; the new record pages + editable grid consume this button system.
- Standards: `docs/COLOR_SYSTEM_FREEZE.md` (unchanged — tokens reused), `docs/UI_STANDARDS.md` + `docs/RESPONSIVE_DESIGN_STANDARD.md` (document the button variants + touch targets).
