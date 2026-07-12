import { useState } from 'react';
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ReviseRateSchema, type Rate, type RateView } from '@crm2/sdk';
import { api, ApiError } from '../../lib/sdk.js';
import { zodFieldErrors } from '../../lib/zodForm.js';
import { toDateInput, toIsoDate, formatMoney } from '../../lib/format.js';
import { useAuth } from '../../lib/AuthContext.js';
import { ConflictDialog } from '../../components/ConflictDialog.js';
import { Button } from '../../components/ui/Button.js';
import { HexagonLoader } from '../../components/ui/HexagonLoader.js';
import { exitPath } from '../clientSetup/index.js';

const BASE = '/api/v2/rates';
const QK = 'rates';
const LIST_PATH = '/admin/rates';
const HTTP_CONFLICT = 409;
const isStale = (e: unknown): e is ApiError =>
  e instanceof ApiError && e.status === HTTP_CONFLICT && e.code === 'STALE_UPDATE';

// UX-4: friendly copy for this page's known 409 code — a local map on purpose (one code per page,
// a shared error-copy module is YAGNI). Unknown codes fall through to the raw code, unchanged.
export const friendlyError = (code: string): string | null =>
  code === 'RATE_EXISTS'
    ? 'An active rate for this combination already overlaps this period — revise or end-date it first.'
    : null;

/**
 * Rate REVISE as a full record-page route (ADR-0051 — no modal). `/admin/rates/:id` loads that rate
 * by id and revises it (amount + effective-from only — keys are immutable, revise appends an
 * effective-dated version; the current row is end-dated, never overwritten). Creation lives on the
 * merged single+multi `RateCreatePage` (`/admin/rates/new`). RBAC: `masterdata.manage` only; a
 * viewer who deep-links here is bounced back to the list.
 */
export function RateRecordPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { has } = useAuth();
  const exitTo = exitPath(searchParams.get('returnTo'), LIST_PATH);
  const existing = useQuery({
    queryKey: ['rate', id],
    queryFn: () => api<RateView>('GET', `${BASE}/${id}`),
    enabled: !!id,
  });

  if (!has('masterdata.manage')) return <Navigate to={LIST_PATH} replace />;
  if (existing.isLoading) {
    return (
      <div className="py-10">
        <HexagonLoader operation="Loading rate" />
      </div>
    );
  }
  if (existing.isError || !existing.data) {
    return (
      <div className="space-y-3">
        <Button variant="link" size="sm" onClick={() => navigate(exitTo)}>
          ← Back to rate management
        </Button>
        <p className="text-sm text-muted-foreground">Couldn’t load this rate.</p>
      </div>
    );
  }
  // Re-mount the form per record (key) so its state seeds cleanly from the loaded rate.
  return <ReviseForm key={id} initial={existing.data} exitTo={exitTo} />;
}

/** Every dimension read-only; edits only amount + effective-from, POSTing to `…/:id/revise` with the
 *  OCC version (ADR-0019). */
function ReviseForm({ initial, exitTo }: { initial: RateView; exitTo: string }) {
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [amount, setAmount] = useState(String(initial.amount));
  const [effectiveFrom, setEffectiveFrom] = useState(toDateInput(initial.effectiveFrom));
  const [version, setVersion] = useState(initial.version); // OCC token the revise started from
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [conflict, setConflict] = useState<{ updatedAt?: string; version?: number } | null>(null);

  const mut = useMutation({
    mutationFn: () =>
      api<Rate>('POST', `${BASE}/${initial.id}/revise`, {
        amount: Number(amount),
        effectiveFrom: toIsoDate(effectiveFrom),
        version, // OCC: revise the row the user is looking at (ADR-0019)
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
        ← Back to rate management
      </Button>
      <div>
        <h1 className="text-xl font-bold tracking-tight">Revise Rate</h1>
        <p className="text-sm text-muted-foreground">
          Keys are immutable — revising appends a new effective-dated version (amount &amp; effective-from
          only). The current row is end-dated, never overwritten.
        </p>
      </div>

      <div className="max-w-md space-y-3 rounded-lg border border-border bg-card p-6 shadow-sm">
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
        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={() => navigate(exitTo)} disabled={mut.isPending}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              setError(null);
              // Validate against the canonical SDK schema (the SAME payload the mutationFn POSTs).
              const effectiveFromIso = toIsoDate(effectiveFrom);
              const errs = zodFieldErrors(ReviseRateSchema, {
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
            disabled={amount === ''}
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

/** One read-only dimension line in the revise summary. */
function ReadOnlyRow({ label, value, mono }: { label: string; value: string | null; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className={`text-right text-foreground${mono ? ' font-mono text-xs' : ''}`}>
        {value ?? <span className="text-muted-foreground">—</span>}
      </dd>
    </div>
  );
}
