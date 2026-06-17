# CRM2 — Color System & Design Token Freeze (PERMANENT)
**Status:** FROZEN 2026-06-04. No further color decisions required. Source of truth = `packages/ui-theme/src/tokens.css` (values) + `tailwind-preset.js` (token→class mapping) + `src/index.ts` (status/chart TS constants). This doc describes them; the files are authoritative.

Identity: **Primary = Blue (blue-600) · Secondary/neutral = Slate · Inter (UI) + JetBrains Mono (codes/IDs).**
Light = default (White + Slate + Blue). Dark = `.dark` on `<html>` (Charcoal + Slate + Blue).
Style: 80% Twenty CRM · 10% Linear · 10% Salesforce. Professional, data-dense, long-hour comfort. **No** neobrutalism / glassmorphism / heavy gradients / decorative motion (state-feedback ≤150ms only).
**Contract:** components use SEMANTIC classes only (`bg-background`, `text-foreground`, `bg-primary`, `text-st-approved` …) — never `#hex` / `slate-*` / `dark:` overrides. `.dark` swaps variable values; classes stay identical. Verified: VU screen renders correctly in BOTH themes from one class set.

## 1–10. Core palette (semantic tokens)
| # | Token | Light | Dark | Class |
|---|---|---|---|---|
| 1 | **Primary (Blue)** | blue-600 `221 83% 53%` (+hover blue-700, +muted blue-100) | blue-500 `217 91% 60%` | `bg-primary` `text-primary-foreground` `bg-primary-hover` `bg-primary-muted` |
| 2 | **Secondary (Slate)** | slate-100 `210 40% 96%` / fg slate-700 | slate `222 18% 20%` | `bg-secondary` `text-secondary-foreground` `bg-secondary-hover` |
| 3 | **Success** | green-600 `142 71% 36%` | green `142 60% 45%` | `text-success` `bg-success` |
| 4 | **Warning** | amber-500 `38 92% 50%` (dark fg) | `38 92% 55%` | `text-warning` `bg-warning` |
| 5 | **Danger** | red-600 `0 72% 51%` | `0 63% 50%` | `bg-destructive` `text-destructive` |
| 6 | **Info** | sky-600 `200 98% 39%` (distinct from primary) | sky `199 89% 55%` | `text-info` `bg-info` |
| 7 | **Background** | white `0 0% 100%` / fg slate-800 | charcoal `222 28% 9%` | `bg-background` `text-foreground` |
| 8 | **Surface** | card white; muted slate-50; sunken slate-100 | `222 24% 12%` / `15%` / `10%` | `bg-card` `bg-surface-muted` `bg-surface-sunken` |
| 9 | **Border** | slate-200 `214 32% 91%` (+strong slate-300) | `222 16% 22%` | `border-border` `border-border-strong` `ring` |
| 10 | **Typography** | Inter (UI) + JetBrains Mono (`font-mono`). Scale 12/13/14·base/16/20/24/30, lh 1.45 body / 1.2–1.3 headings, weights 400/500/600 | same | `font-sans` `font-mono` |

## Workflow status colors (chip = soft bg + strong fg + dot)
`text-st-<name>` (strong) · `bg-st-<name>-bg` (soft chip) · helper `STATUS_META`/`statusChip()` in `@crm2/ui-theme`.
| Status | Hue | | Status | Hue |
|---|---|---|---|---|
| Pending | Slate | | Under Review | Amber |
| Assigned | Violet | | Approved | Green |
| In Progress | Blue | | Rejected | Red |
| Submitted | Cyan | | Revisit | Orange |
(8 statuses; each has light + dark variants — light = soft tint bg + -700 fg; dark = deep tint bg + bright fg.)

## Dashboard / chart colors
`--chart-1..6` = blue · green · amber · violet · cyan · rose (categorical, colorblind-aware, no gradients). Classes `bg-chart-1` … `text-chart-6`. Dashboard KPI cards = `bg-card` + chart/status accents.

## Table / hover / focus states
- **Row hover:** `hover:bg-row-hover` (slate-50 / dark slate). Zebra OFF — hover-only.
- **Row selected:** `bg-row-selected` (blue-50) + `border-row-selected-border` (blue-200).
- **Generic hover:** `hover:bg-accent`.
- **Focus:** global `:focus-visible` → 2px `ring` (blue) outline (in tokens.css base layer). Components may add `focus:border-ring`.

## shadcn token mapping
tokens.css uses HSL channel triplets (`H S% L%`) → preset maps via `hsl(var(--x) / <alpha-value>)`, so shadcn `components.json` points its CSS vars at the SAME `--background/--foreground/--primary/--card/--popover/--muted/--accent/--destructive/--border/--input/--ring/--radius` set. shadcn primitives copied into `acs-web-v2/src/components/ui` inherit these with zero extra config.

## Fonts
Self-hosted (no runtime CDN) via `@fontsource-variable/inter` + `@fontsource-variable/jetbrains-mono`, imported in `acs-web-v2/src/main.tsx`. `--font-sans`/`--font-mono` reference them.

## Elevation
3 levels only: `shadow-sm` (cards), `shadow-md` (popovers/dialogs), `shadow-lg` (overlays/command palette). No decorative shadows.

## WCAG AA contrast amendment (2026-06-06, owner-signed-off — COMPLIANCE_GAPS E-5)

The axe a11y gate (gate 29) found 4 light-mode tokens marginally under the WCAG AA 4.5:1
threshold for small text. Minimal darkenings applied (hue/sat unchanged; identity preserved):

| Token | Before | After | Contrast (worst bg) |
|-------|--------|-------|---------------------|
| `--muted-foreground` | `215 16% 47%` | `215 16% 43%` | 4.29 → 4.96:1 |
| `--st-in-progress` | `221 83% 53%` | `221 83% 45%` | 4.28 → 5.6:1 |
| `--st-approved` | `142 72% 29%` | `142 72% 25%` | 4.46 → 5.6:1 |
| `--st-revisit` | `21 90% 42%` | `21 90% 35%` | 3.96 → 5.3:1 |

Inactive (unbuilt) Operations nav items carry `aria-disabled="true"` (WCAG 1.4.3
inactive-component exemption) — appearance unchanged. **Dark mode audited too: all token
pairs already meet AA by computation** (muted-foreground 5.1–7.0; all status chips 5.06–7.83;
active nav link navy-on-blue-500 = 5.05); the only axe dark-sweep flags were transition-timing
sampling artifacts on the animated active nav link (settled color passes), so no dark token
change is warranted. The a11y gate runs in the default (light) theme.

---
*Permanent UI theme freeze. To change a color, edit `tokens.css` only — never hardcode in components. Cross-ref: `DESIGN_AND_STACK_FREEZE.md` Part 3–8.*
