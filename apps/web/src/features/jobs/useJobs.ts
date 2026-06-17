/**
 * Background-job hooks (ADR-0030/B-7). `useJobs` reads the durable REST tray; `useRealtimeJobs` (mount
 * once in the shell) wires the socket so a RUNNING job's progress updates live and a finished job
 * refetches the tray. The socket is a nudge — the REST list stays the source of truth.
 */
import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { JobView, Paginated } from '@crm2/sdk';
import { onRealtime } from '../../lib/socket.js';
import { JOBS_KEY, fetchJobs } from './api.js';

export function useJobs() {
  return useQuery({
    queryKey: JOBS_KEY,
    queryFn: () => fetchJobs(),
    select: (d) => d.items,
  });
}

interface JobEvent {
  id: string;
  status: JobView['status'];
  progress: number;
  stage?: string | null;
}

export function useRealtimeJobs(): void {
  const qc = useQueryClient();
  useEffect(() => {
    // `job:progress` patches the cached row in place (smooth Hexagon %); a brand-new job not yet in
    // the list triggers a refetch so it appears immediately.
    const offProgress = onRealtime('job:progress', (payload) => {
      const e = payload as JobEvent;
      const cur = qc.getQueryData<Paginated<JobView>>(JOBS_KEY);
      if (cur?.items.some((j) => j.id === e.id)) {
        qc.setQueryData<Paginated<JobView>>(JOBS_KEY, {
          ...cur,
          items: cur.items.map((j) =>
            j.id === e.id ? { ...j, status: e.status, progress: e.progress, stage: e.stage ?? j.stage } : j,
          ),
        });
      } else {
        void qc.invalidateQueries({ queryKey: JOBS_KEY });
      }
    });
    // `job:done` carries no result body — refetch to pull the final status + artifact pointer.
    const offDone = onRealtime('job:done', () => {
      void qc.invalidateQueries({ queryKey: JOBS_KEY });
    });
    return () => {
      offProgress();
      offDone();
    };
  }, [qc]);
}
