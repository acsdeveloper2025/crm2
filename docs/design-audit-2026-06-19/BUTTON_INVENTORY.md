# Button Inventory — `apps/web` (evidence for ADR-0052)

Parsed **~200 button/action elements** across every feature page + shared component (worktree @ origin/main `11997a1`). Shows the current style per action-type — the basis for the ADR-0052 variant mapping.

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
| Utility (Columns, Views, pager, More, download) | ghost(8), custom(7) | ok-ish |

## LOCKED mapping (ADR-0052, owner-approved 2026-06-20)
Visual choices approved from the sample mockup: **secondary = bordered button**, **destructive = filled red**.

| Action | → Variant | Look |
|---|---|---|
| Create / New / **Save** | **primary** | filled **blue** — exactly one per view |
| **Edit · Export · Import · Activate** | **secondary** | **bordered** neutral button (clear border + hover) — all identical |
| **Deactivate · Delete · Revoke** | **destructive** | **filled red** (rows + confirm dialog) |
| Cancel · Columns · Views · pager · More · icon utilities | **ghost** | borderless, low-emphasis |
| genuine inline text links only (not row actions) | **link** | text + underline |

Four button looks total — blue / bordered / red / borderless — so secondary actions are unmistakably buttons, blue stays rare (one per view), and red is reserved for destructive. Migration: every call-site adopts `<Button variant>` per this table (Foundation F7 in the fix plan).
