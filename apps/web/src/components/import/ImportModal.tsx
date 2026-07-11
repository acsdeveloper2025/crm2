import { useRef, useState, type ReactNode, type RefObject } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  importErrorsToCsv,
  type ImportConfirmResult,
  type ImportPreviewResult,
  type ImportRowError,
  type JobView,
  type OnboardingConfirmResult,
  type OnboardingPreviewResult,
  type OnboardingSheetPreview,
} from '@crm2/sdk';
import { apiBlob, apiUpload, ApiError } from '../../lib/sdk.js';
import { useFocusTrap } from '../../lib/useFocusTrap.js';
import { Button } from '../ui/Button.js';
import { DownloadIcon, UploadIcon } from '../ui/icons.js';
import { ScrollRegion } from '../ui/ScrollRegion.js';

/** What an importable list passes in: the API base path, the cache key to refresh, and a label. */
export interface ImportConfig {
  /** e.g. `/api/v2/clients`. */
  basePath: string;
  /** TanStack query key root to invalidate after a successful import. */
  queryKey: string;
  /** singular entity label, e.g. `client` (used in copy + the error-file name). */
  entityLabel: string;
}

/** Trigger the download of a blob with a given filename (same pattern as the DataGrid export). */
function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

const TOO_LARGE_MSG = 'Too many rows for a direct import — split the file (background import coming soon).';

/** Maps an upload failure to user copy. Shared by the single-resource and workbook modals — the two
 *  server error codes (413 too-large, empty-file) mean the same thing either way; only the generic
 *  fallback (wrong file type) differs, so it's the one caller-supplied bit. */
/** A server `{ error, details:{ hint } }` body → the hint string, when present. */
function errorHint(e: ApiError): string | undefined {
  const details = (e.body as { details?: { hint?: unknown } } | undefined)?.details;
  return typeof details?.hint === 'string' ? details.hint : undefined;
}

function importErrorMessage(e: unknown, invalidFileMsg: string): string {
  if (e instanceof ApiError && e.code === 'IMPORT_TOO_LARGE') return TOO_LARGE_MSG;
  if (e instanceof ApiError && e.code === 'NO_IMPORT_FILE')
    return 'That file looks empty — choose a filled-in template.';
  // Surface a server-supplied hint (e.g. UNKNOWN_SCOPE_SHEET tells the operator exactly which sheet
  // headers a CSV must carry) instead of the generic wrong-file-type fallback.
  if (e instanceof ApiError) {
    const hint = errorHint(e);
    if (hint) return hint;
  }
  return invalidFileMsg;
}

/** The dialog chrome (overlay, focus-trapped box, title/subtitle, error banner) shared by every
 *  import modal — only the stage-conditional body differs between the single-resource and workbook
 *  variants. */
function DialogShell({
  dialogRef,
  titleId,
  title,
  subtitle,
  error,
  children,
}: {
  dialogRef: RefObject<HTMLDivElement | null>;
  titleId: string;
  title: string;
  subtitle: string;
  error: string | null;
  children: ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-border bg-card p-6 text-card-foreground shadow-lg"
      >
        <h2 id={titleId} className="mb-1 text-lg font-semibold">
          {title}
        </h2>
        <p className="mb-4 text-sm text-muted-foreground">{subtitle}</p>

        {error && (
          <p
            role="alert"
            className="mb-3 rounded border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive"
          >
            {error}
          </p>
        )}

        {children}
      </div>
    </div>
  );
}

/** The Row/Column/Error table (§6 error-report columns), shared by every panel that lists row errors.
 *  Renders nothing for an empty list so callers can use it unconditionally. */
function ErrorTable({
  errors,
  title = 'Errors (fix these rows and re-upload)',
}: {
  errors: ImportRowError[];
  title?: string;
}) {
  if (errors.length === 0) return null;
  return (
    <div className="rounded border border-border">
      <div className="border-b border-border bg-muted/40 px-3 py-2 text-xs font-medium">{title}</div>
      <div className="max-h-48 overflow-y-auto">
        <table className="w-full text-left text-xs">
          <thead className="text-muted-foreground">
            <tr>
              <th scope="col" className="px-3 py-1">
                Row
              </th>
              <th scope="col" className="px-3 py-1">
                Column
              </th>
              <th scope="col" className="px-3 py-1">
                Error
              </th>
            </tr>
          </thead>
          <tbody>
            {errors.map((e, i) => (
              <tr key={i} className="border-t border-border">
                <td className="px-3 py-1 font-mono">{e.rowNumber}</td>
                <td className="px-3 py-1">{e.column}</td>
                <td className="px-3 py-1">{e.message}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** The Import button + its modal flow (IMPORT_EXPORT_STANDARD §5): Template → Upload → Preview → Confirm → Result.
 *  `label` defaults to "Import"; pass a distinct label when a page shows more than one importer (e.g. Users
 *  has both "Import Users" and "Import Scope") so the two buttons are not visually identical. */
export function ImportButton({ config, label = 'Import' }: { config: ImportConfig; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <UploadIcon />
        {label}
      </Button>
      {open && <ImportModal config={config} onClose={() => setOpen(false)} />}
    </>
  );
}

type Stage = 'idle' | 'previewing' | 'preview' | 'confirming' | 'done';

function ImportModal({ config, onClose }: { config: ImportConfig; onClose: () => void }) {
  const qc = useQueryClient();
  const dialogRef = useFocusTrap<HTMLDivElement>(true, onClose);
  const fileInput = useRef<HTMLInputElement>(null);
  const [stage, setStage] = useState<Stage>('idle');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreviewResult | null>(null);
  const [result, setResult] = useState<ImportConfirmResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const toMessage = (e: unknown): string =>
    importErrorMessage(e, 'Import failed. Check the file is the .xlsx or .csv template and try again.');

  const downloadTemplate = async () => {
    setError(null);
    try {
      const { blob, filename } = await apiBlob(`${config.basePath}/import-template`);
      downloadBlob(blob, filename);
    } catch {
      setError('Could not download the template.');
    }
  };

  const onPick = async (picked: File | undefined) => {
    if (!picked) return;
    setFile(picked);
    setError(null);
    setStage('previewing');
    try {
      const res = await apiUpload<ImportPreviewResult>(
        `${config.basePath}/import?mode=preview`,
        picked,
        picked.name,
      );
      setPreview(res);
      setStage('preview');
    } catch (e) {
      setError(toMessage(e));
      setStage('idle');
      setFile(null);
    }
  };

  const confirm = async () => {
    if (!file) return;
    setError(null);
    setStage('confirming');
    try {
      const res = await apiUpload<ImportConfirmResult | JobView>(
        `${config.basePath}/import?mode=confirm`,
        file,
        file.name,
      );
      if ('successRows' in res) {
        setResult(res);
        setStage('done');
        if (res.successRows > 0) qc.invalidateQueries({ queryKey: [config.queryKey] });
      } else {
        // ≥ threshold → a background IMPORT job (ADR-0030/B-14). Track it in the Jobs tray; the list
        // refreshes when the user returns. Close the modal — the work continues server-side.
        qc.invalidateQueries({ queryKey: ['jobs'] });
        toast('Import started in the background', {
          description: "Track it in the Jobs tray — we'll notify you when it's done.",
        });
        reset();
      }
    } catch (e) {
      setError(toMessage(e));
      setStage('preview');
    }
  };

  const reset = () => {
    setFile(null);
    setPreview(null);
    setResult(null);
    setError(null);
    setStage('idle');
    if (fileInput.current) fileInput.current.value = '';
  };

  const downloadErrors = (errors: ImportRowError[]) =>
    downloadBlob(
      new Blob([importErrorsToCsv(errors)], { type: 'text/csv;charset=utf-8' }),
      `${config.entityLabel}-import-errors.csv`,
    );

  const headers = preview && preview.sample[0] ? Object.keys(preview.sample[0]) : [];

  return (
    <DialogShell
      dialogRef={dialogRef}
      titleId="import-dialog-title"
      title={`Import ${config.entityLabel}s`}
      subtitle="Download the template, fill it in, then upload to preview before importing."
      error={error}
    >
      <>
        {(stage === 'idle' || stage === 'previewing') && (
          <div className="space-y-4">
            <Button variant="secondary" onClick={downloadTemplate}>
              <DownloadIcon />
              Download template (.xlsx)
            </Button>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-foreground">
                Upload filled template (.xlsx or .csv)
              </span>
              <input
                ref={fileInput}
                type="file"
                accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
                className="input"
                disabled={stage === 'previewing'}
                onChange={(e) => onPick(e.target.files?.[0])}
              />
            </label>
            {stage === 'previewing' && <p className="text-sm text-muted-foreground">Validating…</p>}
          </div>
        )}

        {stage === 'preview' && preview && (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-4 text-sm">
              <span>
                Total rows: <strong>{preview.totalRows}</strong>
              </span>
              <span className="text-primary">
                Valid: <strong>{preview.validRows}</strong>
              </span>
              <span className={preview.errorRows ? 'text-destructive' : ''}>
                Errors: <strong>{preview.errorRows}</strong>
              </span>
            </div>

            <ErrorTable errors={preview.errors} />

            {preview.sample.length > 0 && (
              <div className="rounded border border-border">
                <div className="border-b border-border bg-muted/40 px-3 py-2 text-xs font-medium">
                  Preview of valid rows
                </div>
                <ScrollRegion className="max-h-48" label="Import preview rows">
                  <table className="w-full text-left text-xs">
                    <thead className="text-muted-foreground">
                      <tr>
                        {headers.map((h) => (
                          <th scope="col" key={h} className="px-3 py-1">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {preview.sample.map((row, i) => (
                        <tr key={i} className="border-t border-border">
                          {headers.map((h) => (
                            <td key={h} className="px-3 py-1">
                              {row[h]}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </ScrollRegion>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={reset}>
                Choose different file
              </Button>
              <Button onClick={confirm} disabled={preview.validRows === 0}>
                Import {preview.validRows} {config.entityLabel}
                {preview.validRows === 1 ? '' : 's'}
              </Button>
            </div>
          </div>
        )}

        {stage === 'confirming' && <p className="text-sm text-muted-foreground">Importing…</p>}

        {stage === 'done' && result && (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-4 text-sm">
              <span className="text-primary">
                Imported: <strong>{result.successRows}</strong>
              </span>
              <span className={result.failedRows ? 'text-destructive' : ''}>
                Failed: <strong>{result.failedRows}</strong>
              </span>
              <span className="text-muted-foreground">{result.durationMs} ms</span>
            </div>
            {result.errors.length > 0 && (
              <Button variant="secondary" onClick={() => downloadErrors(result.errors)}>
                <DownloadIcon />
                Download error report (.csv)
              </Button>
            )}
            <div className="flex justify-end">
              <Button onClick={onClose}>Done</Button>
            </div>
          </div>
        )}

        {stage !== 'done' && (
          <div className="mt-5 flex justify-end">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
          </div>
        )}
      </>
    </DialogShell>
  );
}

/** What the Client Setup hub's onboarding-workbook importer passes in (ADR-0092 S5): the workbook's
 *  base path (the modal appends `-import?mode=…`), every query-key root to invalidate on a successful
 *  confirm (the hub's grids + checklist all key off these), and the label used in copy. Distinct from
 *  {@link ImportConfig} — one workbook upload spans 5 sheets/modules, not one resource. */
export interface WorkbookImportConfig {
  /** e.g. `` `/api/v2/clients/${clientId}/onboarding` `` — the modal POSTs to `${basePath}-import`. */
  basePath: string;
  /** every TanStack query-key root to invalidate after a successful confirm. */
  queryKeys: string[];
  /** label used in the dialog title and the per-sheet error-file names. */
  entityLabel: string;
}

/** ≥1 committable row (valid, or pending on a cross-sheet projection) anywhere in the workbook — the
 *  gate for enabling Confirm (ADR-0092 S5). */
export function workbookConfirmEnabled(p: OnboardingPreviewResult): boolean {
  return p.sheets.some((s) => s.validRows + s.pendingRows > 0);
}

/** The per-sheet preview chip copy — singular/plural on the error count only. "Pending" is the
 *  onboarding cross-sheet-projection concept; it's omitted when 0 so surfaces that never produce
 *  pending rows (e.g. the scope workbook) don't show a meaningless "⧗ 0 pending". */
export function sheetSummary(s: OnboardingSheetPreview): string {
  const pending = s.pendingRows > 0 ? ` · ⧗ ${s.pendingRows} pending` : '';
  return `✓ ${s.validRows} valid${pending} · ✗ ${s.errorRows} error${s.errorRows === 1 ? '' : 's'}`;
}

/** Confirm-button copy: the total rows confirm will actually act on — valid + pending, summed across
 *  every sheet (same set {@link workbookConfirmEnabled} gates on) — so the count on the button matches
 *  what lands, not the raw upload size. Singular for exactly 1 (ADR-0092 S6 review). */
export function workbookConfirmLabel(p: OnboardingPreviewResult): string {
  const n = p.sheets.reduce((sum, s) => sum + s.validRows + s.pendingRows, 0);
  return `Import ${n} row${n === 1 ? '' : 's'}`;
}

/** The "Import workbook" button + its modal (ADR-0092 S5) — same Stage machinery and dialog chrome as
 *  {@link ImportButton}/{@link ImportModal}, just fanned out over the workbook's 5 sheets. The
 *  template download lives on the hub's existing "Download workbook" button, not this modal. */
export function WorkbookImportButton({
  config,
  label = 'Import workbook',
  disabled,
}: {
  config: WorkbookImportConfig;
  label?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" disabled={disabled} onClick={() => setOpen(true)}>
        <UploadIcon />
        {label}
      </Button>
      {open && <WorkbookImportModal config={config} onClose={() => setOpen(false)} />}
    </>
  );
}

function WorkbookImportModal({ config, onClose }: { config: WorkbookImportConfig; onClose: () => void }) {
  const qc = useQueryClient();
  const dialogRef = useFocusTrap<HTMLDivElement>(true, onClose);
  const fileInput = useRef<HTMLInputElement>(null);
  const [stage, setStage] = useState<Stage>('idle');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<OnboardingPreviewResult | null>(null);
  const [result, setResult] = useState<OnboardingConfirmResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const toMessage = (e: unknown): string =>
    importErrorMessage(e, 'Import failed. Check the file is the workbook (.xlsx) and try again.');

  const onPick = async (picked: File | undefined) => {
    if (!picked) return;
    setFile(picked);
    setError(null);
    setStage('previewing');
    try {
      const res = await apiUpload<OnboardingPreviewResult>(
        `${config.basePath}-import?mode=preview`,
        picked,
        picked.name,
      );
      setPreview(res);
      setStage('preview');
    } catch (e) {
      setError(toMessage(e));
      setStage('idle');
      setFile(null);
    }
  };

  const confirm = async () => {
    if (!file) return;
    setError(null);
    setStage('confirming');
    try {
      // Sync-only (no background-job branch): the workbook endpoint never enqueues a JOB.
      const res = await apiUpload<OnboardingConfirmResult>(
        `${config.basePath}-import?mode=confirm`,
        file,
        file.name,
      );
      setResult(res);
      setStage('done');
      if (res.sheets.some((s) => s.successRows > 0)) {
        for (const key of config.queryKeys) qc.invalidateQueries({ queryKey: [key] });
      }
    } catch (e) {
      setError(toMessage(e));
      setStage('preview');
    }
  };

  const reset = () => {
    setFile(null);
    setPreview(null);
    setResult(null);
    setError(null);
    setStage('idle');
    if (fileInput.current) fileInput.current.value = '';
  };

  const downloadSheetErrors = (sheetName: string, errors: ImportRowError[]) =>
    downloadBlob(
      new Blob([importErrorsToCsv(errors)], { type: 'text/csv;charset=utf-8' }),
      `${config.entityLabel}-${sheetName}-import-errors.csv`,
    );

  return (
    <DialogShell
      dialogRef={dialogRef}
      titleId="workbook-import-dialog-title"
      title={`Import ${config.entityLabel}`}
      subtitle="Upload the filled-in workbook to preview before importing."
      error={error}
    >
      <>
        {(stage === 'idle' || stage === 'previewing') && (
          <div className="space-y-4">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-foreground">
                Upload filled workbook (.xlsx)
              </span>
              <input
                ref={fileInput}
                type="file"
                accept=".xlsx"
                className="input"
                disabled={stage === 'previewing'}
                onChange={(e) => onPick(e.target.files?.[0])}
              />
            </label>
            {stage === 'previewing' && <p className="text-sm text-muted-foreground">Validating…</p>}
          </div>
        )}

        {stage === 'preview' && preview && (
          <div className="space-y-4">
            {preview.sheets.map((sheet) => (
              <div key={sheet.name} className="space-y-2 rounded border border-border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-medium">{sheet.name}</h3>
                  <span className="text-xs text-muted-foreground">{sheetSummary(sheet)}</span>
                </div>
                <ErrorTable errors={sheet.errors} />
                {sheet.errors.length > 0 && (
                  <Button variant="ghost" onClick={() => downloadSheetErrors(sheet.name, sheet.errors)}>
                    <DownloadIcon />
                    Download {sheet.name} errors (.csv)
                  </Button>
                )}
              </div>
            ))}

            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={reset}>
                Choose different file
              </Button>
              <Button onClick={confirm} disabled={!workbookConfirmEnabled(preview)}>
                {workbookConfirmLabel(preview)}
              </Button>
            </div>
          </div>
        )}

        {stage === 'confirming' && <p className="text-sm text-muted-foreground">Importing…</p>}

        {stage === 'done' && result && (
          <div className="space-y-4">
            {result.sheets.map((sheet) => (
              <div key={sheet.name} className="space-y-2 rounded border border-border p-3">
                <div className="flex flex-wrap items-center gap-4 text-sm">
                  <h3 className="font-medium">{sheet.name}</h3>
                  <span className="text-primary">
                    Imported: <strong>{sheet.successRows}</strong>
                  </span>
                  <span className={sheet.failedRows ? 'text-destructive' : ''}>
                    Failed: <strong>{sheet.failedRows}</strong>
                  </span>
                  <span className="text-muted-foreground">{sheet.durationMs} ms</span>
                </div>
                {sheet.errors.length > 0 && (
                  <Button variant="secondary" onClick={() => downloadSheetErrors(sheet.name, sheet.errors)}>
                    <DownloadIcon />
                    Download {sheet.name} error report (.csv)
                  </Button>
                )}
              </div>
            ))}
            <div className="flex justify-end">
              <Button onClick={onClose}>Done</Button>
            </div>
          </div>
        )}

        {stage !== 'done' && (
          <div className="mt-5 flex justify-end">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
          </div>
        )}
      </>
    </DialogShell>
  );
}
