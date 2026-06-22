# Button Inventory — `apps/web` (evidence for ADR-0052)

Parsed **~200 button/action elements** across every page + shared component. Basis for the ADR-0052 variant mapping.

## Current style per action (style → count)
| Action | Current styles in use | Issue |
|---|---|---|
| Create / New | primary(16), text-link(3), ghost(2) | mostly primary ✓ |
| **Edit** | **text-link(11)**, ghost(3), primary(1) | mostly a bare text link — doesn't read as a button |
| **Export** | ghost(9), custom(6), text-link(2), primary(2) | **4 different styles** — no standard |
| Import | ghost(4), primary(1) | inconsistent vs Export |
| Delete / Deactivate / Revoke | ghost(4), red-text(6) | red *text*, never a real button |
| Save | primary(5), custom(3), ghost(1) | inconsistent |
| Activate | ghost(1), primary(2) | inconsistent |
| Cancel | ghost(23) | consistent ✓ |
| Utility (Columns/Views/pager/More/download) | ghost(8), custom(7) | ok-ish |

## LOCKED mapping (ADR-0052, owner-approved 2026-06-20)
Approved looks from the sample mockup: **secondary = tonal blue**, **destructive = filled red**.

| Action | → Variant | Look |
|---|---|---|
| Create / New / Add Task / Save | `primary` | filled **blue** — one per view |
| Edit · Export · Import · Activate | `secondary` | **tonal blue** (soft-blue fill + blue text); Export/Import told apart by ↓/↑ icons |
| Deactivate · Delete · Revoke | `destructive` | **filled red** (rows + confirm dialog) |
| Cancel · Columns · Views · pager · More · icons | `ghost` | borderless |
| genuine inline text links only | `link` | text |

Four looks total — solid-blue / tonal-blue / red / ghost — so secondary actions are unmistakably colored buttons, the solid blue stays rare (one per view), red is reserved for destructive. Same-color actions (Export/Import) are differentiated by **icons**, not extra colors. Dark-safe via `--primary-muted`/`--primary` token swap. Palette stays current Blue+Slate. Build = fix-plan Foundation F7 + migration.
