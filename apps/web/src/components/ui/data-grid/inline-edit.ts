/**
 * Pure helpers for the DataGrid inline-edit layer (ADR-0051 — editable grid, no modal forms).
 * Kept free of React/DOM so they're unit-testable (no jsdom): seeding a row draft, validating it,
 * and building the values payload the page sends to its existing PUT/POST endpoint (which still
 * enforces scope/ownership + OCC server-side — the grid is UI only).
 */

export type CellEditorKind = 'text' | 'date' | 'select';

/** One editable column, distilled from a DataGridColumn for the edit machinery. */
export interface EditableField {
  field: string;
  editor: CellEditorKind;
  required?: boolean;
  /** Inline validator → an error message, or null when valid. */
  validate?: (value: string) => string | null;
}

/** Validate a draft against its fields; returns a field→message map (empty when all valid). */
export function validateDraft(
  draft: Record<string, string>,
  fields: EditableField[],
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const f of fields) {
    const raw = draft[f.field] ?? '';
    if (f.required && raw.trim() === '') {
      errors[f.field] = 'Required';
      continue;
    }
    const msg = f.validate?.(raw);
    if (msg) errors[f.field] = msg;
  }
  return errors;
}

/** True when a validateDraft result carries no errors. */
export function isDraftValid(errors: Record<string, string>): boolean {
  return Object.keys(errors).length === 0;
}

/** First error message in a validateDraft result (for a single row-level message), or null. */
export function firstError(errors: Record<string, string>): string | null {
  const keys = Object.keys(errors);
  return keys.length > 0 ? (errors[keys[0]!] ?? null) : null;
}

/** Tooltip for a `createOnly` cell on an existing row (UX-12) — set once at creation, never editable after. */
export const LOCKED_CELL_TITLE = 'Locked — set at creation';

/**
 * True when a cell should render the immutable-code affordance (muted + lock glyph + title,
 * UX-12): a `createOnly` column, but only on an existing row — while `creating` (the add-row
 * draft) the same column is still a live editable input, not locked.
 */
export function isLockedCell(col: { createOnly?: boolean; editable?: boolean }, creating: boolean): boolean {
  return !!col.createOnly && !creating;
}
