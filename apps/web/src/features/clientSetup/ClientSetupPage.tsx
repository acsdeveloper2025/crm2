import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  MAX_PAGE_SIZE,
  pageQueryToParams,
  type Option,
  type Paginated,
  type ClientProductView,
} from '@crm2/sdk';
import { toast } from 'sonner';
import { api, apiBlob } from '../../lib/sdk.js';
import { useAuth } from '../../lib/AuthContext.js';
import { Button } from '../../components/ui/Button.js';
import { DownloadIcon } from '../../components/ui/icons.js';
import { SearchableSelect, type Opt } from '../../components/ui/SearchableSelect.js';
import { STEP_DEFS, parseStep, hubReturnTo } from './hubState.js';
import {
  deriveStepStates,
  sumUnitCounts,
  stepChipLabel,
  STEP_STATE_META,
  type SetupCounts,
} from './checklist.js';
import { CpvPage } from '../cpv/index.js';
import { RateTypeAssignmentsPage } from '../rateTypeAssignments/index.js';
import { RateManagementPage } from '../rateManagement/index.js';
import { CommissionRatesPage } from '../commissionRates/index.js';

/** Every 'blocked' StepState today gates on a step-1 count (cpvLinks/cpvUnits — see
 *  `deriveStepStates`), so the prior step to send the user back to is always step 1. */
const BLOCKED_BY_STEP = 1;

/** Trigger the browser download of a blob (same pattern as ImportModal/DataGrid export — no shared
 *  helper exists to reuse; ponytail: one more small duplicate beats a new util for an 8-line fn). */
function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** `?clientId=&page=1&limit=` — one call per checklist count (spec §3.3). */
function checklistParams(clientId: string, limit: number): string {
  return pageQueryToParams({ page: 1, limit, filters: { clientId } }).toString();
}

/**
 * Client Setup hub (ADR-0092) — one client, one stepper over the four onboarding screens (Products &
 * CPV units → Rate types → Rates → Commission rates). The URL (`?clientId=&step=`) is the only state
 * store, so the hub is deep-linkable. Each step mounts the real page for that module with the hub's
 * client as its controlled `clientId` prop (S2) — Step 4 (Commission rates) is SUPER_ADMIN-only
 * (`masterdata.manage`); a non-SA admin gets a neutral locked card instead, and `CommissionRatesPage`
 * is never mounted, so no request fires.
 */
export function ClientSetupPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { has } = useAuth();
  const clientId = searchParams.get('clientId') ?? '';
  const step = parseStep(searchParams.get('step'));

  const clients = useQuery({
    queryKey: ['client-options'],
    queryFn: () => api<Option[]>('GET', '/api/v2/clients/options'),
  });
  const clientOpts: Opt[] = (clients.data ?? []).map((c) => ({
    value: String(c.id),
    label: `${c.code} — ${c.name}`,
  }));
  const knownClient = clients.data?.some((c) => String(c.id) === clientId) ?? false;
  const unknownClient = clientId !== '' && clients.data !== undefined && !knownClient;
  const canManage = has('masterdata.manage');

  useEffect(() => {
    if (unknownClient) toast.error('Unknown client — pick a client to begin.');
  }, [unknownClient]);

  // Checklist counts (ADR-0092 S3). Query-key roots are SHARED with the embedded grids
  // (['client-products'|'rate-type-assignments'|'rates'|'commission-rates', ...]) so a mutation made
  // inside a step invalidates its own root and the checklist refetches for free — every embedded
  // page's mutations invalidate the bare root key (e.g. `['client-products']`), which is a *prefix*
  // match under TanStack's default (non-exact) invalidation, so it also matches this longer key.
  const cpvQuery = useQuery({
    queryKey: ['client-products', 'setup-checklist', clientId],
    queryFn: () =>
      api<Paginated<ClientProductView>>(
        'GET',
        `/api/v2/client-products?${checklistParams(clientId, MAX_PAGE_SIZE)}`,
      ),
    enabled: knownClient,
  });
  const rtaQuery = useQuery({
    queryKey: ['rate-type-assignments', 'setup-checklist', clientId],
    queryFn: () =>
      api<Paginated<unknown>>('GET', `/api/v2/rate-type-assignments?${checklistParams(clientId, 1)}`),
    enabled: knownClient,
  });
  const ratesQuery = useQuery({
    queryKey: ['rates', 'setup-checklist', clientId],
    queryFn: () => api<Paginated<unknown>>('GET', `/api/v2/rates?${checklistParams(clientId, 1)}`),
    enabled: knownClient,
  });
  // 403-storm rule: a non-SA viewer never fires this request — count stays null → chip renders "—".
  const commissionQuery = useQuery({
    queryKey: ['commission-rates', 'setup-checklist', clientId],
    queryFn: () => api<Paginated<unknown>>('GET', `/api/v2/commission-rates?${checklistParams(clientId, 1)}`),
    enabled: knownClient && canManage,
  });

  const counts: SetupCounts = {
    cpvLinks: cpvQuery.data?.totalCount ?? null,
    cpvUnits: cpvQuery.data ? sumUnitCounts(cpvQuery.data.items) : null,
    rateTypeAssignments: rtaQuery.data?.totalCount ?? null,
    rates: ratesQuery.data?.totalCount ?? null,
    commissionRates: canManage ? (commissionQuery.data?.totalCount ?? null) : null,
  };
  const stepStates = deriveStepStates(counts, canManage);

  const setClientId = (next: string) => {
    const params = new URLSearchParams(searchParams);
    if (next) params.set('clientId', next);
    else params.delete('clientId');
    setSearchParams(params, { replace: true });
  };

  const setStep = (next: number) => {
    const params = new URLSearchParams(searchParams);
    params.set('step', String(next));
    setSearchParams(params, { replace: true });
  };

  /** ADR-0092 S4: the 5-sheet onboarding workbook (Products/CPV/RateTypeAssignments/Rates/
   *  CommissionRates) for the selected client, its `Client Code` samples pre-filled. */
  const downloadOnboardingWorkbook = async () => {
    try {
      const { blob, filename } = await apiBlob(`/api/v2/clients/${clientId}/onboarding-template`);
      downloadBlob(blob, filename);
    } catch {
      toast.error('Could not download the workbook.');
    }
  };

  const stepperEnabled = knownClient;
  const activeStepDef = STEP_DEFS.find((s) => s.id === step) ?? STEP_DEFS[0]!;
  const activeState = stepStates[activeStepDef.id as 1 | 2 | 3 | 4];
  const priorStepDef = STEP_DEFS.find((s) => s.id === BLOCKED_BY_STEP)!;

  return (
    <div className="space-y-4">
      <div className="min-w-0">
        <h1 className="text-xl font-bold tracking-tight">Client Setup</h1>
        <p className="text-sm text-muted-foreground">
          Pick a client, then step through Products &amp; CPV units, Rate types, Rates and Commission rates
          for that client.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <SearchableSelect
          value={clientId}
          onChange={setClientId}
          options={clientOpts}
          placeholder="Select a client…"
          width="min-w-[16rem]"
        />
        <Button
          onClick={() =>
            navigate(`/admin/clients?returnTo=${encodeURIComponent(hubReturnTo(clientId, step))}`)
          }
        >
          + New client
        </Button>
        {canManage && (
          <Button variant="secondary" disabled={!knownClient} onClick={downloadOnboardingWorkbook}>
            <DownloadIcon />
            Download workbook
          </Button>
        )}
      </div>

      <div className="space-y-4">
        <div className="flex flex-wrap gap-2 lg:flex-nowrap lg:overflow-x-auto">
          {STEP_DEFS.map((s) => {
            const state = stepStates[s.id as 1 | 2 | 3 | 4];
            const meta = STEP_STATE_META[state];
            return (
              <button
                key={s.id}
                type="button"
                disabled={!stepperEnabled}
                onClick={() => setStep(s.id)}
                aria-current={stepperEnabled && s.id === step ? 'step' : undefined}
                className={`whitespace-nowrap rounded-md px-3 py-1.5 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                  stepperEnabled && s.id === step
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-surface-muted text-secondary-foreground hover:enabled:bg-accent hover:enabled:text-accent-foreground'
                }`}
              >
                <span className="inline-flex items-center gap-1.5">
                  {stepperEnabled && (
                    <span className={meta.className} aria-hidden="true">
                      {meta.glyph}
                    </span>
                  )}
                  <span>
                    {s.id}. {s.label}
                  </span>
                  {stepperEnabled && (
                    <span className="text-xs opacity-80">
                      ({stepChipLabel(s.id as 1 | 2 | 3 | 4, counts)})
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>

        {!stepperEnabled ? (
          <div className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
            Pick or create a client to begin.
          </div>
        ) : activeStepDef.key === 'commission' && !canManage ? (
          <div className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
            Commission rates are managed by a super admin.
          </div>
        ) : activeState === 'blocked' ? (
          <div className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
            <p>Complete {priorStepDef.label} first.</p>
            <Button className="mt-3" onClick={() => setStep(priorStepDef.id)}>
              Go to {priorStepDef.label}
            </Button>
          </div>
        ) : (
          // min-w-0: the embedded page owns its own card (DataGrid renders its own rounded/bordered
          // wrapper) — a wide grid scrolls inside that card, not the hub page.
          <div className="min-w-0">
            {activeStepDef.key === 'cpv' && <CpvPage clientId={clientId} />}
            {activeStepDef.key === 'rateTypes' && <RateTypeAssignmentsPage clientId={clientId} />}
            {activeStepDef.key === 'rates' && <RateManagementPage clientId={clientId} />}
            {activeStepDef.key === 'commission' && <CommissionRatesPage clientId={clientId} />}
          </div>
        )}
      </div>
    </div>
  );
}
