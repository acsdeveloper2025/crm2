import { formatDateTime } from '../lib/format.js';
import { useFocusTrap } from '../lib/useFocusTrap.js';
import { Button } from './ui/Button.js';

/** The fresh server row returned on a 409 STALE_UPDATE (ADR-0019); only the audit fields are read here. */
interface ConflictCurrent {
  updatedAt?: string;
  updatedBy?: string | null;
  version?: number;
}

/**
 * OCC conflict dialog (CONCURRENCY_AND_EDITING_STANDARD §5). Shown when a save returns 409
 * STALE_UPDATE: the record changed while the user was editing. Never silently overwrite or discard —
 * the user chooses to reload & re-apply their edits (onReload, which adopts the fresh version) or to
 * discard. Reused by every admin module's edit surface.
 */
export function ConflictDialog({
  entityLabel,
  current,
  onReload,
  onDiscard,
}: {
  entityLabel: string;
  current: ConflictCurrent | undefined;
  onReload: () => void;
  onDiscard: () => void;
}) {
  // A must-decide dialog: Escape is a no-op (no non-destructive dismiss) — Tab cycles to the two
  // explicit choices, so it is not a keyboard trap (WCAG 2.1.2 exception). Focus returns to the
  // edit surface on unmount.
  const dialogRef = useFocusTrap<HTMLDivElement>(true, () => undefined);
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-foreground/40 p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="conflict-dialog-title"
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-lg border border-border bg-card p-6 text-card-foreground shadow-lg"
      >
        <h2 id="conflict-dialog-title" className="mb-2 text-lg font-semibold text-destructive">
          Update conflict
        </h2>
        <p className="text-sm text-foreground">
          This {entityLabel} was changed by someone else
          {current?.updatedAt ? ` at ${formatDateTime(current.updatedAt)}` : ''} while you were editing. Your
          changes were not saved.
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          Reload to pick up the latest version, then re-apply and save — or discard your changes.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={onDiscard}>
            Discard my changes
          </Button>
          <Button onClick={onReload}>Reload &amp; re-apply</Button>
        </div>
      </div>
    </div>
  );
}
