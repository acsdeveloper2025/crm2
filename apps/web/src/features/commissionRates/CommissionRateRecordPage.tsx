import { useState } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CreateCommissionRateSchema,
  type Option,
  type UserOption,
  type VerificationUnitOption,
  type Location,
  type TatPolicyOption,
  type CommissionRate,
  type CommissionRateView,
  type RateTypeOption,
  type RateTypeCategory,
  type Paginated,
} from '@crm2/sdk';
import { api, ApiError } from '../../lib/sdk.js';
import { zodFieldErrors } from '../../lib/zodForm.js';
import { toIsoDate } from '../../lib/format.js';
import { useAuth } from '../../lib/AuthContext.js';
import { ConflictDialog } from '../../components/ConflictDialog.js';
import { Button } from '../../components/ui/Button.js';
import { HexagonLoader } from '../../components/ui/HexagonLoader.js';
import { exitPath } from '../clientSetup/hubState.js';

const BASE = '/api/v2/commission-rates';
const QK = 'commission-rates';
const LIST_PATH = '/admin/commission-rates';
const HTTP_CONFLICT = 409;
const isStale = (e: unknown): e is ApiError =>
  e instanceof ApiError && e.status === HTTP_CONFLICT && e.code === 'STALE_UPDATE';

// UX-4: friendly copy for this page's known 409 code — a local map on purpose (one code per page,
// a shared error-copy module is YAGNI). Unknown codes fall through to the raw code, unchanged.
export const friendlyError = (code: string): string | null =>
  code === 'COMMISSION_RATE_EXISTS'
    ? 'An active rate for this combination already overlaps this period — revise or end-date it first.'
    : null;

// UX-7: a complete 6-digit pincode whose areas query comes back empty is a dead end — the Area
// select just stays disabled with no explanation. Gate on isSuccess (not isError/isLoading) so
// there's no message flash while the query is in flight. The in-form add-location dialog from the
// audit is deliberately NOT built — Location Management is one click away (YAGNI).
export const PINCODE_NOT_FOUND = 'Pincode not found — add it in Location Management first';
export const LOCATIONS_ADMIN_PATH = '/admin/locations';
export const isPincodeNotFound = (s: { pincode: string; isSuccess: boolean; count: number }): boolean =>
  /^\d{6}$/.test(s.pincode) && s.isSuccess && s.count === 0;

// UX-10: OFFICE-category rate types are desk/flat commission — location-less by design (ADR-0068;
// server zod cross-field rule already allows locationId to be blank for OFFICE). Look the chosen
// code up against the loaded catalog (category, not a hardcoded "OFFICE" string match) so the FE
// mirrors whatever the catalog says, not a guess.
export const OFFICE_LOCATIONLESS_HELP = 'OFFICE rates are location-less';
export const isOfficeRateType = (code: string, options: RateTypeOption[]): boolean =>
  !!code && options.some((o) => o.code === code && o.category === 'OFFICE');

/** Buckets rate-type options by category for the <optgroup> FIELD/OFFICE picker — catalog order
 *  preserved within each bucket. */
export const groupRateTypeOptions = (
  options: RateTypeOption[],
): Record<RateTypeCategory, RateTypeOption[]> => {
  const out: Record<RateTypeCategory, RateTypeOption[]> = { FIELD: [], OFFICE: [] };
  for (const o of options) out[o.category].push(o);
  return out;
};

/**
 * Commission-rate create/revise as a full record-page route (ADR-0051 Wave-4 D4 — no modal).
 * `/admin/commission-rates/new` creates (the full dimension cascade); `/admin/commission-rates/:id`
 * loads that rate by id and revises it (amount + effectiveFrom only — keys are immutable, revise appends
 * a version). RBAC: `masterdata.manage` only (SUPER_ADMIN; the server enforces it on POST too); a viewer
 * who deep-links here is bounced back to the list.
 */
export function CommissionRateRecordPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { has } = useAuth();
  const isEdit = !!id;
  const exitTo = exitPath(searchParams.get('returnTo'), LIST_PATH);
  const existing = useQuery({
    queryKey: ['commission-rate', id],
    queryFn: () => api<CommissionRateView>('GET', `${BASE}/${id}`),
    enabled: isEdit,
  });

  if (!has('masterdata.manage')) return <Navigate to="/admin/commission-rates" replace />;
  if (isEdit && existing.isLoading) {
    return (
      <div className="py-10">
        <HexagonLoader operation="Loading commission rate" />
      </div>
    );
  }
  if (isEdit && (existing.isError || !existing.data)) {
    return (
      <div className="space-y-3">
        <Button variant="link" size="sm" onClick={() => navigate(exitTo)}>
          ← Back to commission rates
        </Button>
        <p className="text-sm text-muted-foreground">Couldn’t load this rate.</p>
      </div>
    );
  }
  // Re-mount the form per record (key) so its state seeds cleanly from the loaded rate.
  return (
    <CommissionRateForm
      key={id ?? 'new'}
      initial={existing.data ?? null}
      exitTo={exitTo}
      initialClientId={searchParams.get('clientId')}
    />
  );
}

/**
 * Asymmetric form. CREATE (initial null) renders the full cascade (user / Universal-able
 * client·product·unit / pincode→area / rate type / TAT band / amount / effectiveFrom) and POSTs.
 * REVISE (initial set) shows every dimension read-only and edits only amount + effectiveFrom,
 * POSTing to `…/:id/revise` with the OCC version.
 */
function CommissionRateForm({
  initial,
  exitTo,
  initialClientId,
}: {
  initial: CommissionRateView | null;
  exitTo: string;
  initialClientId: string | null;
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const isRevise = !!initial;

  const [userId, setUserId] = useState(initial?.userId ?? '');
  const [fieldRateType, setRateType] = useState(initial?.fieldRateType ?? '');
  const [clientId, setClientId] = useState(
    initial?.clientId ? String(initial.clientId) : (initialClientId ?? ''),
  );
  const [productId, setProductId] = useState(initial?.productId ? String(initial.productId) : '');
  const [unitId, setUnitId] = useState(initial?.verificationUnitId ? String(initial.verificationUnitId) : '');
  const [pincode, setPincode] = useState(initial?.pincode ?? '');
  const [locationId, setLocationId] = useState(initial?.locationId ? String(initial.locationId) : '');
  const [tatBand, setTatBand] = useState(initial?.tatBand != null ? String(initial.tatBand) : '');
  const [amount, setAmount] = useState(initial ? String(initial.amount) : '');
  // Effective-From defaults to blank (= now) for BOTH create and revise. Don't seed it from the rate on
  // revise: <input type=date> truncates the stored timestamp to midnight, which is EARLIER than the rate's
  // real effective_from, so end-dating the prior row inverts the server tstzrange (lower > upper → 500).
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [version, setVersion] = useState(initial?.version ?? 0); // OCC token the revise started from
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [conflict, setConflict] = useState<{ updatedAt?: string; version?: number } | null>(null);
  const validPincode = /^\d{6}$/.test(pincode);

  // Create-only option sources (skipped entirely in revise — every dimension is fixed there).
  const users = useQuery({
    queryKey: ['user-options'],
    queryFn: () => api<UserOption[]>('GET', '/api/v2/users/options'),
    enabled: !isRevise,
  });
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
  // Universal CPV ⇒ all units); else (no product / Universal product) all active units.
  const unitCpvScoped = !isRevise && !!clientId && !!productId;
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
  // Cascading location: type a pincode (server-search suggestions) → pick the area = a locations row.
  const pincodes = useQuery({
    queryKey: ['location-pincodes', pincode],
    queryFn: () => api<string[]>('GET', `/api/v2/locations/pincodes?q=${encodeURIComponent(pincode)}`),
    enabled: !isRevise && pincode.length >= 2,
  });
  const areas = useQuery({
    queryKey: ['location-areas', pincode],
    queryFn: () =>
      api<Paginated<Location>>('GET', `/api/v2/locations?pincode=${pincode}&limit=200`).then((r) => r.items),
    enabled: !isRevise && validPincode,
  });
  const pincodeNotFound = isPincodeNotFound({
    pincode,
    isSuccess: areas.isSuccess,
    count: areas.data?.length ?? 0,
  });
  // UX-10: `/tat-policies/options` (page.masterdata-gated) returns ALL active-and-in-effect bands
  // unpaginated — no `limit` to cap, unlike the DataGrid-oriented `/tat-policies` list (server max
  // 500 via MAX_PAGE_SIZE). Same source the rate-type/client/product option pickers on this page use.
  const tatPolicies = useQuery({
    queryKey: ['tat-policies', 'options'],
    queryFn: () => api<TatPolicyOption[]>('GET', '/api/v2/tat-policies/options'),
    enabled: !isRevise,
  });
  // Rate-type options now come from the managed catalog (ADR-0064/0068), not the hardcoded
  // COMMISSION_RATE_TYPES enum. Commission dims are Universal-able, so this is NOT combo-gated —
  // all active catalog rows are offered. The form still SENDS fieldRateType as the chosen code string.
  const rateTypes = useQuery({
    queryKey: ['rate-types', 'options'],
    queryFn: () => api<RateTypeOption[]>('GET', '/api/v2/rate-types/options?active=true'),
    enabled: !isRevise,
  });

  const mut = useMutation({
    mutationFn: () =>
      isRevise
        ? api<CommissionRate>('POST', `${BASE}/${initial!.id}/revise`, {
            amount: Number(amount),
            effectiveFrom: toIsoDate(effectiveFrom),
            version,
          })
        : api<CommissionRate>('POST', BASE, {
            userId,
            locationId: locationId ? Number(locationId) : null, // required for LOCAL/OGL; null for OFFICE
            fieldRateType, // LOCAL/OGL (field) or OFFICE (desk)
            // Universal-able: blank ⇒ null ⇒ matches any (ADR-0050).
            clientId: clientId ? Number(clientId) : null,
            productId: productId ? Number(productId) : null,
            verificationUnitId: unitId ? Number(unitId) : null,
            tatBand: tatBand === '' ? null : Number(tatBand),
            amount: Number(amount),
            effectiveFrom: toIsoDate(effectiveFrom),
          }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [QK] });
      navigate(exitTo);
    },
    onError: (e: unknown) => {
      if (isStale(e)) {
        const current = (e.body as { current?: { updatedAt?: string; version?: number } } | null)?.current;
        setConflict(current ?? {});
      } else
        setError(
          e instanceof ApiError
            ? (friendlyError(e.code) ?? e.code)
            : e instanceof Error
              ? e.message
              : 'Save failed',
        );
    },
  });

  // UX-10: OFFICE-category rate types are location-less (desk/flat commission) — mirrors the
  // server's zod cross-field rule (OFFICE ⇒ locationId optional) via the loaded catalog's category,
  // not a hardcoded code string.
  const isOffice = isOfficeRateType(fieldRateType, rateTypes.data ?? []);
  const rateTypeGroups = groupRateTypeOptions(rateTypes.data ?? []);

  // ADR-0050: required-specific dims = user + location (area) + rate type; client/product/unit/tat band
  // are Universal-able (blank ⇒ matches any), so they don't gate Save. Location is required for LOCAL/OGL;
  // OFFICE rates are location-less (flat office commission).
  const valid = isRevise
    ? amount !== ''
    : !!userId && !!fieldRateType && (isOffice || !!locationId) && amount !== '';

  return (
    <div className="space-y-4">
      <Button variant="link" size="sm" onClick={() => navigate(exitTo)}>
        ← Back to commission rates
      </Button>
      <div>
        <h1 className="text-xl font-bold tracking-tight">{isRevise ? 'Revise' : 'New'} Commission Rate</h1>
        <p className="text-sm text-muted-foreground">
          {isRevise
            ? 'Keys are immutable — revising appends a new effective-dated version (amount & effective-from only).'
            : 'Per-executive commission tariff. Required: user, location (pincode/area) & rate type (LOCAL/OGL; OFFICE is location-less). Client, product, unit & TAT band can be Universal (matches any).'}
        </p>
      </div>

      <div className="max-w-md space-y-3 rounded-lg border border-border bg-card p-6 shadow-sm">
        {isRevise ? (
          <dl className="space-y-2 rounded-md border border-border p-3 text-sm">
            <ReadOnlyRow label="User" value={initial.userName} />
            <ReadOnlyRow label="Rate Type" value={initial.fieldRateType} mono />
            <ReadOnlyRow label="Client" value={initial.clientName} universal />
            <ReadOnlyRow
              label="Product"
              value={`${initial.productCode ?? ''} ${initial.productName ?? ''}`.trim() || null}
              universal
            />
            <ReadOnlyRow label="Verification Unit" value={initial.verificationUnitName} universal />
            <ReadOnlyRow
              label="Location"
              value={`${initial.pincode ?? ''} ${initial.area ?? ''}`.trim() || null}
              universal
            />
            <ReadOnlyRow
              label="TAT Band"
              value={
                initial.tatBand == null
                  ? null
                  : initial.tatBand === -1
                    ? 'Out of band'
                    : `${initial.tatBand}h`
              }
              universal
            />
          </dl>
        ) : (
          <>
            <Field label="User">
              <select className="input" value={userId} onChange={(e) => setUserId(e.target.value)}>
                <option value="">Select a user…</option>
                {(users.data ?? []).map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} ({u.role.replace(/_/g, ' ')})
                  </option>
                ))}
              </select>
              {fieldErrors['userId'] && (
                <span className="mt-1 block text-xs text-destructive">{fieldErrors['userId']}</span>
              )}
            </Field>
            <Field label="Client (blank = Universal)">
              <select className="input" value={clientId} onChange={(e) => setClientId(e.target.value)}>
                <option value="">Universal (all clients)</option>
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
              {fieldErrors['verificationUnitId'] && (
                <span className="mt-1 block text-xs text-destructive">
                  {fieldErrors['verificationUnitId']}
                </span>
              )}
            </Field>
            <Field label="Pincode">
              <input
                className="input"
                list="commission-pincodes"
                value={pincode}
                placeholder={isOffice ? OFFICE_LOCATIONLESS_HELP : 'Type ≥2 digits…'}
                disabled={isOffice}
                onChange={(e) => {
                  setPincode(e.target.value);
                  setLocationId('');
                }}
              />
              <datalist id="commission-pincodes">
                {(pincodes.data ?? []).map((p) => (
                  <option key={p} value={p} />
                ))}
              </datalist>
              {isOffice && (
                <span className="mt-1 block text-xs text-muted-foreground">{OFFICE_LOCATIONLESS_HELP}</span>
              )}
            </Field>
            <Field label="Area">
              <select
                className="input"
                value={locationId}
                disabled={isOffice || !validPincode}
                onChange={(e) => setLocationId(e.target.value)}
              >
                <option value="">
                  {isOffice
                    ? OFFICE_LOCATIONLESS_HELP
                    : validPincode
                      ? 'Select an area…'
                      : 'Enter a 6-digit pincode first'}
                </option>
                {(areas.data ?? []).map((l) => (
                  <option key={l.id} value={String(l.id)}>
                    {l.area}
                  </option>
                ))}
              </select>
              {!isOffice && pincodeNotFound && (
                <span className="mt-1 block text-xs text-muted-foreground">
                  {PINCODE_NOT_FOUND} —{' '}
                  <Link to={LOCATIONS_ADMIN_PATH} className="text-primary hover:underline">
                    open Location Management
                  </Link>
                  .
                </span>
              )}
              {fieldErrors['locationId'] && (
                <span className="mt-1 block text-xs text-destructive">{fieldErrors['locationId']}</span>
              )}
            </Field>
            <Field label="Rate Type">
              <select
                className="input"
                value={fieldRateType}
                disabled={rateTypes.isLoading}
                onChange={(e) => {
                  const code = e.target.value;
                  setRateType(code);
                  // UX-10: switching TO an OFFICE type clears the now-disabled location inputs; the
                  // Clear-fields-on-toggle pattern already established for the Field/Office toggle
                  // (UX-9) — switching back to FIELD leaves both blank for the user to re-enter (no
                  // stale pincode silently resurrected).
                  if (isOfficeRateType(code, rateTypes.data ?? [])) {
                    setPincode('');
                    setLocationId('');
                  }
                }}
              >
                <option value="">
                  {rateTypes.isLoading ? 'Loading rate types…' : 'Select a rate type…'}
                </option>
                <optgroup label="Field">
                  {rateTypeGroups.FIELD.map((rt) => (
                    <option key={rt.id} value={rt.code}>
                      {rt.code}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Office">
                  {rateTypeGroups.OFFICE.map((rt) => (
                    <option key={rt.id} value={rt.code}>
                      {rt.code}
                    </option>
                  ))}
                </optgroup>
              </select>
              {rateTypes.isError && (
                <span className="mt-1 block text-xs text-destructive">Couldn’t load rate types.</span>
              )}
              {fieldErrors['fieldRateType'] && (
                <span className="mt-1 block text-xs text-destructive">{fieldErrors['fieldRateType']}</span>
              )}
            </Field>
            <Field label="TAT Band (blank = Universal)">
              <select className="input" value={tatBand} onChange={(e) => setTatBand(e.target.value)}>
                <option value="">Universal (all bands)</option>
                {(tatPolicies.data ?? []).map((tp) => (
                  <option key={tp.id} value={String(tp.tatHours)}>
                    {tp.label}
                  </option>
                ))}
                <option value="-1">Out of band</option>
              </select>
              {fieldErrors['tatBand'] && (
                <span className="mt-1 block text-xs text-destructive">{fieldErrors['tatBand']}</span>
              )}
            </Field>
          </>
        )}
        <Field label="Amount (₹)">
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
          <Button variant="ghost" onClick={() => navigate(exitTo)} disabled={mut.isPending}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              setError(null);
              // CREATE only: validate the full cascade against the canonical create schema (the SAME
              // payload the mutationFn POSTs). Revise posts only { amount, effectiveFrom } and has no
              // matching create schema, so server-side validation stands (amount keeps its disabled gate).
              if (!isRevise) {
                const errs = zodFieldErrors(CreateCommissionRateSchema, {
                  userId,
                  locationId: locationId ? Number(locationId) : null,
                  fieldRateType,
                  clientId: clientId ? Number(clientId) : null,
                  productId: productId ? Number(productId) : null,
                  verificationUnitId: unitId ? Number(unitId) : null,
                  tatBand: tatBand === '' ? null : Number(tatBand),
                  amount: Number(amount),
                  effectiveFrom: toIsoDate(effectiveFrom),
                });
                if (Object.keys(errs).length > 0) {
                  setFieldErrors(errs);
                  return;
                }
                setFieldErrors({});
              }
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
          entityLabel="commission rate"
          current={conflict}
          onReload={() => {
            if (conflict.version !== undefined) setVersion(conflict.version);
            qc.invalidateQueries({ queryKey: [QK] });
            setConflict(null);
          }}
          onDiscard={() => {
            qc.invalidateQueries({ queryKey: [QK] });
            navigate(exitTo);
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

/** One read-only dimension line in the revise summary. `universal` renders blanks as "Universal". */
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
