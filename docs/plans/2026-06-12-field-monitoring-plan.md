# Field Monitoring — build plan (2026-06-12)

Spec: `docs/specs/2026-06-12-field-monitoring-design.md` · ADR-0026. Next mig = **0043**.

Slices (one logical commit each at green gate; PUSH pauses for owner OK):

1. **mig 0043** — `device_locations` + `latest_device_location` tables + idx + the 3
   `role_permissions` seeds. Apply dev :54329 + test :5433.
2. **@crm2/access** — `FIELD_MONITORING_VIEW='page.field_monitoring'` +
   `LOCATION_CAPTURE='location.capture'` in PERMISSIONS/PERMISSION_META/ROLE_PERMISSIONS
   (MANAGER+TL get view, FIELD_AGENT gets capture). Parity test stays green.
3. **@crm2/sdk** — `location.ts` (LocationCaptureRequest/Response, LOCATION_SOURCES) +
   `fieldMonitoring.ts` (FieldAgentView, FieldMonitoringStats) + client `location.capture`
   / `fieldMonitoring.{agents,stats,export}` + index exports.
4. **API location module** — `modules/location/` (repo/service/controller/routes):
   `POST /location/capture`, locked contract (shift gate, idempotency, dual write,
   envelope). Mount in app.ts.
5. **API field-monitoring module** — `modules/field-monitoring/` (repo/service/controller/
   routes): `/agents` + `/stats` + `/export`, scoped via `getScopedUserIds`. Mount.
6. **Web** — `features/fieldMonitoring/FieldMonitoringPage.tsx` (clone PipelinePage) +
   activate nav slot (Layout.tsx) + route (App.tsx).
7. **Tests + gate + browser-verify + local commit** — sdk contract specs; api integration
   (location capture happy/shift-gate/idempotency; field-monitoring roster scope + stats +
   export). `pnpm verify` EXIT=0 + browser-verify on dev :4000/:5273.

Verification: `LC_ALL=C DATABASE_URL=postgresql://postgres@127.0.0.1:5433/crm2_test pnpm
verify`. Dev API :4000 with the MinIO env. Browser admin/admin123.
