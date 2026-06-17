# RESPONSIVE_DESIGN_STANDARD.md — Responsive-First Web Design (FROZEN)

**Status:** FROZEN 2026-06-05 · **Scope:** the CRM2 **web app** (`apps/web`) ·
**Umbrella:** ADR-0008 (design system) + ADR-0013 (governance) · **SoT for all responsive rules.**

> **Scope note.** This is about WEB UI design only. It is **NOT** "offline-first", "mobile-app-first",
> or "mobile-workflow-first". The mobile app is a separate repo. This rule makes the **web app**
> usable on any screen size with **one** UI — no separate mobile site.

## The rule

CRM2 web is **Responsive-First** and **device-agnostic**. Every screen is designed from the
**smallest** supported width up — mobile → tablet → laptop → desktop — **never** desktop-first then
shrunk. **No desktop-only design is allowed.**

## Supported breakpoints (all pages must work at each)

| Band | Min width | Tailwind | Primary devices |
|------|-----------|----------|-----------------|
| Mobile | **320px+** | (base, no prefix) | phones |
| Tablet | **768px+** | `md:` | tablets |
| Laptop | **1024px+** | `lg:` | small/standard laptops |
| Desktop | **1440px+** | `xl:`/`2xl:` | large monitors |

Design the base (unprefixed) styles for **320px**, then layer `md:` / `lg:` / `xl:` upward.

## Layout rules

- **Do:** responsive layouts, responsive grids, responsive tables, responsive filters, responsive dialogs.
- **Avoid:** fixed-width layouts, horizontal overflow (`overflow-x` on the page/body), desktop-only workflows.
- Main content region uses `min-w-0` so wide children scroll **inside** their card, never the page.
- Grids start single-column: `grid-cols-1 md:grid-cols-2 lg:grid-cols-4` (mobile-up), never a bare `grid-cols-N`.

## Navigation

- The sidebar is **not** permanently on-screen below `md`. On mobile/tablet (`<lg`) navigation collapses
  into a **hamburger → Sheet/Drawer** (shadcn `Sheet`); on `lg+` it is the persistent sidebar.
- No interaction may require a screen wider than 320px.

## Table strategy (mandatory)

| Band | Presentation |
|------|--------------|
| Desktop (`lg+`) | full **DataGrid** / data table |
| Tablet (`md`) | **condensed** grid (fewer/auto-hidden columns) |
| Mobile (`<md`) | **card / list** view (one card per row; key fields stacked) |

Never force a wide desktop table onto a phone. Until the Universal DataGrid lands (which owns the
responsive column strategy), every interim `<table>` MUST at minimum be wrapped in `overflow-x-auto`
within its card, and operational/important lists SHOULD provide a mobile card view.

## Design system (shadcn/ui)

Configure components responsively: responsive **spacing**, responsive **typography**, responsive
**grid** layouts, and the **Drawer/Sheet** pattern for mobile nav, filters, and large dialogs.

## Dialogs / filters

- Dialogs: `w-full` with side padding, a sensible `max-w-*` on `sm+`, and **vertical scroll**
  (`max-h-[90vh] overflow-y-auto`) so tall forms never clip on short screens. On mobile a dialog may
  present as a bottom **Sheet**.
- Filter/toolbar rows: `flex flex-wrap` (or a responsive grid) so controls wrap instead of overflowing;
  on mobile, secondary filters may collapse into a Filters sheet.

## Testing requirements

Every page is tested at **Mobile (375×812) / Tablet (768×1024) / Laptop (1280×800) / Desktop (1440×900)**.
**Playwright viewport testing is required** (a per-page responsive spec asserting: no horizontal overflow
at 320/768/1024/1440, nav reachable, primary action reachable). CI gates 49–50 (see CI_CD_STANDARDS),
activated as the Playwright harness lands.

## Enforcement

- Code review rejects: bare `grid-cols-N` (no responsive prefix), un-wrapped wide `<table>`,
  fixed pixel page widths, desktop-only nav, dialogs without `w-full`/scroll.
- New screens ship responsive **from day 1** (mobile-up). This is part of the definition of done.

## Retrofit obligation

Screens built before this freeze are **not yet responsive-first** (most are desktop-layout: a persistent
sidebar + wide tables + no mobile card view). They are a retrofit cohort — tracked in
`docs/COMPLIANCE_GAPS_REGISTRY.md` — to be made responsive before GA. The biggest items: the app shell /
sidebar (mobile drawer) and the table→card strategy. The Universal DataGrid build is the natural place to
deliver the responsive table strategy platform-wide.

## Related

- ADR-0008 (design system) · `docs/DESIGN_AND_STACK_FREEZE.md` · `docs/UI_STANDARDS.md` ·
  `docs/DATAGRID_STANDARD.md` · `docs/PAGINATION_AND_LOADING_STANDARDS.md` ·
  `docs/MANAGEMENT_LIST_STANDARD.md` · `docs/FROZEN_DECISIONS_REGISTRY.md`.
