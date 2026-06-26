import { useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CreateRateSchema,
  ReviseRateSchema,
  type Option,
  type VerificationUnitOption,
  type Rate,
  type RateView,
  type RateTypeOption,
  type Location,
  type Paginated,
} from '@crm2/sdk';
import { api, ApiError } from '../../lib/sdk.js';
import { zodFieldErrors } from '../../lib/zodForm.js';
import { toDateInput, toIsoDate, formatMoney } from '../../lib/format.js';
import { useAuth } from '../../lib/AuthContext.js';
import { ConflictDialog } from '../../components/ConflictDialog.js';
import { Button } from '../../components/ui/Button.js';
import { HexagonLoader } from '../../components/ui/HexagonLoader.js';
import { SearchableSelect, type Opt } from '../../components/ui/SearchableSelect.js';

const BASE = '/api/v2/rates';
const QK = 'rates';
const HTTP_CONFLICT = 409;
const isStale = (e: unknown): e is ApiError =>
  e instanceof ApiError && e.status === HTTP_CONFLICT && e.code === 'STALE_UPDATE';

// ADR-0071: product / verification unit can be Universal (a rate for ALL products / ALL units of a
// client). The select carries this sentinel; the payload sends null (= Universal) for it.
const UNIVERSAL = 'UNIVERSAL';
const toDim = (v: string): number | null => (v === UNIVERSAL ? null : Number(v));

/**
 * Rate create/revise as a full record-page route (ADR-0051 Wave-4 D4 — no modal).
 * `/admin/rates/new` creates (the full client→product→unit→pincode→area cascade);
 * `/admin/rates/:id` loads that rate by id and revises it (amount + effective-from only — keys are
 * immutable, revise appends an effective-dated version). RBAC: `masterdata.manage` only; a viewer who
 * deep-links here is bounced back to the list.
 */
export function RateRecordPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { has } = useAuth();
  const isEdit = !!id;
  const existing = useQuery({
    queryKey: ['rate', id],
    queryFn: () => api<RateView>('GET', `${BASE}/${id}`),
    enabled: isEdit,
  });

  if (!has('masterdata.manage')) return <Navigate to="/admin/rates" replace />;
  if (isEdit && existing.isLoading) {
    return (
      <div className="py-10">
        <HexagonLoader operation="Loading rate" />
      </div>
    );
  }
  if (isEdit && (existing.isError || !existing.data)) {
    return (
      <div className="space-y-3">
        <Button variant="link" size="sm" onClick={() => navigate('/admin/rates')}>
          ← Back to rate management
        </Button>
        <p className="text-sm text-muted-foreground">Couldn’t load this rate.</p>
      </div>
    );
  }
  // Re-mount the form per record (key) so its state seeds cleanly from the loaded rate.
  return <RateForm key={id ?? 'new'} initial={existing.data ?? null} />;
}

/**
 * Asymmetric form. CREATE (initial null) renders the full cascade (client required; product + unit can be
 * Universal = all, ADR-0071; pincode→area + rate type are field-only, greyed for KYC) and POSTs.
 * REVISE (initial set) shows every dimension read-only and edits only amount + effective-from,
 * POSTing to `…/:id/revise` with the OCC version.
 */
function RateForm({ initial }: { initial: RateView | null }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const isRevise = !!initial;

  // Create cascade state (unused in revise — every dimension is fixed there).
  const [clientId, setClientId] = useState('');
  const [productId, setProductId] = useState('');
  const [mode, setMode] = useState('FIELD');
  const [unitId, setUnitId] = useState('');
  const [pincode, setPincode] = useState('');
  const [pincodeSearch, setPincodeSearch] = useState('');
  const [locationId, setLocationId] = useState('');
  const [clientRateType, setRateType] = useState('');

  // Shared (both modes) — amount kept WYSIWYG (string), coerced at submit.
  const [amount, setAmount] = useState(initial ? String(initial.amount) : '');
  const [effectiveFrom, setEffectiveFrom] = useState(toDateInput(initial?.effectiveFrom));
  const [version, setVersion] = useState(initial?.version ?? 0); // OCC token the revise started from
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [conflict, setConflict] = useState<{ updatedAt?: string; version?: number } | null>(null);

  // ADR-0070: the rate's field/office is the operator's choice, not the unit's classification. OFFICE
  // rates are flat (no geography, no rate type); FIELD rates are location-based (LOCAL/OGL).
  const isOffice = mode === 'OFFICE';
  const onModeChange = (m: string) => {
    setMode(m);
    setUnitId('');
    setPincode('');
    setLocationId('');
    setRateType('');
  };

  // Create-only option sources (skipped entirely in revise — every dimension is fixed there).
  const clients = useQuery({
    queryKey: ['client-options'],
    queryFn: () => api<Option[]>('GET', '/api/v2/clients/options'),
    enabled: !isRevise,
  });
  const products = useQuery({
    queryKey: ['product-options'],
    queryFn: () => api<Option[]>('GET', '/api/v2/products/options'),
    enabled: !isRevise,
  });
  // ADR-0074: with a specific client + product chosen, the unit options are the CPV-mapped units (a
  // Universal CPV ⇒ all units); else (no product, or Universal product) all active units.
  const unitCpvScoped = !isRevise && !!clientId && !!productId && productId !== UNIVERSAL;
  const units = useQuery({
    queryKey: unitCpvScoped ? ['cpv-available-units', clientId, productId] : ['verification-unit-options'],
    queryFn: () =>
      unitCpvScoped
        ? api<{ id: number; code: string; name: string }[]>(
            'GET',
            `/api/v2/cpv-units/available?clientId=${clientId}&productId=${productId}`,
          )
        : api<VerificationUnitOption[]>('GET', '/api/v2/verification-units/options'),
    enabled: !isRevise,
  });
  // Rate types are now assignment-gated by the (client × product × unit) combo (ADR-0067 Phase B
  // resolver). Enabled only once all three dims are chosen — KYC units have no rate type, so the
  // field is greyed out and this query stays idle for them too.
  const comboReady = !isRevise && !isOffice && !!clientId && !!productId && !!unitId;
  // A Universal (NULL) product/unit can't use the assignment-combo resolver (it needs concrete ids);
  // fall back to every usable rate type (ADR-0071).
  const dimsUniversal = productId === UNIVERSAL || unitId === UNIVERSAL;
  const clientRateTypes = useQuery({
    queryKey: dimsUniversal ? ['rate-types-options'] : ['rate-types-available', clientId, productId, unitId],
    queryFn: () =>
      dimsUniversal
        ? api<RateTypeOption[]>('GET', '/api/v2/rate-types/options')
        : api<RateTypeOption[]>(
            'GET',
            `/api/v2/rate-types/available?clientId=${clientId}&productId=${productId}&verificationUnitId=${unitId}`,
          ),
    enabled: comboReady,
  });
  const noRateTypesForCombo =
    comboReady && !dimsUniversal && clientRateTypes.isSuccess && clientRateTypes.data.length === 0;
  const pincodes = useQuery({
    queryKey: ['pincodes', pincodeSearch],
    queryFn: () => api<string[]>('GET', `/api/v2/locations/pincodes?q=${encodeURIComponent(pincodeSearch)}`),
    enabled: !isRevise && pincodeSearch.length >= 2,
  });
  const areas = useQuery({
    queryKey: ['areas', pincode],
    queryFn: () =>
      api<Paginated<Location>>('GET', `/api/v2/locations?pincode=${pincode}&limit=200`).then((r) => r.items),
    enabled: !isRevise && !!pincode,
  });

  const mut = useMutation({
    mutationFn: () =>
      isRevise
        ? api<Rate>('POST', `${BASE}/${initial.id}/revise`, {
            amount: Number(amount),
            effectiveFrom: toIsoDate(effectiveFrom),
            version, // OCC: revise the row the user is looking at (ADR-0019)
          })
        : api<Rate>('POST', BASE, {
            clientId: Number(clientId),
            productId: toDim(productId), // null = Universal (ADR-0071)
            verificationUnitId: toDim(unitId), // null = Universal
            locationId: isOffice || !locationId ? null : Number(locationId),
            clientRateType: isOffice ? null : clientRateType || null,
            amount: Number(amount),
            effectiveFrom: toIsoDate(effectiveFrom),
          }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [QK] });
      navigate('/admin/rates');
    },
    onError: (e: unknown) => {
      if (isStale(e)) {
        const current = (e.body as { current?: { updatedAt?: string; version?: number } } | null)?.current;
        setConflict(current ?? {});
      } else setError(e instanceof ApiError ? e.code : e instanceof Error ? e.message : 'Save failed');
    },
  });

  // Create gate: client/product/unit/amount required; field rates also need location + rate type.
  // Revise gate: only amount (keys are fixed).
  const valid = isRevise
    ? amount !== ''
    : !!clientId &&
      !!productId &&
      !!unitId &&
      amount !== '' &&
      (isOffice || (!!clientRateType && !!locationId));

  const clientOpts: Opt[] = (clients.data ?? []).map((c) => ({
    value: String(c.id),
    label: `${c.code} — ${c.name}`,
  }));
  const productOpts: Opt[] = [
    { value: UNIVERSAL, label: 'Universal (all products)' },
    ...(products.data ?? []).map((p) => ({ value: String(p.id), label: `${p.code} — ${p.name}` })),
  ];
  const unitOpts: Opt[] = [
    { value: UNIVERSAL, label: 'Universal (all units)' },
    ...(units.data ?? []).map((u) => ({ value: String(u.id), label: u.name })),
  ];
  const pincodeOpts: Opt[] = (pincodes.data ?? []).map((p) => ({ value: p, label: p }));
  const areaOpts: Opt[] = (areas.data ?? []).map((l) => ({ value: String(l.id), label: l.area }));
  const clientRateTypeOpts: Opt[] = (clientRateTypes.data ?? []).map((rt) => ({
    value: rt.code,
    label: rt.code,
  }));

  return (
    <div className="space-y-4">
      <Button variant="link" size="sm" onClick={() => navigate('/admin/rates')}>
        ← Back to rate management
      </Button>
      <div>
        <h1 className="text-xl font-bold tracking-tight">{isRevise ? 'Revise' : 'New'} Rate</h1>
        <p className="text-sm text-muted-foreground">
          {isRevise
            ? 'Keys are immutable — revising appends a new effective-dated version (amount & effective-from only). The current row is end-dated, never overwritten.'
            : 'One rate = client · product · verification unit · pincode/area · rate type · amount. Office rates are flat — geography & rate type are blank.'}
        </p>
      </div>

      <div className="max-w-md space-y-3 rounded-lg border border-border bg-card p-6 shadow-sm">
        {isRevise ? (
          <dl className="space-y-2 rounded-md border border-border p-3 text-sm">
            <ReadOnlyRow label="Client" value={`${initial.clientCode} — ${initial.clientName}`} />
            <ReadOnlyRow
              label="Product"
              value={initial.productCode ? `${initial.productCode} — ${initial.productName}` : 'Universal'}
            />
            <ReadOnlyRow label="Verification Unit" value={initial.unitName ?? 'Universal'} />
            <ReadOnlyRow label="Type" value={initial.clientRateType ? 'Field' : 'Office'} />
            <ReadOnlyRow
              label="Location"
              value={`${initial.pincode ?? ''} ${initial.area ?? ''}`.trim() || null}
            />
            <ReadOnlyRow label="Rate Type" value={initial.clientRateType} />
            <ReadOnlyRow label="Current Rate" value={formatMoney(initial.amount)} />
          </dl>
        ) : (
          <>
            <Field label="Client">
              <SearchableSelect value={clientId} onChange={setClientId} options={clientOpts} width="w-full" />
              {fieldErrors['clientId'] && (
                <span className="mt-1 block text-xs text-destructive">{fieldErrors['clientId']}</span>
              )}
            </Field>
            <Field label="Product">
              <SearchableSelect
                value={productId}
                onChange={setProductId}
                options={productOpts}
                width="w-full"
              />
              {fieldErrors['productId'] && (
                <span className="mt-1 block text-xs text-destructive">{fieldErrors['productId']}</span>
              )}
            </Field>
            <Field label="Field / Office">
              {/* a fixed 2-option choice → a native select (freely switchable), not a search-first dropdown */}
              <select className="input" value={mode} onChange={(e) => onModeChange(e.target.value)}>
                <option value="FIELD">Field</option>
                <option value="OFFICE">Office</option>
              </select>
            </Field>
            <Field label="Verification Unit">
              <SearchableSelect value={unitId} onChange={setUnitId} options={unitOpts} width="w-full" />
              {fieldErrors['verificationUnitId'] && (
                <span className="mt-1 block text-xs text-destructive">
                  {fieldErrors['verificationUnitId']}
                </span>
              )}
            </Field>
            {!isOffice && (
              <>
                <Field label="Pincode (search)">
                  <SearchableSelect
                    value={pincode}
                    onChange={(v) => {
                      setPincode(v);
                      setLocationId('');
                    }}
                    options={pincodeOpts}
                    onQueryChange={setPincodeSearch}
                    placeholder="Type ≥2 digits…"
                    width="w-full"
                  />
                </Field>
                <Field label="Area">
                  <SearchableSelect
                    value={locationId}
                    onChange={setLocationId}
                    options={areaOpts}
                    disabled={!pincode}
                    placeholder={pincode ? 'Select area…' : 'Pick pincode first'}
                    width="w-full"
                  />
                  {fieldErrors['locationId'] && (
                    <span className="mt-1 block text-xs text-destructive">{fieldErrors['locationId']}</span>
                  )}
                </Field>
              </>
            )}
            {!isOffice && (
              <Field label="Rate Type">
                <SearchableSelect
                  value={clientRateType}
                  onChange={setRateType}
                  options={clientRateTypeOpts}
                  disabled={!comboReady}
                  placeholder={comboReady ? 'Search…' : 'Pick client, product & unit first'}
                  width="w-full"
                />
                {noRateTypesForCombo && (
                  <span className="mt-1 block text-xs text-muted-foreground">
                    No rate types assigned for this combination — assign them in Admin → Rate Type
                    Assignments.
                  </span>
                )}
                {fieldErrors['clientRateType'] && (
                  <span className="mt-1 block text-xs text-destructive">{fieldErrors['clientRateType']}</span>
                )}
              </Field>
            )}
          </>
        )}
        <Field label="Rate (₹)">
          <input
            className="input tabular-nums"
            type="number"
            min="0"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="50.00"
          />
          {fieldErrors['amount'] && (
            <span className="mt-1 block text-xs text-destructive">{fieldErrors['amount']}</span>
          )}
        </Field>
        <Field label="Effective From (blank = now)">
          <input
            type="date"
            className="input"
            value={effectiveFrom}
            onChange={(e) => setEffectiveFrom(e.target.value)}
          />
          {fieldErrors['effectiveFrom'] && (
            <span className="mt-1 block text-xs text-destructive">{fieldErrors['effectiveFrom']}</span>
          )}
        </Field>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={() => navigate('/admin/rates')} disabled={mut.isPending}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              setError(null);
              // Validate against the canonical SDK schema (the SAME payload the mutationFn POSTs).
              const effectiveFromIso = toIsoDate(effectiveFrom);
              const errs = isRevise
                ? zodFieldErrors(ReviseRateSchema, {
                    amount: Number(amount),
                    ...(effectiveFromIso ? { effectiveFrom: effectiveFromIso } : {}),
                  })
                : zodFieldErrors(CreateRateSchema, {
                    clientId: Number(clientId),
                    productId: toDim(productId),
                    verificationUnitId: toDim(unitId),
                    locationId: isOffice || !locationId ? null : Number(locationId),
                    clientRateType: isOffice ? null : clientRateType || null,
                    amount: Number(amount),
                    ...(effectiveFromIso ? { effectiveFrom: effectiveFromIso } : {}),
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

      {conflict && (
        <ConflictDialog
          entityLabel="rate"
          current={conflict}
          onReload={() => {
            if (conflict.version !== undefined) setVersion(conflict.version);
            qc.invalidateQueries({ queryKey: [QK] });
            setConflict(null);
          }}
          onDiscard={() => {
            qc.invalidateQueries({ queryKey: [QK] });
            navigate('/admin/rates');
          }}
        />
      )}
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

/** One read-only dimension line in the revise summary. */
function ReadOnlyRow({ label, value, mono }: { label: string; value: string | null; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className={`text-right text-foreground${mono ? ' font-mono text-xs uppercase' : ''}`}>
        {value ?? <span className="text-muted-foreground">—</span>}
      </dd>
    </div>
  );
}
