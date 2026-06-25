import { useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Option, RateTypeOption, VerificationUnitOption } from '@crm2/sdk';
import { api } from '../../lib/sdk.js';
import { useAuth } from '../../lib/AuthContext.js';
import { Button } from '../../components/ui/Button.js';
import { HexagonLoader } from '../../components/ui/HexagonLoader.js';

const QK_ASSIGNMENTS = 'rate-type-assignments';

// The "All verification units (Universal)" row maps to verificationUnitId: null. A real number can never
// equal this, so it's a safe sentinel for the per-row key. Universal product = '' in the <select> → null.
const UNIVERSAL_UNIT = 'universal' as const;

/**
 * ADR-0069 — what the API returns: verificationUnitId is nullable (null = the Universal/all-units row).
 * The SDK's RateTypeAssignment is mid-migration to this nullable shape (built in parallel); we read the
 * fields we need against the contract here rather than depending on the in-flight type.
 */
interface AssignmentRow {
  verificationUnitId: number | null;
  rateTypeId: number;
}

interface BulkBody {
  clientId: number;
  productId: number | null;
  verificationUnitId: number | null;
  rateTypeIds: number[];
}

/**
 * Rate Type Assignments (ADR-0069 — per-unit table). Pick a Client (required) and a Product ("All products
 * (Universal)" → null), then for each verification unit (a Universal "all units" row first, then one row per
 * active unit) tick which active rate types are available. One Save replaces the active set for every row
 * whose selection changed (bulk upsert per combo). Universal is rendered as the word, never NULL.
 * ponytail: the Client/Product selects are independent of the unit list (no CPV cascade) — this page is an
 * availability matrix, not a validated combo; reuse the /options feeds, don't wire a cascade it doesn't need.
 */
export function RateTypeAssignmentsPage() {
  const { has } = useAuth();
  const [clientId, setClientId] = useState('');
  const [productId, setProductId] = useState(''); // '' = All products (Universal)

  const clients = useQuery({
    queryKey: ['client-options'],
    queryFn: () => api<Option[]>('GET', '/api/v2/clients/options'),
  });
  const products = useQuery({
    queryKey: ['product-options'],
    queryFn: () => api<Option[]>('GET', '/api/v2/products/options'),
  });

  // RBAC self-guard (mirrors the masterdata-gated /options + bulk endpoints). After the hooks so the hook
  // order stays stable; a viewer who deep-links here is bounced to the dashboard.
  if (!has('page.masterdata')) return <Navigate to="/" replace />;

  const clientChosen = !!clientId;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold tracking-tight">Rate Type Assignments</h1>
        <p className="text-sm text-muted-foreground">
          Choose a client and (optionally) a product, then for each verification unit tick which active rate
          types apply. <span className="font-medium">Universal</span> rows apply to all products / all units.
          Saving replaces the active set for every row you changed.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <ComboSelect
          label="Client"
          value={clientId}
          onChange={setClientId}
          query={clients}
          options={clients.data ?? []}
        />
        <ProductSelect
          value={productId}
          onChange={setProductId}
          query={products}
          options={products.data ?? []}
        />
      </div>

      {!clientChosen ? (
        <p className="text-sm text-muted-foreground">
          Select a client above to load and edit its rate-type assignments.
        </p>
      ) : (
        // Re-mount per combo (key) so every per-row selection re-seeds cleanly from THIS combo's assignments.
        <CombinationTable
          key={`${clientId}:${productId}`}
          clientId={Number(clientId)}
          productId={productId ? Number(productId) : null}
        />
      )}
    </div>
  );
}

function ComboSelect({
  label,
  value,
  onChange,
  query,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  query: { isLoading: boolean; isError: boolean };
  options: Option[];
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-foreground">{label}</span>
      <select
        className="input w-full"
        value={value}
        disabled={query.isLoading || query.isError}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">
          {query.isLoading ? 'Loading…' : query.isError ? 'Failed to load' : `Select ${label.toLowerCase()}…`}
        </option>
        {options.map((o) => (
          <option key={o.id} value={String(o.id)}>
            {o.code} — {o.name}
          </option>
        ))}
      </select>
    </label>
  );
}

// Product select with a leading "All products (Universal)" option ('' → null = Universal across all products).
function ProductSelect({
  value,
  onChange,
  query,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  query: { isLoading: boolean; isError: boolean };
  options: Option[];
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-foreground">Product</span>
      <select
        className="input w-full"
        value={value}
        disabled={query.isLoading || query.isError}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">
          {query.isLoading ? 'Loading…' : query.isError ? 'Failed to load' : 'All products (Universal)'}
        </option>
        {options.map((o) => (
          <option key={o.id} value={String(o.id)}>
            {o.code} — {o.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function ErrorRetry({ label, onRetry }: { label: string; onRetry: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <p className="text-sm text-destructive">{label}</p>
      <Button variant="secondary" size="sm" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}

/**
 * Loads the three combo-scoped queries (assignments for client[+product], the active rate-type catalog, the
 * active verification units) and, once all three are here, re-mounts the editable table seeded from the data.
 */
function CombinationTable({ clientId, productId }: { clientId: number; productId: number | null }) {
  const productParam = productId === null ? '' : `&productId=${productId}`;
  const assignments = useQuery({
    queryKey: [QK_ASSIGNMENTS, clientId, productId],
    queryFn: () =>
      api<AssignmentRow[]>('GET', `/api/v2/rate-type-assignments?clientId=${clientId}${productParam}`),
  });
  const catalog = useQuery({
    queryKey: ['rate-type-options', 'active'],
    queryFn: () => api<RateTypeOption[]>('GET', '/api/v2/rate-types/options?active=true'),
  });
  const units = useQuery({
    queryKey: ['verification-unit-options'],
    queryFn: () => api<VerificationUnitOption[]>('GET', '/api/v2/verification-units/options'),
  });

  if (assignments.isLoading || catalog.isLoading || units.isLoading) {
    return (
      <div className="py-6">
        <HexagonLoader operation="Loading assignments" />
      </div>
    );
  }
  if (assignments.isError || !assignments.data) {
    return (
      <ErrorRetry
        label="Couldn’t load this client’s assignments."
        onRetry={() => void assignments.refetch()}
      />
    );
  }
  if (catalog.isError || !catalog.data) {
    return <ErrorRetry label="Couldn’t load rate types." onRetry={() => void catalog.refetch()} />;
  }
  if (units.isError || !units.data) {
    return <ErrorRetry label="Couldn’t load verification units." onRetry={() => void units.refetch()} />;
  }

  if (catalog.data.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No active rate types — add some in <span className="font-medium">Rate Types</span> first.
      </p>
    );
  }

  // Re-mount the editor whenever the loaded set changes (key off the assignment ids) so per-row selection
  // initialises from the server set without an effect.
  const seedKey = assignments.data
    .map((a) => `${a.verificationUnitId ?? UNIVERSAL_UNIT}:${a.rateTypeId}`)
    .sort()
    .join('|');
  return (
    <TableEditor
      key={seedKey}
      clientId={clientId}
      productId={productId}
      catalog={catalog.data}
      units={units.data}
      assignments={assignments.data}
      onSaved={() => void assignments.refetch()}
    />
  );
}

// One editable row in the matrix. The Universal "all units" row uses unitId === null.
interface Row {
  key: string; // UNIVERSAL_UNIT or the numeric unit id as a string
  unitId: number | null;
  label: string; // "All verification units (Universal)" or "CODE — name"
  search: string; // lower-cased haystack for the search box (Universal always matches)
}

function TableEditor({
  clientId,
  productId,
  catalog,
  units,
  assignments,
  onSaved,
}: {
  clientId: number;
  productId: number | null;
  catalog: RateTypeOption[];
  units: VerificationUnitOption[];
  assignments: AssignmentRow[];
  onSaved: () => void;
}) {
  const qc = useQueryClient();
  const [query, setQuery] = useState('');
  const [saved, setSaved] = useState(false);

  // Group the loaded assignments by unit (null → the Universal row) into the seeded sets.
  const loaded = useMemo(() => {
    const m = new Map<string, Set<number>>();
    for (const a of assignments) {
      const k = a.verificationUnitId === null ? UNIVERSAL_UNIT : String(a.verificationUnitId);
      const s = m.get(k) ?? new Set<number>();
      s.add(a.rateTypeId);
      m.set(k, s);
    }
    return m;
  }, [assignments]);

  // Current (editable) selection per row, copied from the loaded sets at mount (parent re-mounts per combo).
  const [selected, setSelected] = useState<Map<string, Set<number>>>(() => {
    const m = new Map<string, Set<number>>();
    for (const [k, s] of loaded) m.set(k, new Set(s));
    return m;
  });

  const rows = useMemo<Row[]>(() => {
    const universal: Row = {
      key: UNIVERSAL_UNIT,
      unitId: null,
      label: 'All verification units (Universal)',
      search: 'all verification units universal',
    };
    const unitRows = units.map<Row>((u) => ({
      key: String(u.id),
      unitId: u.id,
      label: `${u.code} — ${u.name}`,
      search: `${u.code} ${u.name}`.toLowerCase(),
    }));
    return [universal, ...unitRows];
  }, [units]);

  const visibleRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    // The Universal row always stays visible — it's the cross-cutting default, hiding it would be confusing.
    return rows.filter((r) => r.unitId === null || r.search.includes(q));
  }, [rows, query]);

  const selectionFor = (key: string): Set<number> => selected.get(key) ?? new Set<number>();

  const toggle = (key: string, rateTypeId: number) => {
    setSaved(false);
    setSelected((prev) => {
      const next = new Map(prev);
      const cur = new Set(next.get(key) ?? []);
      if (cur.has(rateTypeId)) cur.delete(rateTypeId);
      else cur.add(rateTypeId);
      next.set(key, cur);
      return next;
    });
  };

  // A row is dirty when its selected set differs from the loaded set (order-independent set compare).
  const dirtyRows = useMemo(() => {
    return rows.filter((r) => {
      const cur = selected.get(r.key) ?? new Set<number>();
      const was = loaded.get(r.key) ?? new Set<number>();
      if (cur.size !== was.size) return true;
      for (const id of cur) if (!was.has(id)) return true;
      return false;
    });
  }, [rows, selected, loaded]);

  const save = useMutation({
    mutationFn: async () => {
      // One bulk call per CHANGED row only (unchanged rows are left untouched).
      for (const r of dirtyRows) {
        const body: BulkBody = {
          clientId,
          productId,
          verificationUnitId: r.unitId,
          rateTypeIds: [...(selected.get(r.key) ?? [])],
        };
        await api('POST', '/api/v2/rate-type-assignments/bulk', body);
      }
    },
    onSuccess: () => {
      setSaved(true);
      void qc.invalidateQueries({ queryKey: [QK_ASSIGNMENTS, clientId, productId] });
      onSaved();
    },
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <input
          type="search"
          className="input w-full max-w-xs"
          placeholder="Search verification units…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search verification units"
        />
        <span className="text-xs text-muted-foreground">
          {dirtyRows.length === 0
            ? 'No changes'
            : `${dirtyRows.length} row${dirtyRows.length === 1 ? '' : 's'} changed`}
        </span>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="rtable w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase text-muted-foreground">
              <th scope="col" className="px-3 py-2 font-medium">
                Verification Unit
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Rate Types
              </th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.length === 0 ? (
              <tr>
                <td colSpan={2} className="px-3 py-4 text-center text-sm text-muted-foreground">
                  No verification units match “{query}”.
                </td>
              </tr>
            ) : (
              visibleRows.map((r) => {
                const sel = selectionFor(r.key);
                return (
                  <tr key={r.key} className="border-b border-border last:border-b-0 align-top">
                    <td data-label="Verification Unit" className="px-3 py-2 font-medium">
                      {r.label}
                    </td>
                    <td data-label="Rate Types" className="px-3 py-2">
                      <div className="flex flex-wrap gap-2">
                        {catalog.map((rt) => {
                          const on = sel.has(rt.id);
                          return (
                            <label
                              key={rt.id}
                              className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors ${
                                on
                                  ? 'border-primary bg-primary/10 text-primary'
                                  : 'border-border bg-background text-muted-foreground hover:border-foreground/30'
                              }`}
                            >
                              <input
                                type="checkbox"
                                className="sr-only"
                                checked={on}
                                onChange={() => toggle(r.key, rt.id)}
                              />
                              <span className="font-mono uppercase">{rt.code}</span>
                              <span className="opacity-70">({rt.category})</span>
                            </label>
                          );
                        })}
                      </div>
                      {sel.size === 0 && (
                        <span className="mt-1 block text-xs text-muted-foreground">(none)</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="primary"
          loading={save.isPending}
          disabled={dirtyRows.length === 0}
          onClick={() => save.mutate()}
        >
          Save
        </Button>
        {saved && !save.isPending && <span className="text-sm text-success">Saved.</span>}
        {save.isError && <span className="text-sm text-destructive">Save failed.</span>}
      </div>
    </div>
  );
}
