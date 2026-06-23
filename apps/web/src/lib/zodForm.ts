/**
 * Run a @crm2/sdk create/update zod schema over a form's values and return field→message (the first
 * issue per top-level field). An empty object means the values are valid. Pure (unit-tested without
 * jsdom). This lets a record-page form surface inline per-field errors from the SAME schema the
 * server enforces — the single source of truth — WITHOUT adding a react-hook-form dependency to the
 * frozen stack (ADR-0051 fix-plan B1). Typed structurally so apps/web needs no direct `zod` dep.
 */
interface SafeParser {
  safeParse(value: unknown): {
    success: boolean;
    error?: { issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }> };
  };
}

export function zodFieldErrors(schema: SafeParser, values: unknown): Record<string, string> {
  const result = schema.safeParse(values);
  if (result.success || !result.error) return {};
  const errors: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = issue.path[0];
    // First issue per top-level field wins; nested paths collapse to their owning field.
    if (typeof key === 'string' && !(key in errors)) errors[key] = issue.message;
  }
  return errors;
}
