/**
 * Live password-complexity checklist (v1 parity). Mirrors the API's StrongPasswordSchema exactly
 * (8+ chars · lower · upper · digit · symbol) so what the user sees ticking off is what the server
 * enforces. Shown wherever a NEW password is typed: admin create-user, profile change-password, and
 * the forced-change screen. `isPasswordStrong` is the single source the same surfaces gate Save on.
 */
const RULES: { label: string; test: (p: string) => boolean }[] = [
  { label: 'At least 8 characters', test: (p) => p.length >= 8 },
  { label: 'An uppercase letter (A–Z)', test: (p) => /[A-Z]/.test(p) },
  { label: 'A lowercase letter (a–z)', test: (p) => /[a-z]/.test(p) },
  { label: 'A number (0–9)', test: (p) => /[0-9]/.test(p) },
  { label: 'A special character', test: (p) => /[^A-Za-z0-9]/.test(p) },
];

/** True when the password satisfies every rule — the same gate the surfaces use to enable Save. */
export function isPasswordStrong(password: string): boolean {
  return RULES.every((r) => r.test(password));
}

function Tick({ ok }: { ok: boolean }) {
  return ok ? (
    <svg viewBox="0 0 16 16" className="size-3.5 shrink-0 text-primary" fill="none" aria-hidden="true">
      <path
        d="M3 8.5l3 3 7-7"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ) : (
    <span className="size-3.5 shrink-0 rounded-full border border-muted-foreground/50" aria-hidden="true" />
  );
}

export function PasswordPolicyChecklist({ password }: { password: string }) {
  return (
    <ul className="rounded-md border border-border bg-muted/40 p-3 text-xs">
      {RULES.map((r) => {
        const ok = r.test(password);
        return (
          <li key={r.label} className="flex items-center gap-2 py-0.5">
            <Tick ok={ok} />
            <span className={ok ? 'text-foreground' : 'text-muted-foreground'}>{r.label}</span>
          </li>
        );
      })}
    </ul>
  );
}
