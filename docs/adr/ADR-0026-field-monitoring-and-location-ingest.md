# ADR-0026 — Field Monitoring console + device location ingest

- **Status**: ACCEPTED (2026-06-12)
- **Context**: OPERATIONS build. The Field Monitoring nav slot was reserved but empty.
  `ADR-0012` / `MOBILE_API_COMPATIBILITY_MATRIX.md` already list `POST
  /api/v2/location/capture` as a planned mobile target. This ADR records building it +
  the supervisor console that reads field-agent activity. **This is additive — it does
  NOT reopen any frozen decision** (Case→Task→VU, stack, repo pattern, /api/v2,
  mobile-compat all hold).

## Decision

1. **Field Monitoring is a scoped, table-first console**, not a live map. It reuses the
   Universal DataGrid + the scope seam; presence/throughput/territory/last-location are
   fused into one row per agent (rejecting Zion's 4-page fragmentation). Polling, not
   websockets (v2 has no WS infra).

2. **Truthful-data rule**: no fabricated "Online/Offline" presence column while there is
   no live producer. The console runs on real `case_tasks`/`users`/territory data now;
   the GPS "Last Location" cell is wired but empty until the device rebases onto `/api/v2`.

3. **Device location ingest is built as forward-prep** (the `/sync/download` precedent),
   honoring the LOCKED mobile capture contract:
   - `POST /api/v2/location/capture`, gate `location.capture` (FIELD_AGENT-held, mirrors
     `/sync/download` gating on a field-held perm).
   - Accept body `{latitude,longitude,accuracy,timestamp,source,requestedBy?,caseId?,taskId?}`
     + header `Idempotency-Key` (body `operationId`/`operation_id` fallback).
   - Branch on `source`: `TRACKING` shift-gated (403 `OUTSIDE_SHIFT_WINDOW` outside IST
     8-22); idempotency on `operation_id`; envelope `{success,message,data:{id,timestamp,
     accuracy}}` — the exact terminal codes the device's offline queue keys off.
   - Dual write: `device_locations` (append-only event log) + `latest_device_location`
     (one-row-per-agent projection, freshness-guard upsert).

4. **New GPS tables are new-named** (`device_locations`, `latest_device_location`) —
   never overload the existing `locations` PINCODE CATALOG (the v1 naming-overload the
   audit flagged).

5. **New permissions**: `page.field_monitoring` (SA/MANAGER/TEAM_LEADER — supervisors),
   `location.capture` (FIELD_AGENT — the device). Added to `@crm2/access` + seeded in
   migration 0043 (parity test enforces DB ≡ `ROLE_PERMISSIONS`).

## Reverse-geocode (added 2026-06-12, owner-requested)

Coord→human address for the Last Location column, built as an additive layer:
- `GET /api/v2/geocode/reverse?lat=&lng=` (gate `case.view`) → `{address,cached}`. A pure
  coordinate→address function (no record id).
- `platform/geocode` seam (mirrors `platform/storage`): real Google Geocoding provider
  when `GOOGLE_GEOCODING_API_KEY` is set, else a disabled geocoder that resolves to `null`
  (the UI degrades to raw coords + a Maps link — never an error). Injectable via
  `setGeocoder` for tests.
- `geocode_cache` table (mig 0044): write-once/frozen per 6-dp coordinate (ON CONFLICT DO
  NOTHING) — an address never changes once resolved (the v1 frozen-address property at
  coordinate granularity). Failures/nulls are NOT cached (self-heals when a key lands).
- FE `LastLocationCell`: lazy per-row react-query keyed by 6-dp coords, `staleTime:
  Infinity`; shows the address (or coords while loading / no key), always links to Maps.
- The key is **server-side only**, optional, and should be restricted to the Geocoding API
  + the server IP (v1's prod key is IP-locked to its box → v2 needs its own).

## Deferred (NOT in this ADR's build)

Admin request-location ping trigger (needs FCM/WS push), live map + websocket,
`case_tasks.started_at` + device start/complete legs, the `crm-mobile-native` rebase of
`/location/capture` onto `/api/v2`.

## Consequences

- The supervisor console ships fully functional on real data, browser-verifiable now.
- The capture contract is ready so the eventual mobile rebase is a client-side base-URL
  change, not a backend build.
- Until that rebase, `device_locations`/`latest_device_location` stay empty and the
  "Last Location" column shows `—` (expected).
- DON'T-REGRESS: GPS lives in `device_locations`/`latest_device_location`, never
  `locations` (pincode catalog). The capture envelope + 403 `OUTSIDE_SHIFT_WINDOW` are a
  device contract — changing them breaks the offline queue. Roster scope MUST compose
  `getScopedUserIds` (a TL sees only their team).
