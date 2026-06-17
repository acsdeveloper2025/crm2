# Field Monitoring — design (2026-06-12)

Build-order #? (OPERATIONS nav slot, reserved at `Layout.tsx:13`). Audit-first scope
(owner-sanctioned): v1 + mobile-contract + Zion + v2-baseline audits → this design.
Owner decision (2026-06-12): **Both now** — the task-data ops console AND the GPS
ingest contract as forward-prep (the way `/sync/download` was built before the device
rebase). GPS display is wired but stays empty until `crm-mobile-native` rebases onto
`/api/v2` (separate repo, deferred).

## What this screen is

The supervisor's field-operations console: *for the field executives in my scope, what
are they assigned, what's stuck/overdue, who produced today, and where were they last
seen.* One unified DataGrid + a counter bar — the Zion win is fusing roster / attendance
/ throughput / location into ONE row per agent (Zion splits these across 4 pages).

## Audit findings that shape it

- **v1**: table-only roster (map removed), binary Online/Offline = socket OR fresh GPS
  ≤15min, `latest_location` projection + `locations` event log, scoped by hierarchy
  (`getScopedOperationalUserIds`), gated `page.field_monitoring` → SA/MGR/TL. Per-agent
  throughput is NOT on the v1 page (it lives in Reports). On-demand FCM+socket ping; no
  periodic GPS heartbeat (TRACKING is periodic foreground, shift-gated IST 8-22).
- **Mobile contract (locked)**: the unmodified device POSTs only two live shapes to
  `…/location/capture` — `ADMIN_PING` (Idempotency-Key=requestId, `requestedBy`) and
  `TRACKING` (shift-gated IST 8-22). Foreground-only. Device keys off terminal codes
  **403 `OUTSIDE_SHIFT_WINDOW` / 409 / 400 = drop, 5xx = retry**, envelope
  `{success,data:{id,timestamp,accuracy}}`. The device still calls `/api/mobile/*`; the
  rebase onto `/api/v2` is deferred → **no live device produces v2 pings today.**
- **Zion**: adopt — unified console, persistent counter bar, app-version column,
  auto-attendance-from-activity, inline per-agent throughput, aging/overdue. Reject — the
  4-page fragmentation, batch-only mindset, stale-single-position.
- **v2 baseline GAP**: no location ingest, **no GPS table** (`locations` is a pincode
  catalog), no `latest_location`, no geocode, no websocket, no `page.field_monitoring`
  perm, no page. REUSE: `taskScopePredicate`/`getScopedUserIds`, the Universal DataGrid
  (clone `PipelinePage`), the sync read-model join, `@crm2/ui-theme` tokens, the reserved
  nav slot, `role_permissions` migration seeding.

## Decisions (CTO — not forks)

1. **Table-first** Universal DataGrid (clone `PipelinePage`). No map now (matches v1's
   final table-only state + the DataGrid freeze). A map is a later add when GPS flows.
2. **Polling**, not websockets — v2 has zero WS infra; react-query `refetchInterval`.
3. **Scope** via `getScopedUserIds(actor)` on the field-agent population (user-grain):
   SA=all, MGR=subtree, TL=direct-team, others=self. RBAC-correct by construction.
4. **Truthful data only** (no-fabrication rule): NO fake "Online/Offline" presence while
   there's no producer. Signals are all real from `case_tasks`/`users`/territory; the GPS
   "Last Location" cell shows `—` until the device rebases.
5. **New perm** `page.field_monitoring` → SA(grants_all)/MANAGER/TEAM_LEADER. New
   `location.capture` → FIELD_AGENT (mobile-facing ingest, mirrors how `/sync/download`
   gates on a field-held perm). Both seeded in migration 0043 + `@crm2/access` (parity).
6. **GPS forward-prep**: `POST /api/v2/location/capture` honoring the locked contract +
   `device_locations` (event log) + `latest_device_location` (projection). New names —
   never overload the `locations` pincode catalog. Reverse-geocode + admin request-ping
   trigger (needs FCM/WS push) are explicitly DEFERRED (no producer/consumer yet).

## Data model (migration 0043)

`device_locations` (append-only event log): `id bigserial PK, user_id uuid→users,
latitude numeric(10,8), longitude numeric(11,8), accuracy numeric, recorded_at
timestamptz, source varchar(20) CHECK ('ADMIN_PING','TRACKING','TASK'), case_id uuid,
task_id uuid, requested_by_user_id uuid, operation_id varchar(255), created_at default
now()`. Unique partial idx on `operation_id` (idempotency). Idx `(user_id, recorded_at
DESC)`.

`latest_device_location` (one row/agent projection): `user_id uuid PK→users, latitude,
longitude, accuracy, recorded_at timestamptz, source varchar(20), updated_at default
now()`. Freshness-guard upsert `WHERE recorded_at <= EXCLUDED.recorded_at`.

`role_permissions` seeds: `(MANAGER,page.field_monitoring)`,
`(TEAM_LEADER,page.field_monitoring)`, `(FIELD_AGENT,location.capture)`. SA = grants_all.

(No `case_tasks.started_at` — deferred; aging uses `assigned_at`. There is no start-leg
producer yet.)

## API

- `POST /api/v2/location/capture` (gate `location.capture`) — the locked contract.
  Branch on `source`: TRACKING is shift-gated (403 `OUTSIDE_SHIFT_WINDOW` outside IST
  8-22); idempotency on `operation_id` (header `Idempotency-Key` or body fallback); dual
  write `device_locations` + `latest_device_location` (freshness guard); envelope
  `{success,message,data:{id,timestamp,accuracy}}`. Forward-prep — no live producer yet.
- `GET /api/v2/field-monitoring/agents` (gate `page.field_monitoring`) —
  `Paginated<FieldAgentView>`, scoped by `getScopedUserIds`. Per-agent aggregates from
  `case_tasks` (open / completed-today / overdue / oldest-open / last-activity) + territory
  counts + `latest_device_location` (null until GPS).
- `GET /api/v2/field-monitoring/stats` (gate `page.field_monitoring`) — counter bar
  (agents, withOpenWork, openTasks, completedToday, overdue), scope+search aware.
- `GET /api/v2/field-monitoring/export` (gate `data.export`) — DataGrid export of the
  roster.

`FieldAgentView`: `{ id, name, username, employeeId, phone, isActive, openTasks,
inProgress, completedToday, overdue, oldestOpenAssignedAt, lastActivityAt,
territoryPincodes, territoryAreas, lastLat, lastLng, lastLocationAt, lastLocationSource,
createdAt, updatedAt }`. `FieldMonitoringStats`: `{ agents, withOpenWork, openTasks,
completedToday, overdue }`.

## Web

`features/fieldMonitoring/FieldMonitoringPage.tsx` — clone of `PipelinePage`: counter bar
(scope-aware stats) + DataGrid over `/api/v2/field-monitoring/agents` (server pagination /
sort / search / export / URL state) + `refetchInterval`. Columns: Agent, Contact,
Territory, Open, In Progress, Completed Today, Overdue, Last Activity, Last Location
(coords + Maps link, `—` until GPS), Created/Updated. Activate the `Layout.tsx` nav slot
(`to:'/field-monitoring'`, `perm:'page.field_monitoring'`) + `App.tsx` route.

## Deferred (Phase 2, explicit)

- Admin "request location" ping trigger (needs FCM + WS push infra — none in v2).
- Reverse-geocode (address from coords) — show raw coords + Maps link until then.
- Live map view + websocket live-update (v1 itself chose table-only).
- `case_tasks.started_at` + the device start/complete ingest legs (separate mobile epic).
- `crm-mobile-native` rebase of `/location/capture` onto `/api/v2` (separate repo).
