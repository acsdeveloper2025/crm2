# Kickoff prompt — crm-mobile-native rebrand: new logo + remove ACS identities (keep CRM)

> Paste into a fresh session. Repo: `acsdeveloper2025/crm-mobile-native`, local clone at
> `/Users/mayurkulkarni/Downloads/crm-mobile-native` (work off `origin/main`; another session's
> older clone with a release-gated sync branch lives elsewhere — leave it alone).

---

We are rebranding the mobile app the same way the web app was done (CRM2 own brand, shipped
2026-07-03 `7ed6247`): **remove ACS identities, brand is CRM**. New logo + clean naming.

## Brand source of truth (reuse, don't invent)

The web app already has the CRM2 brand: `crm2/apps/web/src/components/Logo.tsx` +
`crm2/apps/web/public/favicon.svg`. Adapt THAT mark for the mobile app icon/splash so web and
mobile look like one product.

## Scope (sweep ALL of these)

1. **Launcher icon**: `android/app/src/main/res/mipmap-*` (all densities + adaptive
   `ic_launcher_foreground/background` + round) and the iOS `AppIcon` asset catalog. Generate all
   densities from the CRM2 mark.
2. **Splash / in-app logos**: grep + eyeball `src/assets/` and the login screen for ACS logo
   images or wordmarks (binary assets don't grep — LOOK at every image).
3. **App display name**: Android is already env-derived via `resValue app_name` in
   `android/app/build.gradle` ("CRM Mobile" / "CRM Staging" — added 2026-07-04, keep that
   mechanism). Align iOS `CFBundleDisplayName` and `app.json` name/displayName the same way.
4. **User-visible strings**: sweep `src/` for `ACS` / `AllCheck` / `All Check` (case-insensitive)
   in UI text, headers, toasts, notification titles.
5. **Docs/README** of the mobile repo where they show the old brand.

## HARD do-NOT-touch list (breaks things, not branding)

- `applicationId com.crmmobilenative` and the iOS bundle id — **changing them orphans every
  installed device** (updates stop matching). Same for `com.crmmobilenative.staging`.
- API/WS URLs `*.allcheckservices.com` (`src/config/index.ts`) — that's the DOMAIN, not branding.
- Firebase project `caseflow-mobile` + `google-services.json` — backend identity, not user-visible.
- The staging flavor mechanics (`-PappEnv=staging` → side-by-side "CRM Staging" app).

## Owner decisions to ask (one question at a time — his preference)

1. Final display name: keep **"CRM Mobile"** or something else ("CRM2"?). Staging stays
   "CRM Staging" (or matching variant).
2. **`src/constants/fieldExecutiveAcknowledgement.ts` is a LEGAL agreement** naming
   "All Check Services LLP (ACS)" as the contracting entity. Rebranding must NOT silently rewrite
   legal terms — ask whether to (a) leave the legal text as-is (recommended: the LLP is still the
   employer/legal entity), or (b) have the owner supply revised terms.
3. Splash/icon style approval before generating all densities (show a preview mockup first).

## Process

- Verify current UI on a device/emulator or by building the staging APK (Actions →
  "Android Release" builds both APKs on tag; for a quick check `-PappEnv=staging` local build).
- `npm run typecheck` + `npm run lint:src` green; commit conventions: author Mayur, conventional
  commits, NO AI trailer; branch → merge to `main`; **nothing reaches phones until the owner tags
  the next release** (`v*`) — both APKs (prod + staging) build automatically from one tag.
- Update memory + `crm2/CRM2_MASTER_MEMORY.md` §8 at ship, per standing rules.
