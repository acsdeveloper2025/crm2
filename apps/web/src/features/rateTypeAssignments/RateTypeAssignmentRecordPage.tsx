import { useState } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CreateRateTypeAssignmentSchema,
  type Option,
  type VerificationUnitOption,
  type RateTypeOption,
  type RateTypeAssignment,
  type RateTypeAssignmentView,
} from '@crm2/sdk';
import { api, ApiError } from '../../lib/sdk.js';
import { zodFieldErrors } from '../../lib/zodForm.js';
import { useAuth } from '../../lib/AuthContext.js';
import { Button } from '../../components/ui/Button.js';
import { HexagonLoader } from '../../components/ui/HexagonLoader.js';
import { exitPath } from '../clientSetup/hubState.js';

const BASE = '/api/v2/rate-type-assignments';
const QK = 'rate-type-assignments';
const LIST_PATH = '/admin/rate-type-assignments';

// UX-3: when a concrete client + product has no CPV mapping, /cpv-units/available returns [] — warn
// (with a link to the CPV admin that fixes it) but leave the unit picker's behavior unchanged.
export const NO_CPV_MAPPING = 'This client + product has no CPV mapping yet';
export const CPV_ADMIN_PATH = '/admin/cpv';

/**
 * Rate-type-assignment create / detail as a full record-page route (mirrors CommissionRateRecordPage).
 * `/admin/rate-type-assignments/new` creates one (Client + Universal-able Product/Unit + Rate Type);
 * `/admin/rate-type-assignments/:id` loads that assignment by id and shows it read-only — its four fields
 * ARE the immutable unique key (NULLS-NOT-DISTINCT), so there is nothing to edit; re-creating the same
 * combo re-activates it. RBAC: `masterdata.manage` only (the server enforces it on POST too); a viewer who
 * deep-links to the create form is bounced back to the list.
 */
export function RateTypeAssignmentRecordPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { has } = useAuth();
  const isEdit = !!id;
  const exitTo = exitPath(searchParams.get('returnTo'), LIST_PATH);
  const existing = useQuery({
    queryKey: ['rate-type-assignment', id],
    queryFn: () => api<RateTypeAssignmentView>('GET', `${BASE}/${id}`),
    enabled: isEdit,
  });

  if (!has('masterdata.manage')) return <Navigate to="/admin/rate-type-assignments" replace />;
  if (isEdit && existing.isLoading) {
    return (
      <div className="py-10">
        <HexagonLoader operation="Loading rate type assignment" />
      </div>
    );
  }
  if (isEdit && (existing.isError || !existing.data)) {
    return (
      <div className="space-y-3">
        <Button variant="link" size="sm" onClick={() => navigate(exitTo)}>
          ← Back to rate type assignments
        </Button>
        <p className="text-sm text-muted-foreground">Couldn’t load this assignment.</p>
      </div>
    );
  }
  if (isEdit && existing.data) return <AssignmentDetail row={existing.data} exitTo={exitTo} />;
  return <AssignmentForm exitTo={exitTo} initialClientId={searchParams.get('clientId')} />;
}

/** Read-only detail for an existing assignment — every field is part of the immutable key. */
function AssignmentDetail({ row, exitTo }: { row: RateTypeAssignmentView; exitTo: string }) {
  const navigate = useNavigate();
  return (
    <div className="space-y-4">
      <Button variant="link" size="sm" onClick={() => navigate(exitTo)}>
        ← Back to rate type assignments
      </Button>
      <div>
        <h1 className="text-xl font-bold tracking-tight">Rate Type Assignment</h1>
        <p className="text-sm text-muted-foreground">
          The combination is the immutable key — to change a row, deactivate it and create a new one.
        </p>
      </div>
      <div className="max-w-md space-y-3 rounded-lg border border-border bg-card p-6 shadow-sm">
        <dl className="space-y-2 rounded-md border border-border p-3 text-sm">
          <ReadOnlyRow label="Client" value={row.clientName ?? row.clientCode} />
          <ReadOnlyRow
            label="Product"
            value={`${row.productCode ?? ''} ${row.productName ?? ''}`.trim() || null}
            universal
          />
          <ReadOnlyRow label="Verification Unit" value={row.verificationUnitName} universal />
          <ReadOnlyRow label="Rate Type" value={row.rateTypeCode} mono />
          <ReadOnlyRow label="Status" value={row.isActive ? 'Active' : 'Inactive'} />
        </dl>
      </div>
    </div>
  );
}

/** Create form — Client (required), Product/Unit (blank = Universal), Rate Type (required). */
function AssignmentForm({ exitTo, initialClientId }: { exitTo: string; initialClientId: string | null }) {
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [clientId, setClientId] = useState(initialClientId ?? '');
  const [productId, setProductId] = useState('');
  const [unitId, setUnitId] = useState('');
  const [rateTypeId, setRateTypeId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const clients = useQuery({
    queryKey: ['client-options'],
    queryFn: () => api<Option[]>('GET', '/api/v2/clients/options'),
  });
  const products = useQuery({
    queryKey: ['product-options'],
    queryFn: () => api<Option[]>('GET', '/api/v2/products/options'),
  });
  // ADR-0074: with a specific client + product chosen, the unit options are the CPV-mapped units (a
  // Universal CPV ⇒ all units); else (no product / Universal product) all active units.
  const unitCpvScoped = !!clientId && !!productId;
  const units = useQuery({
    queryKey: unitCpvScoped ? ['cpv-available-units', clientId, productId] : ['verification-unit-options'],
    queryFn: () =>
      unitCpvScoped
        ? api<{ id: number; code: string; name: string }[]>(
            'GET',
            `/api/v2/cpv-units/available?clientId=${clientId}&productId=${productId}`,
          )
        : api<VerificationUnitOption[]>('GET', '/api/v2/verification-units/options'),
  });
  const rateTypes = useQuery({
    queryKey: ['rate-types', 'options'],
    queryFn: () => api<RateTypeOption[]>('GET', '/api/v2/rate-types/options?active=true'),
  });
  const noCpvMapping = unitCpvScoped && units.isSuccess && units.data.length === 0;

  const mut = useMutation({
    mutationFn: () =>
      api<RateTypeAssignment>('POST', BASE, {
        clientId: Number(clientId),
        // Universal-able: blank ⇒ null ⇒ matches any.
        productId: productId ? Number(productId) : null,
        verificationUnitId: unitId ? Number(unitId) : null,
        rateTypeId: Number(rateTypeId),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [QK] });
      navigate(exitTo);
    },
    onError: (e: unknown) =>
      setError(e instanceof ApiError ? e.code : e instanceof Error ? e.message : 'Save failed'),
  });

  // Required-specific: client + rate type. Product/unit are Universal-able (blank ⇒ matches any).
  const valid = !!clientId && !!rateTypeId;

  return (
    <div className="space-y-4">
      <Button variant="link" size="sm" onClick={() => navigate(exitTo)}>
        ← Back to rate type assignments
      </Button>
      <div>
        <h1 className="text-xl font-bold tracking-tight">New Rate Type Assignment</h1>
        <p className="text-sm text-muted-foreground">
          Declare which rate type a Client × Product × Verification Unit combination may use. Required: client
          &amp; rate type. Product and unit can be Universal (matches any).
        </p>
      </div>

      <div className="max-w-md space-y-3 rounded-lg border border-border bg-card p-6 shadow-sm">
        <Field label="Client">
          <select className="input" value={clientId} onChange={(e) => setClientId(e.target.value)}>
            <option value="">Select a client…</option>
            {(clients.data ?? []).map((c) => (
              <option key={c.id} value={String(c.id)}>
                {c.name}
              </option>
            ))}
          </select>
          {fieldErrors['clientId'] && (
            <span className="mt-1 block text-xs text-destructive">{fieldErrors['clientId']}</span>
          )}
        </Field>
        <Field label="Product (blank = Universal)">
          <select className="input" value={productId} onChange={(e) => setProductId(e.target.value)}>
            <option value="">Universal (all products)</option>
            {(products.data ?? []).map((p) => (
              <option key={p.id} value={String(p.id)}>
                {p.code} — {p.name}
              </option>
            ))}
          </select>
          {fieldErrors['productId'] && (
            <span className="mt-1 block text-xs text-destructive">{fieldErrors['productId']}</span>
          )}
        </Field>
        <Field label="Verification Unit (blank = Universal)">
          <select className="input" value={unitId} onChange={(e) => setUnitId(e.target.value)}>
            <option value="">Universal (all units)</option>
            {(units.data ?? []).map((u) => (
              <option key={u.id} value={String(u.id)}>
                {u.code} — {u.name}
              </option>
            ))}
          </select>
          {noCpvMapping && (
            <span className="mt-1 block text-xs text-muted-foreground">
              {NO_CPV_MAPPING} —{' '}
              <Link to={CPV_ADMIN_PATH} className="text-primary hover:underline">
                map it in CPV
              </Link>
              .
            </span>
          )}
          {fieldErrors['verificationUnitId'] && (
            <span className="mt-1 block text-xs text-destructive">{fieldErrors['verificationUnitId']}</span>
          )}
        </Field>
        <Field label="Rate Type">
          <select
            className="input"
            value={rateTypeId}
            disabled={rateTypes.isLoading}
            onChange={(e) => setRateTypeId(e.target.value)}
          >
            <option value="">{rateTypes.isLoading ? 'Loading rate types…' : 'Select a rate type…'}</option>
            {(rateTypes.data ?? []).map((rt) => (
              <option key={rt.id} value={String(rt.id)}>
                {rt.code}
              </option>
            ))}
          </select>
          {rateTypes.isError && (
            <span className="mt-1 block text-xs text-destructive">Couldn’t load rate types.</span>
          )}
          {fieldErrors['rateTypeId'] && (
            <span className="mt-1 block text-xs text-destructive">{fieldErrors['rateTypeId']}</span>
          )}
        </Field>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={() => navigate(exitTo)} disabled={mut.isPending}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              setError(null);
              const errs = zodFieldErrors(CreateRateTypeAssignmentSchema, {
                clientId: clientId ? Number(clientId) : null,
                productId: productId ? Number(productId) : null,
                verificationUnitId: unitId ? Number(unitId) : null,
                rateTypeId: rateTypeId ? Number(rateTypeId) : null,
              });
              if (Object.keys(errs).length > 0) {
                setFieldErrors(errs);
                return;
              }
              setFieldErrors({});
              mut.mutate();
            }}
            disabled={!valid}
            loading={mut.isPending}
          >
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-foreground">{label}</span>
      {children}
    </label>
  );
}

/** One read-only line in the detail summary. `universal` renders blanks as "Universal". */
function ReadOnlyRow({
  label,
  value,
  mono,
  universal,
}: {
  label: string;
  value: string | null;
  mono?: boolean;
  universal?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className={`text-right text-foreground${mono ? ' font-mono text-xs' : ''}`}>
        {value ?? <span className="text-muted-foreground">{universal ? 'Universal' : '—'}</span>}
      </dd>
    </div>
  );
}
