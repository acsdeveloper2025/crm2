import { useFocusTrap } from '../../lib/useFocusTrap.js';
import { Button } from '../../components/ui/Button.js';

interface SessionTimeoutModalProps {
  remainingSeconds: number;
  onStay: () => void;
  onLogout: () => void;
}

/**
 * Idle warn-then-logout modal (ADR-0045). `role="alertdialog"` + a polite live region announce the
 * countdown; the focus trap's Escape default is the SAFE action (Stay), and "Stay logged in" is the
 * first focusable so it receives initial focus — Escape/Tab never lands on Log out.
 */
export function SessionTimeoutModal({ remainingSeconds, onStay, onLogout }: SessionTimeoutModalProps) {
  const ref = useFocusTrap<HTMLDivElement>(true, onStay);
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-foreground/40 p-4">
      <div
        ref={ref}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="idle-title"
        aria-describedby="idle-desc"
        className="w-full max-w-md rounded-lg border border-border bg-card p-6 text-card-foreground shadow-lg"
      >
        <h2 id="idle-title" className="text-lg font-semibold text-foreground">
          Still there?
        </h2>
        <p id="idle-desc" aria-live="polite" className="mt-2 text-sm text-muted-foreground">
          For your security you’ll be signed out in{' '}
          <span className="font-bold text-destructive">{remainingSeconds}</span> seconds due to inactivity.
        </p>
        {/* Stay is first in the DOM (initial focus target); flex-row-reverse keeps it visually right. */}
        <div className="mt-5 flex flex-row-reverse gap-2">
          <Button onClick={onStay}>Stay logged in</Button>
          <Button variant="destructive" onClick={onLogout}>
            Log out now
          </Button>
        </div>
      </div>
    </div>
  );
}
