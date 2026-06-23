import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  importErrorsToCsv,
  type ImportConfirmResult,
  type ImportPreviewResult,
  type ImportRowError,
  type JobView,
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

/** The Import button + its modal flow (IMPORT_EXPORT_STANDARD §5): Template → Upload → Preview → Confirm → Result. */
export function ImportButton({ config }: { config: ImportConfig }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <UploadIcon />
        Import
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
    e instanceof ApiError && e.code === 'IMPORT_TOO_LARGE'
      ? TOO_LARGE_MSG
      : e instanceof ApiError && e.code === 'NO_IMPORT_FILE'
        ? 'That file looks empty — choose a filled-in template.'
        : 'Import failed. Check the file is the .xlsx template and try again.';

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-dialog-title"
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-border bg-card p-6 text-card-foreground shadow-lg"
      >
        <h2 id="import-dialog-title" className="mb-1 text-lg font-semibold">
          Import {config.entityLabel}s
        </h2>
        <p className="mb-4 text-sm text-muted-foreground">
          Download the template, fill it in, then upload to preview before importing.
        </p>

        {error && (
          <p
            role="alert"
            className="mb-3 rounded border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive"
          >
            {error}
          </p>
        )}

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

            {preview.errors.length > 0 && (
              <div className="rounded border border-border">
                <div className="border-b border-border bg-muted/40 px-3 py-2 text-xs font-medium">
                  Errors (fix these rows and re-upload)
                </div>
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
                      {preview.errors.map((e, i) => (
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
            )}

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
      </div>
    </div>
  );
}
