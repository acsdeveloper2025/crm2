import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { Option } from '@crm2/sdk';
import { toast } from 'sonner';
import { api } from '../../lib/sdk.js';
import { Button } from '../../components/ui/Button.js';
import { SearchableSelect, type Opt } from '../../components/ui/SearchableSelect.js';
import { STEP_DEFS, parseStep, hubReturnTo } from './hubState.js';

/**
 * Client Setup hub (ADR-0092) — one client, one stepper over the four onboarding screens (Products &
 * CPV units → Rate types → Rates → Commission rates). The URL (`?clientId=&step=`) is the only state
 * store, so the hub is deep-linkable. S1 ships the shell only: client picker + stepper rail + a
 * placeholder card per step — S2 replaces each placeholder with the real embedded page.
 */
export function ClientSetupPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
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

  useEffect(() => {
    if (unknownClient) toast.error('Unknown client — pick a client to begin.');
  }, [unknownClient]);

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

  const stepperEnabled = knownClient;
  const activeStepDef = STEP_DEFS.find((s) => s.id === step) ?? STEP_DEFS[0]!;

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
      </div>

      <div className="space-y-4">
        <div className="flex flex-wrap gap-2 lg:flex-nowrap lg:overflow-x-auto">
          {STEP_DEFS.map((s) => (
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
              {s.id}. {s.label}
            </button>
          ))}
        </div>

        {!stepperEnabled ? (
          <div className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
            Pick or create a client to begin.
          </div>
        ) : (
          <div className="min-w-0 rounded-lg border border-border bg-card p-6">
            <h2 className="mb-1 text-lg font-semibold">{activeStepDef.label}</h2>
            <p className="text-sm text-muted-foreground">Coming soon.</p>
          </div>
        )}
      </div>
    </div>
  );
}
