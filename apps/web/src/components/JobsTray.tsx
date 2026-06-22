/**
 * Background-jobs tray (ADR-0030/B-7). A header popover, beside the bell, showing the user's recent
 * background jobs: a RUNNING job shows the determinate Hexagon (real %, the §7/§8 loader); a finished
 * EXPORT offers a Download (presigned /jobs/:id/result-url); a capped export says so (no silent
 * truncation); a failed job shows its error. Live-updated via `useRealtimeJobs` (mounted in Layout).
 * Inline SVG + theme tokens to match the shell (no icon/color literals).
 */
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { JobView } from '@crm2/sdk';
import { formatDateTime } from '../lib/format.js';
import { useJobs } from '../features/jobs/useJobs.js';
import { fetchJobResultUrl } from '../features/jobs/api.js';
import { HexagonLoader } from './ui/HexagonLoader.js';
import { Button } from './ui/Button.js';

const MAX_BADGE = 9;
const isActive = (j: JobView): boolean => j.status === 'PENDING' || j.status === 'RUNNING';

function TrayIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

function jobResult(j: JobView): {
  filename?: string;
  capped?: boolean;
  totalCount?: number;
  rowCount?: number;
  successRows?: number;
  failedRows?: number;
  totalRows?: number;
} {
  return (j.result ?? {}) as {
    filename?: string;
    capped?: boolean;
    totalCount?: number;
    rowCount?: number;
    successRows?: number;
    failedRows?: number;
    totalRows?: number;
  };
}

export function JobsTray() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { data: jobs = [] } = useJobs();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const activeCount = jobs.filter(isActive).length;
  const running = jobs.find((j) => j.status === 'RUNNING');

  const download = async (j: JobView): Promise<void> => {
    try {
      const { url } = await fetchJobResultUrl(j.id);
      window.open(url, '_blank', 'noopener');
    } catch {
      toast.error('Could not start the download. Please try again.');
    }
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-label={activeCount > 0 ? `Background jobs, ${activeCount} running` : 'Background jobs'}
        aria-expanded={open}
        className="relative rounded-md p-1 text-secondary-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        onClick={() => setOpen((v) => !v)}
      >
        <TrayIcon />
        {activeCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold leading-none text-primary-foreground">
            {activeCount > MAX_BADGE ? `${MAX_BADGE}+` : activeCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-lg">
          <div className="border-b border-border px-3 py-2">
            <span className="text-sm font-semibold">Background jobs</span>
          </div>

          {running && (
            <div className="border-b border-border">
              <HexagonLoader
                percent={running.progress}
                operation={`${running.type} — ${running.progress}%`}
                {...(running.stage ? { subStep: running.stage } : {})}
              />
            </div>
          )}

          <div className="max-h-96 overflow-y-auto">
            {jobs.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">No background jobs</p>
            ) : (
              jobs.map((j) => {
                const r = jobResult(j);
                return (
                  <div
                    key={j.id}
                    className="flex flex-col items-start gap-0.5 border-b border-border px-3 py-2 text-left"
                  >
                    <span className="flex w-full items-center justify-between gap-2">
                      <span className="text-sm font-medium uppercase">{j.type}</span>
                      <span className="text-[11px] uppercase text-muted-foreground">{j.status}</span>
                    </span>
                    {isActive(j) && (
                      <span className="text-xs text-muted-foreground">
                        {j.progress}%{j.stage ? ` · ${j.stage}` : ''}
                      </span>
                    )}
                    {j.status === 'SUCCEEDED' && (j.type === 'EXPORT' || j.type === 'CASE_REPORT') && (
                      <span className="flex w-full flex-col items-start gap-1">
                        <Button variant="secondary" size="sm" onClick={() => void download(j)}>
                          Download {r.filename ?? 'file'}
                        </Button>
                        {r.capped && (
                          <span className="text-[11px] text-destructive">
                            {(r.rowCount ?? 0).toLocaleString()} of {(r.totalCount ?? 0).toLocaleString()}{' '}
                            matched rows — refine filters for the full set.
                          </span>
                        )}
                      </span>
                    )}
                    {j.status === 'SUCCEEDED' && j.type === 'IMPORT' && (
                      <span className="text-xs text-muted-foreground">
                        Imported {(r.successRows ?? 0).toLocaleString()} of{' '}
                        {(r.totalRows ?? 0).toLocaleString()} rows
                        {r.failedRows ? ` · ${r.failedRows.toLocaleString()} failed` : ''}
                      </span>
                    )}
                    {j.status === 'FAILED' && (
                      <span className="text-xs text-destructive">{j.error ?? 'Failed'}</span>
                    )}
                    <span className="text-[11px] text-muted-foreground">{formatDateTime(j.createdAt)}</span>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
