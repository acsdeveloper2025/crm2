/**
 * Forced change-password screen. Shown (blocking, no app shell) when login returns
 * mustChangePassword — an admin-issued temporary password or a password past its role's rotation
 * window (per-role policy). The user proves their current password and sets a strong new one; on
 * success every session is revoked server-side, so they're signed out and re-authenticate with the
 * new password. Reuses the same complexity checklist the rest of the app uses.
 */
import { useState } from 'react';
import { toast } from 'sonner';
import { useAuth } from '../../lib/AuthContext.js';
import { api, ApiError } from '../../lib/sdk.js';
import { PasswordPolicyChecklist, isPasswordStrong } from '../../components/PasswordPolicyChecklist.js';
import { Button } from '../../components/ui/Button.js';
import { Input } from '../../components/ui/Input.js';

export function MustChangePasswordPage() {
  const { logout } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api('POST', '/api/v2/auth/change-password', { currentPassword: current, newPassword: next });
      toast.success('Password updated. Please sign in with your new password.');
      await logout(); // server revoked all sessions; drop to the login screen
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === 'INVALID_CREDENTIALS'
          ? 'Your current password is incorrect.'
          : 'Could not change the password. Please try again.',
      );
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-muted text-foreground">
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-lg border border-border bg-card p-6 shadow-sm"
      >
        <div className="mb-1 text-lg font-bold tracking-tight">Update your password</div>
        <p className="mb-5 text-sm text-muted-foreground">
          Your password must be changed before you can continue. Choose a new one below.
        </p>

        <label className="mb-3 block">
          <span className="mb-1 block text-xs font-medium text-foreground">Current password</span>
          <Input
            className="input"
            type="password"
            uppercase={false}
            autoComplete="current-password"
            value={current}
            autoFocus
            onChange={(e) => setCurrent(e.target.value)}
          />
        </label>
        <label className="mb-2 block">
          <span className="mb-1 block text-xs font-medium text-foreground">New password</span>
          <Input
            className="input"
            type="password"
            uppercase={false}
            autoComplete="new-password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
          />
        </label>
        {next.length > 0 && (
          <div className="mb-3">
            <PasswordPolicyChecklist password={next} />
          </div>
        )}
        <label className="mb-3 block">
          <span className="mb-1 block text-xs font-medium text-foreground">Confirm new password</span>
          <Input
            className="input"
            type="password"
            uppercase={false}
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </label>
        {confirm.length > 0 && next !== confirm && (
          <p className="mb-3 text-xs text-destructive">Passwords do not match.</p>
        )}
        {error && <p className="mb-3 text-sm text-destructive">{error}</p>}

        <Button
          className="w-full"
          type="submit"
          loading={busy}
          disabled={!current || !isPasswordStrong(next) || next !== confirm}
        >
          Update password
        </Button>
        <Button variant="ghost" className="mt-2 w-full" onClick={() => void logout()} disabled={busy}>
          Sign out
        </Button>
      </form>
    </div>
  );
}
