import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { UserKycUnits } from '@crm2/sdk';
import { api } from '../lib/sdk.js';
import { Button } from './ui/Button.js';

/**
 * KYC-unit assignment eligibility (ADR-0073). Grant a KYC verifier the units they can be assigned OFFICE
 * tasks for. Eligibility ONLY — this does NOT change what the user can see (visibility stays SELF). Rendered
 * on the user record page's Access tab (already `user.manage`-gated) for KYC_VERIFIER users.
 */
export function UserKycUnitsSection({ userId }: { userId: string }) {
  const qc = useQueryClient();
  const [staged, setStaged] = useState<Set<number> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ['kyc-units', userId],
    queryFn: () => api<UserKycUnits>('GET', `/api/v2/users/${userId}/kyc-units`),
  });

  const granted = staged ?? new Set(q.data?.grantedUnitIds ?? []);
  const mut = useMutation({
    mutationFn: () =>
      api<UserKycUnits>('PUT', `/api/v2/users/${userId}/kyc-units`, { unitIds: [...granted] }),
    onSuccess: (data) => {
      qc.setQueryData(['kyc-units', userId], data);
      setStaged(null);
    },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : 'Save failed'),
  });

  const toggle = (id: number) => {
    const next = new Set(granted);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setStaged(next);
  };

  if (q.isLoading) return <p className="mt-4 text-xs text-muted-foreground">Loading units…</p>;
  const units = q.data?.availableUnits ?? [];
  return (
    <div className="mt-4 space-y-3 rounded-md border border-border p-4">
      <div>
        <p className="text-sm font-medium text-foreground">Unit access (assignment eligibility)</p>
        <p className="text-xs text-muted-foreground">
          Which verification units this verifier can be assigned OFFICE tasks for — assignment only, not
          visibility (they still see only tasks assigned to them).
        </p>
      </div>
      {units.length === 0 ? (
        <p className="text-xs text-muted-foreground">No active verification units.</p>
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {units.map((u) => (
            <label key={u.id} className="flex items-center gap-2 text-sm text-foreground">
              <input type="checkbox" checked={granted.has(u.id)} onChange={() => toggle(u.id)} />
              <span>{u.name}</span>
            </label>
          ))}
        </div>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
      {staged !== null && (
        <div className="flex justify-end">
          <Button
            size="sm"
            onClick={() => {
              setError(null);
              mut.mutate();
            }}
            loading={mut.isPending}
          >
            Save unit access
          </Button>
        </div>
      )}
    </div>
  );
}
