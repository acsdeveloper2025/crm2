/**
 * @crm2/sdk — field form templates (mobile parity). The field app's `loadTemplate` renders from its
 * bundled (compiled-in) templates FIRST and only falls through to GET /api/v2/forms/:formType/template
 * for a type it doesn't bundle, handling a null body gracefully. v2 has no server-side field-form
 * template engine, so this endpoint returns a BARE `null` (ADR-0054, no `{success,data}` envelope —
 * use the bundled template) — a compatibility stub, intentionally not a port of the device's
 * ~7.7k-line template builders.
 */
export type FormTemplateResponse = null;
