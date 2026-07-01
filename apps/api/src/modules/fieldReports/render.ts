import type { TaskRenderContext } from './repository.js';
import { hb } from './helpers.js';

/** The column fields the renderer actually reads — the variable key + its source binding. Satisfied by
 *  BOTH a stored `ReportLayoutColumn` row AND a `FIELD_REPORT_DEFAULTS` catalog entry
 *  (`ReportLayoutColumnInput`), so the service renders a custom layout or a standard default through the
 *  same path with no read-model-only fields (id/displayOrder/options/…) to fabricate. `sourceType` is a
 *  plain string — `resolveColumnValue` switches on the known kinds and falls back to '' for the rest. */
export interface RenderColumn {
  columnKey: string;
  sourceType: string;
  sourceRef?: string | null;
}

/**
 * FIELD_REPORT render (ADR-0039). A layout's columns are its VARIABLE CATALOG: each `columnKey` is a
 * Handlebars variable resolved from a bound source, then the `templateBody` is compiled+run against
 * that context (with the grammar helper library — see helpers.ts). Templates are the built-in standard
 * defaults (`FIELD_REPORT_DEFAULTS`; the admin-authored override layer was removed in ADR-0083). Data
 * values are HTML-escaped by Handlebars default (output-encoding); json-paths are walked by property
 * access only (param-bound, never eval'd). Prototype access is blocked by Handlebars' runtime options.
 */

/** Walk a dot-path into the form blob by plain property access (no eval, no interpolation). */
function walkPath(root: unknown, path: string | null | undefined): unknown {
  if (!path) return undefined;
  let cur: unknown = root;
  for (const seg of path.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

/** Resolve one catalog column to its value for this task. Sources not meaningful for a field
 *  narrative (rate/commission/TAT/data-entry/doc-count/computed) resolve to '' in v1. */
export function resolveColumnValue(col: RenderColumn, ctx: TaskRenderContext): unknown {
  const ref = col.sourceRef ?? undefined;
  switch (col.sourceType) {
    case 'FORM_DATA_PATH':
      return walkPath(ctx.formData, ref);
    case 'TASK_FIELD':
      return ref ? ctx.task[ref] : undefined;
    case 'CASE_FIELD':
      return ref ? ctx.case[ref] : undefined;
    case 'APPLICANT_FIELD':
      return ref ? ctx.applicant[ref] : undefined;
    default:
      return '';
  }
}

/** Build the Handlebars context keyed by columnKey. Missing/null values become '' so a "smart"
 *  placeholder renders empty (v1 parity) rather than the literal "undefined". */
export function buildContext(columns: RenderColumn[], ctx: TaskRenderContext): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const col of columns) {
    const v = resolveColumnValue(col, ctx);
    out[col.columnKey] = v === undefined || v === null ? '' : v;
  }
  return out;
}

/** Collapse the whitespace left by empty placeholders (v1's clean-up): runs of spaces → one, trim
 *  around newlines, at most one blank line, trim ends. */
function cleanWhitespace(s: string): string {
  return s
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Render the narrative for one task against a FIELD_REPORT layout's body + variable catalog. */
export function renderNarrative(
  templateBody: string,
  columns: RenderColumn[],
  ctx: TaskRenderContext,
): string {
  const data = buildContext(columns, ctx);
  // noEscape: the narrative is PLAIN TEXT (must match v1's literal output, e.g. `shows the name "X"`,
  // not HTML entities). XSS-safety is the CONSUMER's responsibility — the #6 card renders it as a React
  // text node (auto-escaped); the S5 PDF/Word/HTML renderers MUST output-encode for their context.
  const compiled = hb.compile(templateBody, { noEscape: true, strict: false });
  const raw = compiled(data, {
    // block prototype access (defence-in-depth; data is a plain object anyway).
    allowProtoPropertiesByDefault: false,
    allowProtoMethodsByDefault: false,
  });
  return cleanWhitespace(raw);
}
