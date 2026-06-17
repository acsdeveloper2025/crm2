/**
 * Scope-dimension registry (ADR-0022) — the CODE half of the dimension catalog. The DB rows in
 * `scope_dimensions` mirror this registry; what stays code-owned is everything that touches the
 * schema: which catalog table validates an ID-kind reference, which locations column backs a
 * VALUE-kind dimension, and (slice 4) the parameterized predicate each dimension contributes to
 * a list WHERE. Adding a dimension = one reviewed entry here + a catalog row; everything else
 * about it (which roles hold it, EXPAND/RESTRICT, the assignments) is admin data.
 */
export type DimensionCode =
  | 'CLIENT'
  | 'PRODUCT'
  | 'PINCODE'
  | 'AREA'
  | 'STATE'
  | 'CITY'
  | 'VERIFICATION_TYPE';

export interface DimensionDef {
  code: DimensionCode;
  entityKind: 'ID' | 'VALUE';
  /** ID-kind: the catalog table whose `id` an assignment references (existence-validated at
   *  write time — catalogs deactivate rather than hard-DELETE, so refs cannot dangle). */
  catalogTable?: 'clients' | 'products' | 'locations' | 'verification_units';
  /** VALUE-kind: the `locations` column holding the legal values (state / city). */
  valueColumn?: 'state' | 'city';
  /** SQL expression labelling one assigned entity for display (aliased catalog row `e`). */
  labelExpr: string;
  /** The dimension's CASE-visibility leg. Contract: the cases table is aliased `cs`; the values
   *  array is pushed onto `params` and the returned fragment references its placeholder. */
  casePredicate(params: unknown[], values: Array<number | string>): string;
  /** TASK-level leg (Pipeline task lists). Contract: FROM aliases `case_tasks ct` JOIN `cases cs`,
   *  so cs-based case legs remain valid as the fallback; a dimension declares this only when the
   *  task grain has a more precise leg (VERIFICATION_TYPE: the task's own unit, not the case's
   *  whole unit set). Omitted → `casePredicate` is used. */
  taskPredicate?(params: unknown[], values: Array<number | string>): string;
}

/** Push the values array and return its placeholder — every predicate leg is parameterized. */
function pushParam(params: unknown[], values: Array<number | string>, cast: string): string {
  params.push(values);
  return `$${params.length}::${cast}`;
}

export const DIMENSIONS: Record<DimensionCode, DimensionDef> = {
  CLIENT: {
    code: 'CLIENT',
    entityKind: 'ID',
    catalogTable: 'clients',
    labelExpr: `e.name`,
    casePredicate: (p, v) => `cs.client_id = ANY(${pushParam(p, v, 'int[]')})`,
  },
  PRODUCT: {
    code: 'PRODUCT',
    entityKind: 'ID',
    catalogTable: 'products',
    labelExpr: `e.name`,
    casePredicate: (p, v) => `cs.product_id = ANY(${pushParam(p, v, 'int[]')})`,
  },
  PINCODE: {
    code: 'PINCODE',
    entityKind: 'ID',
    catalogTable: 'locations',
    labelExpr: `e.pincode || ' — ' || e.area || ', ' || e.city`,
    casePredicate: (p, v) => `cs.pincode_id = ANY(${pushParam(p, v, 'int[]')})`,
  },
  AREA: {
    code: 'AREA',
    entityKind: 'ID',
    catalogTable: 'locations',
    labelExpr: `e.area || ' (' || e.pincode || '), ' || e.city`,
    casePredicate: (p, v) => `cs.area_id = ANY(${pushParam(p, v, 'int[]')})`,
  },
  STATE: {
    code: 'STATE',
    entityKind: 'VALUE',
    valueColumn: 'state',
    labelExpr: `''`,
    casePredicate: (p, v) =>
      `EXISTS (SELECT 1 FROM locations sl WHERE sl.id = cs.pincode_id AND sl.state = ANY(${pushParam(p, v, 'text[]')}))`,
  },
  CITY: {
    code: 'CITY',
    entityKind: 'VALUE',
    valueColumn: 'city',
    labelExpr: `''`,
    casePredicate: (p, v) =>
      `EXISTS (SELECT 1 FROM locations sl WHERE sl.id = cs.pincode_id AND sl.city = ANY(${pushParam(p, v, 'text[]')}))`,
  },
  VERIFICATION_TYPE: {
    code: 'VERIFICATION_TYPE',
    entityKind: 'ID',
    catalogTable: 'verification_units',
    labelExpr: `e.name`,
    casePredicate: (p, v) =>
      `EXISTS (SELECT 1 FROM case_tasks vt_ct WHERE vt_ct.case_id = cs.id AND vt_ct.verification_unit_id = ANY(${pushParam(p, v, 'int[]')}))`,
    // Task grain: the row's OWN unit — a VT-scoped user sees only the matching tasks of a case,
    // never its sibling tasks (the deferred "task-level leg", activated with Pipeline).
    taskPredicate: (p, v) => `ct.verification_unit_id = ANY(${pushParam(p, v, 'int[]')})`,
  },
};

export function dimensionDef(code: string): DimensionDef | undefined {
  return (DIMENSIONS as Record<string, DimensionDef>)[code];
}
