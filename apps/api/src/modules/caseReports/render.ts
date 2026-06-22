import Handlebars from 'handlebars';
import { type CaseReportContext, DEFAULT_CASE_REPORT_TEMPLATE } from '@crm2/sdk';

// The page-geometry defaults + the built-in template now live in @crm2/sdk (single source: the renderer
// AND the admin Designer's "Load default" use the same constants). Re-exported for existing importers.
export { DEFAULT_PDF_PAGE_SIZE, DEFAULT_PDF_ORIENTATION, DEFAULT_CASE_REPORT_TEMPLATE } from '@crm2/sdk';

/**
 * CASE_REPORT HTML render (ADR-0041 S5 slice 2a). Compiles the active CASE_REPORT layout's HTML body
 * (or the built-in default below) against the assembled `CaseReportContext`, with Handlebars
 * AUTO-ESCAPE ON (noEscape:false — the engine default).
 *
 * ⭐ SECURITY (BLOCK-level invariant): the per-task `narrative` + raw `sections` + every field value
 * come from upstream as PLAIN TEXT (the FIELD_REPORT engine renders with noEscape:true). This is the
 * sink — `{{var}}` HTML-escapes them here, so an applicant name like `<script>` becomes inert text.
 * Templates MUST NOT use triple-stash `{{{var}}}` on any context value; the only raw interpolation is
 * structural HTML in the template itself, which is trusted (built-in default, or admin-authored under
 * report_template.manage with a `{{{`-reject lint gate at save in slice 3). The `nl2br` helper below
 * escapes FIRST, then converts newlines to <br> — it is the only SafeString producer and it never
 * emits unescaped user input.
 */

const hb: typeof Handlebars = Handlebars.create();

/** Equality block helper (mirrors fieldReports' `eq`) for outcome branching in templates. */
hb.registerHelper('eq', function (this: unknown, a: unknown, b: unknown, options?: Handlebars.HelperOptions) {
  if (options && typeof options.fn === 'function') return a === b ? options.fn(this) : options.inverse(this);
  return a === b;
});

/** Escape THEN convert newlines to <br>. Safe: escapeExpression runs before any markup is added, so
 *  no user input reaches the DOM unescaped. The only SafeString in the engine. */
hb.registerHelper('nl2br', (value: unknown) => {
  const escaped = Handlebars.escapeExpression(value == null ? '' : String(value));
  return new Handlebars.SafeString(escaped.replace(/\r?\n/g, '<br>'));
});

/** A value or an em-dash placeholder when null/empty (escaped by Handlebars at the call site). */
hb.registerHelper('orDash', (value: unknown) => {
  const s = value == null ? '' : String(value).trim();
  return s === '' ? '—' : s;
});

/** ISO timestamp → a short, locale-stable date string; '' when null. */
hb.registerHelper('fmtDate', (value: unknown) => {
  if (value == null || value === '') return '';
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return '';
  // YYYY-MM-DD — locale-stable, no time-zone surprises in a printed report.
  return d.toISOString().slice(0, 10);
});

/** A lat/long value to 6 decimal places (ADR-0060 photo overlay); '' when not a finite number. */
hb.registerHelper('coord', (value: unknown) => {
  if (value == null || value === '') return '';
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(6) : '';
});

/** ISO timestamp → "YYYY-MM-DD HH:MM", preserving the captured wall-clock (no time-zone shift in a
 *  printed report). '' when null/unparseable. Used for the field-photo capture time. */
hb.registerHelper('fmtDateTime', (value: unknown) => {
  if (value == null || value === '') return '';
  const s = String(value);
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/.exec(s);
  if (m) return `${m[1]} ${m[2]}`;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 16).replace('T', ' ');
});

/** A tiny inline-text badge helper (escaped). */
hb.registerHelper('badge', (value: unknown) => {
  const s = value == null ? '' : String(value);
  return new Handlebars.SafeString(`<span class="badge">${Handlebars.escapeExpression(s)}</span>`);
});

/**
 * Render the CASE_REPORT HTML. `layoutBody` is the active CASE_REPORT layout's `template_body`, or
 * null → the built-in default. Auto-escape is ON; prototype access blocked (defence-in-depth).
 */
export function renderCaseReportHtml(ctx: CaseReportContext, layoutBody: string | null): string {
  const compiled = hb.compile(layoutBody ?? DEFAULT_CASE_REPORT_TEMPLATE, { strict: false });
  return compiled(ctx, {
    allowProtoPropertiesByDefault: false,
    allowProtoMethodsByDefault: false,
  });
}
