import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Option, RateTypeAssignment, RateTypeOption, VerificationUnitOption } from '@crm2/sdk';
import { api } from '../../lib/sdk.js';
import { useAuth } from '../../lib/AuthContext.js';
import { Button } from '../../components/ui/Button.js';
import { HexagonLoader } from '../../components/ui/HexagonLoader.js';

const QK_ASSIGNMENTS = 'rate-type-assignments';

/**
 * Rate Type Assignments (ADR-0067 Phase B) — pick a Client × Product × Verification Unit combo, then
 * tick which active rate types are available for it. Save replaces the combo's active set (bulk upsert).
 * ponytail: the three combo selects are INDEPENDENT (no CPV cascade) — harmless here, the matrix only
 * loads once all three are chosen and the combo isn't validated against CPV mapping; reuse the existing
 * /options feeds rather than wiring a cascade that this page doesn't need.
 */
export function RateTypeAssignmentsPage() {
  const { has } = useAuth();
  const [clientId, setClientId] = useState('');
  const [productId, setProductId] = useState('');
  const [unitId, setUnitId] = useState('');

  const clients = useQuery({
    queryKey: ['client-options'],
    queryFn: () => api<Option[]>('GET', '/api/v2/clients/options'),
  });
  const products = useQuery({
    queryKey: ['product-options'],
    queryFn: () => api<Option[]>('GET', '/api/v2/products/options'),
  });
  const units = useQuery({
    queryKey: ['verification-unit-options'],
    queryFn: () => api<VerificationUnitOption[]>('GET', '/api/v2/verification-units/options'),
  });
  // The checkbox universe = every ACTIVE rate type (the SDK exposes this same call as rateTypes.list()).
  const rateTypes = useQuery({
    queryKey: ['rate-type-options', 'active'],
    queryFn: () => api<RateTypeOption[]>('GET', '/api/v2/rate-types/options?active=true'),
  });

  // RBAC self-guard (mirrors the masterdata-gated /options + bulk endpoints). After the hooks so the
  // hook order stays stable; a viewer who deep-links here is bounced to the dashboard.
  if (!has('page.masterdata')) return <Navigate to="/" replace />;

  const comboChosen = !!clientId && !!productId && !!unitId;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold tracking-tight">Rate Type Assignments</h1>
        <p className="text-sm text-muted-foreground">
          Choose a client, product and verification unit, then tick which active rate types apply to that
          combination. Saving replaces the combination’s active set.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <ComboSelect
          label="Client"
          value={clientId}
          onChange={setClientId}
          query={clients}
          options={clients.data ?? []}
        />
        <ComboSelect
          label="Product"
          value={productId}
          onChange={setProductId}
          query={products}
          options={products.data ?? []}
        />
        <ComboSelect
          label="Verification Unit"
          value={unitId}
          onChange={setUnitId}
          query={units}
          options={units.data ?? []}
        />
      </div>

      {!comboChosen ? (
        <p className="text-sm text-muted-foreground">
          Select all three above to load and edit this combination’s rate types.
        </p>
      ) : rateTypes.isLoading ? (
        <div className="py-6">
          <HexagonLoader operation="Loading rate types" />
        </div>
      ) : rateTypes.isError ? (
        <ErrorRetry label="Couldn’t load rate types." onRetry={() => void rateTypes.refetch()} />
      ) : (rateTypes.data ?? []).length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No active rate types — add some in <span className="font-medium">Rate Types</span> first.
        </p>
      ) : (
        // Re-mount per combo (key) so the checkbox set re-seeds cleanly from THIS combo's assignments.
        <AssignmentMatrix
          key={`${clientId}:${productId}:${unitId}`}
          clientId={Number(clientId)}
          productId={Number(productId)}
          unitId={Number(unitId)}
          rateTypes={rateTypes.data ?? []}
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
 * The checkbox matrix for ONE chosen combo. Loads the combo's ACTIVE assignments, seeds the checked set
 * from their `rateTypeId`s (once, on mount — the parent re-mounts this per combo via key), and on Save
 * replaces the active set via the bulk endpoint.
 */
function AssignmentMatrix({
  clientId,
  productId,
  unitId,
  rateTypes,
}: {
  clientId: number;
  productId: number;
  unitId: number;
  rateTypes: RateTypeOption[];
}) {
  const qc = useQueryClient();
  const assignments = useQuery({
    queryKey: [QK_ASSIGNMENTS, clientId, productId, unitId],
    queryFn: () =>
      api<RateTypeAssignment[]>(
        'GET',
        `/api/v2/rate-type-assignments?clientId=${clientId}&productId=${productId}&verificationUnitId=${unitId}`,
      ),
  });

  if (assignments.isLoading) {
    return (
      <div className="py-6">
        <HexagonLoader operation="Loading assignments" />
      </div>
    );
  }
  if (assignments.isError || !assignments.data) {
    return <ErrorRetry label="Couldn’t load this combination." onRetry={() => void assignments.refetch()} />;
  }
  // Seed once the data is here, then re-mount the editor per loaded set (key off the active ids) so the
  // checkbox state initialises from the server set without an effect.
  const seed = assignments.data.map((a) => a.rateTypeId);
  return (
    <MatrixEditor
      key={seed
        .slice()
        .sort((a, b) => a - b)
        .join(',')}
      clientId={clientId}
      productId={productId}
      unitId={unitId}
      rateTypes={rateTypes}
      seed={seed}
      onSaved={() => void qc.invalidateQueries({ queryKey: [QK_ASSIGNMENTS, clientId, productId, unitId] })}
    />
  );
}

function MatrixEditor({
  clientId,
  productId,
  unitId,
  rateTypes,
  seed,
  onSaved,
}: {
  clientId: number;
  productId: number;
  unitId: number;
  rateTypes: RateTypeOption[];
  seed: number[];
  onSaved: () => void;
}) {
  const [checked, setChecked] = useState<Set<number>>(() => new Set(seed));
  const [saved, setSaved] = useState(false);

  const save = useMutation({
    mutationFn: () =>
      api<RateTypeAssignment[]>('POST', '/api/v2/rate-type-assignments/bulk', {
        clientId,
        productId,
        verificationUnitId: unitId,
        rateTypeIds: [...checked],
      }),
    onSuccess: () => {
      setSaved(true);
      onSaved();
    },
  });

  const toggle = (id: number) => {
    setSaved(false);
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="space-y-4">
      <fieldset className="rounded-lg border border-border bg-card p-4">
        <legend className="px-1 text-sm font-medium text-foreground">Rate types</legend>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {rateTypes.map((rt) => (
            <label key={rt.id} className="flex items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-border accent-primary"
                checked={checked.has(rt.id)}
                onChange={() => toggle(rt.id)}
              />
              <span className="font-mono uppercase">{rt.code}</span>
              <span className="text-xs text-muted-foreground">({rt.category})</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>
          Save
        </Button>
        {saved && !save.isPending && <span className="text-sm text-success">Saved.</span>}
        {save.isError && <span className="text-sm text-destructive">Save failed.</span>}
      </div>
    </div>
  );
}
