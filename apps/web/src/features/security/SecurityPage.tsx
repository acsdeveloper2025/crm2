import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MfaEnrollStart, MfaRecoveryCodes, MfaStatus } from '@crm2/sdk';
import { api } from '../../lib/sdk.js';
import { tokenStore } from '../../lib/auth.js';
import { SessionList } from '../../components/SessionList.js';
import { Button } from '../../components/ui/Button.js';
import { HexagonLoader } from '../../components/ui/HexagonLoader.js';
import { Input } from '../../components/ui/Input.js';

const QK = ['mfa', 'status'];

export function SecurityPage() {
  const qc = useQueryClient();
  const status = useQuery({ queryKey: QK, queryFn: () => api<MfaStatus>('GET', '/api/v2/auth/mfa/status') });
  const [pending, setPending] = useState<MfaEnrollStart | null>(null);
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState<string[] | null>(null);
  const [disableCode, setDisableCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  const start = useMutation({
    mutationFn: () => api<MfaEnrollStart>('POST', '/api/v2/auth/mfa/enroll/start'),
    onSuccess: (res) => {
      setPending(res);
      setRecovery(null);
      setError(null);
    },
  });
  const verify = useMutation({
    mutationFn: () => api<MfaRecoveryCodes>('POST', '/api/v2/auth/mfa/enroll/verify', { code: code.trim() }),
    onSuccess: (res) => {
      setRecovery(res.recoveryCodes);
      setPending(null);
      setCode('');
      void qc.invalidateQueries({ queryKey: QK });
    },
    onError: () => setError('That code did not verify. Check your authenticator and try again.'),
  });
  const disable = useMutation({
    mutationFn: () => api<{ ok: true }>('POST', '/api/v2/auth/mfa/disable', { code: disableCode.trim() }),
    onSuccess: () => {
      setDisableCode('');
      setRecovery(null);
      void qc.invalidateQueries({ queryKey: QK });
    },
    onError: () => setError('That code did not verify. Enter a current code to disable MFA.'),
  });

  const enrolled = status.data?.enrolled ?? false;

  return (
    <div className="max-w-xl space-y-4">
      <div>
        <h1 className="text-xl font-bold tracking-tight">Security</h1>
        <p className="text-sm text-muted-foreground">
          Two-factor authentication and active sessions for your account.
        </p>
      </div>

      <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <span className="font-medium">Two-factor authentication</span>
          {!status.isLoading && !status.isError && (
            <span
              className={
                enrolled ? 'text-sm font-medium text-primary' : 'text-sm font-medium text-muted-foreground'
              }
            >
              {enrolled ? 'ON' : 'OFF'}
            </span>
          )}
        </div>
        {status.isLoading ? (
          <HexagonLoader operation="Loading two-factor status" />
        ) : status.isError ? (
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">Couldn’t load your two-factor status.</span>
            <Button variant="secondary" size="sm" onClick={() => void status.refetch()}>
              Retry
            </Button>
          </div>
        ) : (
          <>
            {status.data?.required && !enrolled && (
              <p className="mb-3 text-sm text-destructive">An administrator requires MFA on your account.</p>
            )}

            {!enrolled && !pending && (
              <Button onClick={() => start.mutate()} loading={start.isPending}>
                Enable MFA
              </Button>
            )}

            {pending && (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Add this secret to your authenticator app (Google Authenticator, Authy, …), then enter the
                  6-digit code to confirm.
                </p>
                <code className="block select-all rounded border border-border bg-muted px-3 py-2 font-mono text-sm">
                  {pending.secret}
                </code>
                <a className="block break-all text-xs text-primary hover:underline" href={pending.otpauthUri}>
                  Open in authenticator
                </a>
                <Input
                  className="input w-40"
                  uppercase={false}
                  value={code}
                  inputMode="numeric"
                  placeholder="6-digit code"
                  onChange={(e) => setCode(e.target.value)}
                />
                <div className="flex gap-2">
                  <Button onClick={() => verify.mutate()} loading={verify.isPending} disabled={!code}>
                    Confirm
                  </Button>
                  <Button variant="ghost" onClick={() => setPending(null)}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            {enrolled && (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  MFA is protecting your account. To turn it off, enter a current code.
                </p>
                <div className="flex gap-2">
                  <Input
                    className="input w-40"
                    uppercase={false}
                    value={disableCode}
                    placeholder="code"
                    onChange={(e) => setDisableCode(e.target.value)}
                  />
                  <Button
                    variant="destructive"
                    onClick={() => disable.mutate()}
                    loading={disable.isPending}
                    disabled={!disableCode}
                  >
                    Disable MFA
                  </Button>
                </div>
              </div>
            )}

            {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
          </>
        )}
      </div>

      {recovery && (
        <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
          <h2 className="mb-1 font-semibold">Recovery codes</h2>
          <p className="mb-3 text-sm text-muted-foreground">
            Save these somewhere safe — each works once if you lose your authenticator. They are shown only
            now.
          </p>
          <div className="grid grid-cols-2 gap-2">
            {recovery.map((c) => (
              <code
                key={c}
                className="select-all rounded border border-border bg-muted px-2 py-1 font-mono text-sm"
              >
                {c}
              </code>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <h2 className="mb-1 font-semibold">Active sessions</h2>
        <p className="mb-3 text-sm text-muted-foreground">
          Devices currently signed in to your account. Revoke any you don’t recognise.
        </p>
        <SessionList currentJti={tokenStore.jti()} />
      </div>
    </div>
  );
}
