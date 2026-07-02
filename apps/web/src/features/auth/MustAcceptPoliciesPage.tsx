/**
 * Blocking policy-acceptance screen (no app shell). Shown when login returns mustAcceptPolicies.
 * The user reads each active policy and accepts all to continue; declining logs out (ADR-0042).
 */
import { useState } from 'react';
import { toast } from 'sonner';
import { useAuth } from '../../lib/AuthContext.js';
import { Button } from '../../components/ui/Button.js';
import { AppFooter } from '../../components/AppFooter.js';

export function MustAcceptPoliciesPage() {
  const { pendingPolicies, acceptPolicies, logout } = useAuth();
  const [busy, setBusy] = useState(false);

  const accept = async () => {
    setBusy(true);
    try {
      await acceptPolicies();
      toast.success('Thank you — policies accepted.');
    } catch {
      toast.error('Could not record your acceptance. Please try again.');
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-surface-muted p-4 text-foreground">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-lg border border-border bg-card shadow-sm">
        <div className="border-b border-border p-6">
          <div className="text-lg font-bold tracking-tight">Please review and accept to continue</div>
          <p className="mt-1 text-sm text-muted-foreground">
            You must accept the following before using the application.
          </p>
        </div>
        <div
          className="flex-1 space-y-6 overflow-y-auto p-6"
          tabIndex={0}
          role="region"
          aria-label="Policy text"
        >
          {pendingPolicies.map((p) => (
            <section key={p.id}>
              <h2 className="mb-2 text-sm font-semibold">{p.name}</h2>
              <pre className="whitespace-pre-wrap break-words font-sans text-sm text-muted-foreground">
                {p.content}
              </pre>
            </section>
          ))}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-border p-4">
          <Button variant="destructive" onClick={() => void logout()} disabled={busy}>
            Log out
          </Button>
          <Button onClick={() => void accept()} loading={busy}>
            I Accept
          </Button>
        </div>
      </div>
      <footer className="mt-4 w-full max-w-2xl">
        <AppFooter />
      </footer>
    </div>
  );
}
