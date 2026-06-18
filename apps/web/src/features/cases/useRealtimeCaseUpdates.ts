import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CASE_UPDATED_EVENT, type CaseUpdateEvent } from '@crm2/sdk';
import { onRealtime } from '../../lib/socket.js';

/**
 * Live case/task status (ADR-0027). The API broadcasts {@link CASE_UPDATED_EVENT} to the office room on
 * every committed task/case status change — from a device action (start/complete/revoke/submit) or
 * another office user (assign/complete/revoke/finalize) — so the case detail, pipeline and dashboard
 * refetch live instead of waiting for a manual reload. Mounted once in Layout, alongside the
 * notification + jobs live channels. The field app never joins the office room, so it isn't notified.
 */
export function useRealtimeCaseUpdates(): void {
  const qc = useQueryClient();
  useEffect(() => {
    return onRealtime(CASE_UPDATED_EVENT, (payload) => {
      const e = payload as CaseUpdateEvent;
      if (e?.caseId) void qc.invalidateQueries({ queryKey: ['case', e.caseId] });
      void qc.invalidateQueries({ queryKey: ['cases'] });
      void qc.invalidateQueries({ queryKey: ['tasks'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
    });
  }, [qc]);
}
