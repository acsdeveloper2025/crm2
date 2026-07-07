import { useEffect, useState } from 'react';
import { useAuth } from '../../lib/AuthContext.js';
import { ApiError } from '../../lib/sdk.js';
import { Button } from '../../components/ui/Button.js';
import { Input } from '../../components/ui/Input.js';
import { Logo } from '../../components/Logo.js';
import { AppFooter } from '../../components/AppFooter.js';

const ERROR_LABELS: Record<string, string> = {
  INVALID_CREDENTIALS: 'Incorrect username/email or password.',
  UNAUTHENTICATED: 'Session expired. Please sign in again.',
  ACCOUNT_LOCKED: 'Too many failed attempts. Try again in 15 minutes.',
};

/** Masked destinations off a 401 OTP_REQUIRED (ADR-0088), e.g. "r***@acs.com and ******7890". */
function otpSentToLabel(err: unknown): string | null {
  if (!(err instanceof ApiError)) return null;
  const sentTo = (
    err.body as {
      details?: { sentTo?: { email?: string | null; sms?: string | null; whatsapp?: string | null } };
    }
  )?.details?.sentTo;
  // De-dupe: SMS and WhatsApp mask to the same number — show the phone once even when both fired.
  const parts = [...new Set([sentTo?.email, sentTo?.sms, sentTo?.whatsapp].filter((x): x is string => !!x))];
  return parts.length > 0 ? parts.join(' and ') : null;
}

const OTP_RESEND_COOLDOWN_S = 60; // mirrors the server cooldown (ADR-0088)

// Owner: swap in a real helpdesk email/phone if you have one (see login footer).
const SUPPORT_HINT = 'Trouble signing in? Contact your administrator.';

/** Inline eye / eye-off (no icon dep — matches Layout's raw-SVG convention). */
function EyeIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
function EyeOffIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9.9 4.24A9.1 9.1 0 0 1 12 4c6.5 0 10 7 10 7a13.2 13.2 0 0 1-1.67 2.68" />
      <path d="M6.06 6.06C3.6 7.6 2 12 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.94-1.94" />
      <path d="m3 3 18 18" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </svg>
  );
}

const HEADLINE = 'Verification, organized.';

/** One-time typewriter reveal for the brand panel; respects prefers-reduced-motion (full text, no motion). */
function useTypewriter(text: string, speed = 45) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setCount(text.length);
      return;
    }
    setCount(0);
    const id = setInterval(() => {
      setCount((n) => {
        if (n >= text.length) {
          clearInterval(id);
          return n;
        }
        return n + 1;
      });
    }, speed);
    return () => clearInterval(id);
  }, [text, speed]);
  return text.slice(0, count);
}

export function LoginPage() {
  const { login, logoutReason } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [mfaNeeded, setMfaNeeded] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [otpNeeded, setOtpNeeded] = useState(false);
  const [otpSentTo, setOtpSentTo] = useState<string | null>(null);
  const [resendWait, setResendWait] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [capsOn, setCapsOn] = useState(false);
  const typed = useTypewriter(HEADLINE);
  const typedDone = typed.length === HEADLINE.length;

  // resend-cooldown ticker (the button re-enables when it hits 0)
  useEffect(() => {
    if (resendWait <= 0) return;
    const id = setTimeout(() => setResendWait((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [resendWait]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(username.trim(), password, mfaCode.trim() || undefined, otpCode.trim() || undefined);
    } catch (err) {
      const code = err instanceof Error ? err.message : 'UNKNOWN';
      if (code === 'MFA_REQUIRED') {
        // account has MFA — reveal the code field and (if it was already shown) flag a bad code
        setError(mfaNeeded ? 'Invalid authentication code. Try again.' : null);
        setMfaNeeded(true);
      } else if (code === 'OTP_REQUIRED') {
        // new device (ADR-0088) — a code went out to the user's registered contact(s)
        const hadCode = otpNeeded && otpCode.trim().length > 0;
        setError(hadCode ? 'Invalid or expired code. Try again.' : null);
        if (hadCode) setOtpCode('');
        if (!otpNeeded) setResendWait(OTP_RESEND_COOLDOWN_S);
        setOtpNeeded(true);
        setOtpSentTo((prev) => otpSentToLabel(err) ?? prev);
      } else {
        setError(ERROR_LABELS[code] ?? 'Sign-in failed. Please try again.');
      }
    } finally {
      setBusy(false);
    }
  };

  /** Re-login without a code → the server re-delivers the SAME still-valid code (ADR-0088). */
  const resendOtp = async () => {
    setError(null);
    setBusy(true);
    try {
      await login(username.trim(), password); // succeeds outright if the gate has since cleared
    } catch (err) {
      const code = err instanceof Error ? err.message : 'UNKNOWN';
      if (code === 'OTP_REQUIRED') {
        setOtpSentTo((prev) => otpSentToLabel(err) ?? prev);
        setResendWait(OTP_RESEND_COOLDOWN_S);
      } else {
        setError(ERROR_LABELS[code] ?? 'Could not resend the code. Please try again.');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-surface-muted text-foreground lg:grid lg:grid-cols-2">
      {/* Brand panel — desktop only. Solid brand color + reversed logo (no gradient, per freeze). */}
      <aside className="hidden flex-col bg-primary p-10 text-primary-foreground lg:flex">
        <Logo tone="inverse" size={30} wordmarkClass="text-xl" />
        <div className="flex max-w-md flex-1 flex-col justify-center">
          <h2 className="text-3xl font-bold leading-tight tracking-tight" aria-label={HEADLINE}>
            <span aria-hidden="true">{typed}</span>
            {!typedDone && (
              <span
                aria-hidden="true"
                className="ml-1 inline-block h-[0.9em] w-0.5 animate-pulse bg-primary-foreground align-middle"
              />
            )}
          </h2>
          <p
            className={`mt-3 text-sm transition-opacity duration-500 ${typedDone ? 'opacity-80' : 'opacity-0'}`}
          >
            Field visits, office checks, and KYC — every case tracked end to end, in one place.
          </p>
        </div>
      </aside>

      <div className="flex min-h-screen flex-col items-center justify-center p-4 lg:min-h-0">
        <form
          onSubmit={submit}
          aria-labelledby="login-title"
          className="w-full max-w-sm rounded-lg border border-border bg-card p-6 shadow-sm"
        >
          <Logo size={28} wordmarkClass="text-lg" className="mb-4 lg:hidden" />
          <h1 id="login-title" className="text-lg font-bold tracking-tight">
            Sign in
          </h1>
          <p className="mb-5 mt-1 text-sm text-muted-foreground">Enter your credentials to continue.</p>

          {logoutReason && (
            <p
              role="status"
              className="mb-4 rounded-md border border-border bg-surface-muted px-3 py-2 text-sm text-muted-foreground"
            >
              {logoutReason}
            </p>
          )}

          <label className="mb-3 block">
            <span className="mb-1 block text-xs font-medium text-foreground">Username or Email</span>
            <Input
              className="input"
              uppercase={false}
              value={username}
              autoFocus
              autoComplete="username"
              onChange={(e) => setUsername(e.target.value)}
            />
          </label>
          <div className="mb-3">
            {/* Explicit htmlFor (not an implicit wrapping label) so the show/hide button below is
                NOT part of the input's accessible name — the field is named exactly "Password". */}
            <label htmlFor="login-password" className="mb-1 block text-xs font-medium text-foreground">
              Password
            </label>
            <div className="relative">
              <Input
                id="login-password"
                className="input pr-10"
                type={showPw ? 'text' : 'password'}
                uppercase={false}
                value={password}
                autoComplete="current-password"
                onChange={(e) => setPassword(e.target.value)}
                onKeyUp={(e) => setCapsOn(e.getModifierState('CapsLock'))}
                onKeyDown={(e) => setCapsOn(e.getModifierState('CapsLock'))}
              />
              <button
                type="button"
                onClick={() => setShowPw((v) => !v)}
                aria-label={showPw ? 'Hide password' : 'Show password'}
                aria-pressed={showPw}
                className="absolute inset-y-0 right-0 flex items-center rounded-r-md px-3 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {showPw ? <EyeOffIcon /> : <EyeIcon />}
              </button>
            </div>
            {capsOn && (
              <span
                role="status"
                className="mt-1 inline-block rounded bg-warning px-1.5 py-0.5 text-xs font-medium text-warning-foreground"
              >
                Caps Lock is on
              </span>
            )}
          </div>

          {mfaNeeded && (
            <label className="mb-3 block">
              <span className="mb-1 block text-xs font-medium text-foreground">Authentication code</span>
              <Input
                className="input"
                uppercase={false}
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

          {otpNeeded && (
            <div className="mb-3">
              <label htmlFor="login-otp" className="mb-1 block text-xs font-medium text-foreground">
                Sign-in code
              </label>
              <Input
                id="login-otp"
                className="input"
                uppercase={false}
                value={otpCode}
                autoFocus
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="6-digit code"
                onChange={(e) => setOtpCode(e.target.value)}
              />
              <span role="status" className="mt-1 block text-xs text-muted-foreground">
                New device detected.{' '}
                {otpSentTo ? `We sent a code to ${otpSentTo}.` : 'We sent a code to your registered contact.'}
              </span>
              <button
                type="button"
                onClick={resendOtp}
                disabled={busy || resendWait > 0}
                className="mt-1 text-xs font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
              >
                {resendWait > 0 ? `Resend code (${resendWait}s)` : 'Resend code'}
              </button>
            </div>
          )}

          {error && (
            <p role="alert" className="mb-3 text-sm text-destructive">
              {error}
            </p>
          )}

          <Button
            className="w-full"
            type="submit"
            loading={busy}
            disabled={!username || !password || (mfaNeeded && !mfaCode) || (otpNeeded && !otpCode)}
          >
            {mfaNeeded || otpNeeded ? 'Verify & Sign In' : 'Sign In'}
          </Button>
        </form>
        <footer className="mt-4 w-full max-w-sm">
          <p className="text-center text-xs text-muted-foreground">{SUPPORT_HINT}</p>
          <AppFooter className="mt-1" />
        </footer>
      </div>
    </div>
  );
}
