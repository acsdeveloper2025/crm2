import { useState } from 'react';
import { useAuth } from '../../lib/AuthContext.js';

const ERROR_LABELS: Record<string, string> = {
  INVALID_CREDENTIALS: 'Incorrect username or password.',
  UNAUTHENTICATED: 'Session expired. Please sign in again.',
};

export function LoginPage() {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [mfaNeeded, setMfaNeeded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(username.trim(), password, mfaCode.trim() || undefined);
    } catch (err) {
      const code = err instanceof Error ? err.message : 'UNKNOWN';
      if (code === 'MFA_REQUIRED') {
        // account has MFA — reveal the code field and (if it was already shown) flag a bad code
        setError(mfaNeeded ? 'Invalid authentication code. Try again.' : null);
        setMfaNeeded(true);
      } else {
        setError(ERROR_LABELS[code] ?? 'Sign-in failed. Please try again.');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-muted text-foreground">
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-lg border border-border bg-card p-6 shadow-sm"
      >
        <div className="mb-1 text-lg font-bold tracking-tight">CRM2</div>
        <p className="mb-5 text-sm text-muted-foreground">Sign in to continue.</p>

        <label className="mb-3 block">
          <span className="mb-1 block text-xs font-medium text-foreground">Username</span>
          <input
            className="input"
            value={username}
            autoFocus
            autoComplete="username"
            onChange={(e) => setUsername(e.target.value)}
          />
        </label>
        <label className="mb-3 block">
          <span className="mb-1 block text-xs font-medium text-foreground">Password</span>
          <input
            className="input"
            type="password"
            value={password}
            autoComplete="current-password"
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>

        {mfaNeeded && (
          <label className="mb-3 block">
            <span className="mb-1 block text-xs font-medium text-foreground">Authentication code</span>
            <input
              className="input"
              value={mfaCode}
              autoFocus
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="6-digit code or recovery code"
              onChange={(e) => setMfaCode(e.target.value)}
            />
            <span className="mt-1 block text-xs text-muted-foreground">
              Enter the code from your authenticator app.
            </span>
          </label>
        )}

        {error && <p className="mb-3 text-sm text-destructive">{error}</p>}

        <button
          className="btn w-full"
          type="submit"
          disabled={busy || !username || !password || (mfaNeeded && !mfaCode)}
        >
          {busy ? 'Signing in…' : mfaNeeded ? 'Verify & Sign In' : 'Sign In'}
        </button>
      </form>
    </div>
  );
}
