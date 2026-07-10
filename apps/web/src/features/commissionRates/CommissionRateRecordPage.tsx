import { useState } from 'react';
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CommissionRate, CommissionRateView, RateTypeOption, RateTypeCategory } from '@crm2/sdk';
import { api, ApiError } from '../../lib/sdk.js';
import { toIsoDate } from '../../lib/format.js';
import { useAuth } from '../../lib/AuthContext.js';
import { ConflictDialog } from '../../components/ConflictDialog.js';
import { Button } from '../../components/ui/Button.js';
import { HexagonLoader } from '../../components/ui/HexagonLoader.js';
import { exitPath } from '../clientSetup/index.js';

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
 * Commission-rate REVISE as a full record-page route (ADR-0051 Wave-4 D4 — no modal).
 * `/admin/commission-rates/:id` loads that rate and revises it — amount + effectiveFrom only; the keys
 * are immutable (a revision appends a new effective-dated version, the prior row is end-dated).
 * CREATE lives on `/admin/commission-rates/new` (CommissionRateCreatePage — the multi-location entry,
 * owner 2026-07-10). RBAC: `masterdata.manage` only; a viewer who deep-links here is bounced back.
 */
export function CommissionRateRecordPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { has } = useAuth();
  const exitTo = exitPath(searchParams.get('returnTo'), LIST_PATH);
  const existing = useQuery({
    queryKey: ['commission-rate', id],
    queryFn: () => api<CommissionRateView>('GET', `${BASE}/${id}`),
  });

  if (!has('masterdata.manage')) return <Navigate to={LIST_PATH} replace />;
  if (existing.isLoading) {
    return (
      <div className="py-10">
        <HexagonLoader operation="Loading commission rate" />
      </div>
    );
  }
  if (existing.isError || !existing.data) {
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
  return <CommissionRateReviseForm key={id} initial={existing.data} exitTo={exitTo} />;
}

/** Revise: every dimension read-only; edits only amount + effectiveFrom, POSTing to `…/:id/revise`
 *  with the OCC version. */
function CommissionRateReviseForm({ initial, exitTo }: { initial: CommissionRateView; exitTo: string }) {
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [amount, setAmount] = useState(String(initial.amount));
  // Effective-From defaults to blank (= now). Don't seed it from the rate: <input type=date> truncates
  // the stored timestamp to midnight, which is EARLIER than the rate's real effective_from, so
  // end-dating the prior row inverts the server tstzrange (lower > upper → 500).
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [version, setVersion] = useState(initial.version); // OCC token the revise started from
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ updatedAt?: string; version?: number } | null>(null);

  const mut = useMutation({
    mutationFn: () =>
      api<CommissionRate>('POST', `${BASE}/${initial.id}/revise`, {
        amount: Number(amount),
        effectiveFrom: toIsoDate(effectiveFrom),
        version,
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

  return (
    <div className="space-y-4">
      <Button variant="link" size="sm" onClick={() => navigate(exitTo)}>
        ← Back to commission rates
      </Button>
      <div>
        <h1 className="text-xl font-bold tracking-tight">Revise Commission Rate</h1>
        <p className="text-sm text-muted-foreground">
          Keys are immutable — revising appends a new effective-dated version (amount &amp; effective-from
          only).
        </p>
      </div>

      <div className="max-w-md space-y-3 rounded-lg border border-border bg-card p-6 shadow-sm">
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
              initial.tatBand == null ? null : initial.tatBand === -1 ? 'Out of band' : `${initial.tatBand}h`
            }
            universal
          />
        </dl>
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
        </Field>
        <Field label="Effective From (blank = now)">
          <input
            type="date"
            className="input"
            value={effectiveFrom}
            onChange={(e) => setEffectiveFrom(e.target.value)}
          />
        </Field>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={() => navigate(exitTo)} disabled={mut.isPending}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              setError(null);
              mut.mutate();
            }}
            disabled={amount === ''}
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
