import { Fragment, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  VISIT_TYPES,
  VISIT_TYPE_LABELS,
  KYC_RESULTS,
  KYC_RESULT_LABELS,
  TASK_ORIGIN_LABELS,
  CASE_STATUS_LABELS,
  type CaseDetail,
  type CaseTaskView,
  type CaseVerdictEvent,
  type AssignableUser,
  type AssignTaskInput,
  type CompleteTaskInput,
  type CaseFinalizeInput,
  type KycResult,
  type VisitType,
  type CaseAttachment,
  type CaseFieldPhoto,
  type CaseDataEntry,
  type CasePickup,
  type SavePickupInput,
  type ReportLayoutColumn,
  type FieldReportView,
  type JobView,
  type CaseReportFormat,
} from '@crm2/sdk';
import { toast } from 'sonner';
import { api, apiUpload, apiBlob, ApiError } from '../../lib/sdk.js';
import { JOBS_KEY } from '../jobs/api.js';
import { formatDateTime } from '../../lib/format.js';
import { useAuth } from '../../lib/AuthContext.js';
import { ConflictDialog } from '../../components/ConflictDialog.js';
import { HexagonLoader } from '../../components/ui/HexagonLoader.js';
import { AddTasksForm } from './AddTasksForm.js';

/** Affordances gate on the PERMISSION (ADR-0022) — resolved by /auth/me, never a role name. */
const CASE_ASSIGN = 'case.assign';
const CASE_CREATE = 'case.create';
const FIELD_REVIEW_COMPLETE = 'field_review.complete';
const CASE_FINALIZE = 'case.finalize';
const TASK_REVOKE = 'task.revoke';
const TASK_REWORK = 'task.rework';
/** Office data-entry (ADR-0037, MIS slice 3) — key a CASE's MIS fields against its active DATA_ENTRY layout. */
const DATA_ENTRY_MANAGE = 'data_entry.manage';
/** A task awaiting the back-office final result (ADR-0025) — the finalize affordance shows here. */
const FINALIZABLE = new Set(['ASSIGNED', 'SUBMITTED_FOR_REVIEW']);
/** Backend/office REVOKE (ADR-0033, v1 parity): a LIVE task only — never a COMPLETED one. */
const REVOCABLE = new Set(['ASSIGNED', 'IN_PROGRESS']);
/** REVISIT (ADR-0033): a follow-up only on a COMPLETED task (the client asked for more). */
const REVISITABLE = new Set(['COMPLETED']);
/** REASSIGN-AFTER-REVOKE (ADR-0033): only a REVOKED task gets a replacement. */
const REASSIGNABLE = new Set(['REVOKED']);

/** Case-status badge tone (ADR-0032). Mirrors the Pipeline task-status palette; AWAITING_COMPLETION
 *  reads as "under review" (awaiting the office verdict). */
const CASE_STATUS_TONE: Record<string, string> = {
  NEW: 'bg-st-pending-bg text-st-pending',
  IN_PROGRESS: 'bg-st-in-progress-bg text-st-in-progress',
  AWAITING_COMPLETION: 'bg-st-under-review-bg text-st-under-review',
  COMPLETED: 'bg-st-approved-bg text-st-approved',
  REVOKED: 'bg-st-rejected-bg text-st-rejected',
  CANCELLED: 'bg-st-rejected-bg text-st-rejected',
};

export function CaseDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user } = useAuth();
  const has = (perm: string) =>
    !!user && (user.grantsAll === true || (user.permissions ?? []).includes(perm));
  const canAssign = has(CASE_ASSIGN);
  const canCreate = has(CASE_CREATE);
  const canComplete = has(FIELD_REVIEW_COMPLETE);
  const canFinalize = has(CASE_FINALIZE);
  const canRevoke = has(TASK_REVOKE);
  const canRework = has(TASK_REWORK);
  const canDataEntry = has(DATA_ENTRY_MANAGE);
  const [finalizeError, setFinalizeError] = useState<string | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['case', id],
    queryFn: () => api<CaseDetail>('GET', `/api/v2/cases/${id}`),
  });

  // Case finalize (ADR-0032): record the ONE final verdict + close (AWAITING_COMPLETION → COMPLETED).
  const finalize = useMutation({
    mutationFn: (body: CaseFinalizeInput & { version: number }) =>
      api<CaseDetail>('POST', `/api/v2/cases/${id}/finalize`, body),
    onSuccess: () => {
      setFinalizeError(null);
      void qc.invalidateQueries({ queryKey: ['case', id] });
      void qc.invalidateQueries({ queryKey: ['case-verdict-history', id] });
    },
    onError: (e) => setFinalizeError(e instanceof ApiError && e.code === 'STALE_UPDATE' ? 'STALE' : 'FAILED'),
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (isError || !data) return <p className="text-sm text-destructive">Case not found.</p>;

  return (
    <div className="space-y-4">
      <button className="text-sm text-primary hover:underline" onClick={() => navigate('/cases')}>
        ← Back to cases
      </button>

      <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold tracking-tight">
            <span className="font-mono">{data.caseNumber}</span> · {data.primaryName}
          </h1>
          <span
            className={`rounded px-2 py-0.5 text-xs font-medium ${CASE_STATUS_TONE[data.status] ?? 'bg-surface-muted'}`}
          >
            {CASE_STATUS_LABELS[data.status] ?? data.status.replace(/_/g, ' ')}
          </span>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-sm md:grid-cols-4">
          <Meta label="Client" value={data.clientName} />
          <Meta label="Product" value={data.productName} />
          <Meta label="Mobile" value={data.primaryMobile ?? '—'} />
          <Meta label="PAN" value={data.primaryPan ?? '—'} />
          <Meta label="Created" value={formatDateTime(data.createdAt)} />
          <Meta label="Dedupe" value={data.dedupeDecision.replace(/_/g, ' ')} />
          {data.dedupeRationale && <Meta label="Dedupe rationale" value={data.dedupeRationale} />}
          {data.dedupeMatchedCaseNumbers.length > 0 && (
            <Meta label="Created despite duplicates" value={data.dedupeMatchedCaseNumbers.join(', ')} />
          )}
        </div>
      </div>

      {/* Lifecycle order (Zion NewDataQC top→bottom): identity → subjects → work → office data →
          evidence → verdict history → the terminal case verdict (LAST). */}

      {/* Subjects */}
      <div className="overflow-x-auto rounded-lg border border-border bg-card shadow-sm">
        <div className="bg-surface-muted px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Applicants — {data.applicants.length}
        </div>
        <table className="w-full text-sm rtable">
          <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-semibold">Name</th>
              <th className="px-3 py-2 font-semibold">Type</th>
              <th className="px-3 py-2 font-semibold">Mobile</th>
              <th className="px-3 py-2 font-semibold">PAN</th>
              <th className="px-3 py-2 font-semibold">Company</th>
            </tr>
          </thead>
          <tbody>
            {data.applicants.map((a) => (
              <tr key={a.id} className="border-t border-border">
                <td className="px-3 py-2" data-label="Name">
                  {a.name}
                </td>
                <td className="px-3 py-2" data-label="Type">
                  {a.applicantType.replace(/_/g, ' ')}
                </td>
                <td className="px-3 py-2" data-label="Mobile">
                  {a.mobile ?? '—'}
                </td>
                <td className="px-3 py-2 font-mono text-xs" data-label="PAN">
                  {a.pan ?? '—'}
                </td>
                <td className="px-3 py-2" data-label="Company">
                  {a.companyName ?? '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* The work: documents / tasks (create → assign → execute → per-task result); "+ Add Tasks"
          lives in the task card header (canCreate). */}
      <TasksSection
        caseId={id}
        tasks={data.tasks}
        canAssign={canAssign}
        canComplete={canComplete}
        canRevoke={canRevoke}
        canRework={canRework}
        canCreate={canCreate}
        clientId={data.clientId}
        productId={data.productId}
        applicants={data.applicants}
      />

      {/* Office reference attachments */}
      <AttachmentsSection caseId={id} tasks={data.tasks} canUpload={canCreate} />

      {/* Office data capture (MIS keying + pickup logistics) */}
      {canDataEntry && <DataEntrySection caseId={id} />}

      {canDataEntry && <PickupSection caseId={id} />}

      {/* Field outputs from the mobile app: the verification report (#6) + the field photos (#7) */}
      <MobileReportSection caseId={id} tasks={data.tasks} />

      <FieldPhotosSection caseId={id} />

      {/* Outcome: past verdicts, then the terminal case verdict, then the client report download (LAST). */}
      <VerdictHistory caseId={id} />

      {(data.status === 'COMPLETED' || data.status === 'AWAITING_COMPLETION') && (
        <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Case Result
          </h2>
          {data.status === 'COMPLETED' ? (
            <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm md:grid-cols-4">
              <Meta
                label="Verdict"
                value={data.verificationOutcome ? KYC_RESULT_LABELS[data.verificationOutcome] : '—'}
              />
              <Meta label="Remark" value={data.resultRemark ?? '—'} />
              <Meta label="Finalized by" value={data.completedByName ?? '—'} />
              <Meta label="Finalized" value={data.completedAt ? formatDateTime(data.completedAt) : '—'} />
            </div>
          ) : canFinalize ? (
            <CaseFinalizeForm
              pending={finalize.isPending}
              error={finalizeError}
              onSubmit={(body) => finalize.mutate({ ...body, version: data.version })}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              All tasks complete — awaiting the back-office final verdict.
            </p>
          )}
        </div>
      )}

      {/* Client report download (#9) — the config-driven CASE_REPORT engine (ADR-0037 follow-up). */}
      <CaseReportSection caseId={id} />
    </div>
  );
}

/** Case verdict history (ADR-0033): every finalize (who/when/what), newest first. Surfaces the
 *  before/after when a revisit re-opened the case and the office re-finalized. Hidden until the case
 *  has been finalized at least once (no events → nothing to show). */
function VerdictHistory({ caseId }: { caseId: string }) {
  const { data } = useQuery({
    queryKey: ['case-verdict-history', caseId],
    queryFn: () => api<CaseVerdictEvent[]>('GET', `/api/v2/cases/${caseId}/verdict-history`),
  });
  if (!data || data.length === 0) return null;

  return (
    <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Verdict History
      </h2>
      <ul className="space-y-2">
        {data.map((v, i) => (
          <li key={i} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <span className="rounded bg-surface-muted px-2 py-0.5 text-xs font-medium uppercase tracking-wide">
              {KYC_RESULT_LABELS[v.result]}
            </span>
            {v.remark && <span>{v.remark}</span>}
            <span className="text-muted-foreground">
              {v.actorName ?? 'Unknown'} · {formatDateTime(v.at)}
            </span>
            {i === 0 && data.length > 1 && (
              <span className="text-xs font-medium text-st-approved">current</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function TasksSection({
  caseId,
  tasks,
  canAssign,
  canComplete,
  canRevoke,
  canRework,
  canCreate,
  clientId,
  productId,
  applicants,
}: {
  caseId: string;
  tasks: CaseTaskView[];
  canAssign: boolean;
  canComplete: boolean;
  canRevoke: boolean;
  canRework: boolean;
  canCreate: boolean;
  clientId: number;
  productId: number;
  applicants: CaseDetail['applicants'];
}) {
  const qc = useQueryClient();
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  // "+ Add Tasks" lives in this card's header (Zion keeps document-add in the case work surface).
  const [addingTasks, setAddingTasks] = useState(false);
  // The task whose inline finalize form is open (ADR-0025) — separate from the assign accordion.
  const [completeTaskId, setCompleteTaskId] = useState<string | null>(null);
  // Office intervention (ADR-0033): revoke a LIVE task / revisit a COMPLETED task / reassign a REVOKED
  // one (reuses the assign form). Each is its own open-row, mutually exclusive with the others.
  const [revokeTaskId, setRevokeTaskId] = useState<string | null>(null);
  const [revisitTaskId, setRevisitTaskId] = useState<string | null>(null);
  const [reassignTaskId, setReassignTaskId] = useState<string | null>(null);
  // OCC (CONCURRENCY §5): the fresh row from a 409 STALE_UPDATE — drives the ConflictDialog.
  const [conflict, setConflict] = useState<CaseTaskView | null>(null);

  const onOccError = (e: unknown) => {
    if (e instanceof ApiError && e.code === 'STALE_UPDATE') {
      const current = (e.body as { current?: CaseTaskView } | undefined)?.current;
      if (current) setConflict(current);
    }
  };

  const assign = useMutation({
    mutationFn: ({ taskId, body }: { taskId: string; body: AssignTaskInput & { version: number } }) =>
      api<CaseTaskView>('POST', `/api/v2/cases/${caseId}/tasks/${taskId}/assign`, body),
    onSuccess: () => {
      setOpenTaskId(null);
      void qc.invalidateQueries({ queryKey: ['case', caseId] });
    },
    onError: onOccError,
  });

  const unassign = useMutation({
    mutationFn: ({ taskId, version }: { taskId: string; version: number }) =>
      api<CaseTaskView>('POST', `/api/v2/cases/${caseId}/tasks/${taskId}/unassign`, { version }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['case', caseId] }),
    onError: onOccError,
  });

  const complete = useMutation({
    mutationFn: ({ taskId, body }: { taskId: string; body: CompleteTaskInput & { version: number } }) =>
      api<CaseTaskView>('POST', `/api/v2/cases/${caseId}/tasks/${taskId}/complete`, body),
    onSuccess: () => {
      setCompleteTaskId(null);
      void qc.invalidateQueries({ queryKey: ['case', caseId] });
    },
    onError: onOccError,
  });

  // Record the per-task office result on an already-COMPLETED (field-completed) task (ADR-0032 D3).
  const recordResult = useMutation({
    mutationFn: ({ taskId, body }: { taskId: string; body: CompleteTaskInput & { version: number } }) =>
      api<CaseTaskView>('POST', `/api/v2/cases/${caseId}/tasks/${taskId}/result`, body),
    onSuccess: () => {
      setCompleteTaskId(null);
      void qc.invalidateQueries({ queryKey: ['case', caseId] });
    },
    onError: onOccError,
  });

  // Backend/office REVOKE a LIVE task (ADR-0033, v1 parity) → {ASSIGNED,IN_PROGRESS} → REVOKED.
  const revoke = useMutation({
    mutationFn: ({ taskId, reason }: { taskId: string; reason: string }) =>
      api<CaseTaskView>('POST', `/api/v2/cases/${caseId}/tasks/${taskId}/revoke`, { reason }),
    onSuccess: () => {
      setRevokeTaskId(null);
      void qc.invalidateQueries({ queryKey: ['case', caseId] });
    },
  });
  // Office intervention (ADR-0033). REVISIT a COMPLETED task → a new lineage task (re-opens the case).
  const revisit = useMutation({
    mutationFn: ({ taskId, reason }: { taskId: string; reason: string }) =>
      api<CaseTaskView>('POST', `/api/v2/cases/${caseId}/tasks/${taskId}/revisit`, { reason }),
    onSuccess: () => {
      setRevisitTaskId(null);
      void qc.invalidateQueries({ queryKey: ['case', caseId] });
    },
  });
  // REASSIGN-AFTER-REVOKE → a replacement task for a REVOKED one (reuses the assign payload).
  const reassign = useMutation({
    mutationFn: ({ taskId, body }: { taskId: string; body: AssignTaskInput }) =>
      api<CaseTaskView>('POST', `/api/v2/cases/${caseId}/tasks/${taskId}/reassign`, body),
    onSuccess: () => {
      setReassignTaskId(null);
      void qc.invalidateQueries({ queryKey: ['case', caseId] });
    },
  });

  const canAct = canAssign || canComplete || canRevoke || canRework;
  const colCount = canAct ? 10 : 9;

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card shadow-sm">
      <div className="flex items-center justify-between bg-surface-muted px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Documents / Tasks — {tasks.length}
        </span>
        {canCreate && !addingTasks && (
          <button className="btn-ghost" onClick={() => setAddingTasks(true)}>
            + Add Tasks
          </button>
        )}
      </div>
      {canCreate && addingTasks && (
        <div className="border-b border-border p-3">
          <AddTasksForm
            caseId={caseId}
            clientId={clientId}
            productId={productId}
            applicants={applicants}
            canAssign={canAssign}
            submitLabel="Add"
            onAdded={() => {
              setAddingTasks(false);
              void qc.invalidateQueries({ queryKey: ['case', caseId] });
            }}
            onCancel={() => setAddingTasks(false)}
          />
        </div>
      )}
      <table className="w-full text-sm rtable">
        <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-3 py-2 font-semibold">Code</th>
            <th className="px-3 py-2 font-semibold">Verification Unit</th>
            <th className="px-3 py-2 font-semibold">Status</th>
            <th className="px-3 py-2 font-semibold">Assignee</th>
            <th className="px-3 py-2 font-semibold">Visit</th>
            <th className="px-3 py-2 font-semibold">Rate Type</th>
            <th className="px-3 py-2 font-semibold">Bill</th>
            <th className="px-3 py-2 font-semibold">Created</th>
            <th className="px-3 py-2 font-semibold">Updated</th>
            {canAct && <th className="px-3 py-2 font-semibold">Action</th>}
          </tr>
        </thead>
        <tbody>
          {tasks.map((t) => {
            const assigned = t.status !== 'PENDING' && t.assignedTo;
            return (
              <Fragment key={t.id}>
                <tr className="border-t border-border">
                  <td className="px-3 py-2 font-mono text-xs" data-label="Code">
                    {t.unitCode}
                  </td>
                  <td className="px-3 py-2" data-label="Verification Unit">
                    {t.unitName}
                    {t.taskOrigin !== 'ORIGINAL' && (
                      <span className="ml-2 rounded bg-surface-muted px-1.5 py-0.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        {TASK_ORIGIN_LABELS[t.taskOrigin]}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2" data-label="Status">
                    {t.status.replace(/_/g, ' ')}
                    {t.verificationOutcome && (
                      <span className="text-muted-foreground">
                        {' '}
                        — {KYC_RESULT_LABELS[t.verificationOutcome]}
                      </span>
                    )}
                    {t.status === 'REVOKED' && t.remark && (
                      <span className="text-muted-foreground"> — {t.remark}</span>
                    )}
                  </td>
                  <td className="px-3 py-2" data-label="Assignee">
                    {t.assignedToName ?? '—'}
                  </td>
                  <td className="px-3 py-2" data-label="Visit">
                    {t.visitType ? VISIT_TYPE_LABELS[t.visitType] : '—'}
                  </td>
                  <td className="px-3 py-2" data-label="Rate Type">
                    {t.rateType ?? '—'}
                  </td>
                  <td className="px-3 py-2 tabular-nums" data-label="Bill">
                    {t.billCount}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-muted-foreground" data-label="Created">
                    {formatDateTime(t.createdAt)}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-muted-foreground" data-label="Updated">
                    {formatDateTime(t.updatedAt)}
                  </td>
                  {canAct && (
                    <td className="px-3 py-2" data-label="Action">
                      <div className="flex gap-2">
                        {/* ADR-0024 assign/reassign — only on an assignable (PENDING/ASSIGNED) task.
                            A terminal task is never assigned in place: COMPLETED is reworked via
                            REVISIT and REVOKED via reassign-after-revoke (ADR-0033, below). */}
                        {canAssign && (t.status === 'PENDING' || t.status === 'ASSIGNED') && (
                          <button
                            className="text-xs font-medium text-primary hover:underline"
                            onClick={() => {
                              setCompleteTaskId(null);
                              setOpenTaskId(openTaskId === t.id ? null : t.id);
                            }}
                          >
                            {assigned ? 'Reassign' : 'Assign'}
                          </button>
                        )}
                        {canAssign && t.status === 'ASSIGNED' && (
                          <button
                            className="text-xs font-medium text-destructive hover:underline"
                            onClick={() => unassign.mutate({ taskId: t.id, version: t.version })}
                            disabled={unassign.isPending}
                          >
                            Unassign
                          </button>
                        )}
                        {canComplete && FINALIZABLE.has(t.status) && (
                          <button
                            className="text-xs font-medium text-primary hover:underline"
                            onClick={() => {
                              setOpenTaskId(null);
                              setCompleteTaskId(completeTaskId === t.id ? null : t.id);
                            }}
                          >
                            Complete
                          </button>
                        )}
                        {/* A field-completed task carries no result yet — the office records it (D3). */}
                        {canComplete && t.status === 'COMPLETED' && !t.verificationOutcome && (
                          <button
                            className="text-xs font-medium text-primary hover:underline"
                            onClick={() => {
                              setOpenTaskId(null);
                              setCompleteTaskId(completeTaskId === t.id ? null : t.id);
                            }}
                          >
                            Record Result
                          </button>
                        )}
                        {/* Backend/office REVOKE a LIVE task (ADR-0033, v1 parity) — never a COMPLETED one. */}
                        {canRevoke && REVOCABLE.has(t.status) && (
                          <button
                            className="text-xs font-medium text-destructive hover:underline"
                            onClick={() => {
                              setOpenTaskId(null);
                              setCompleteTaskId(null);
                              setRevisitTaskId(null);
                              setReassignTaskId(null);
                              setRevokeTaskId(revokeTaskId === t.id ? null : t.id);
                            }}
                          >
                            Revoke
                          </button>
                        )}
                        {/* Office intervention (ADR-0033): REVISIT a COMPLETED task (client asked for
                            more → a new billed task); REASSIGN a REVOKED task (replacement). */}
                        {canRework && REVISITABLE.has(t.status) && (
                          <button
                            className="text-xs font-medium text-primary hover:underline"
                            onClick={() => {
                              setOpenTaskId(null);
                              setCompleteTaskId(null);
                              setReassignTaskId(null);
                              setRevisitTaskId(revisitTaskId === t.id ? null : t.id);
                            }}
                          >
                            Revisit
                          </button>
                        )}
                        {canRework && REASSIGNABLE.has(t.status) && (
                          <button
                            className="text-xs font-medium text-primary hover:underline"
                            onClick={() => {
                              setOpenTaskId(null);
                              setCompleteTaskId(null);
                              setRevisitTaskId(null);
                              setReassignTaskId(reassignTaskId === t.id ? null : t.id);
                            }}
                          >
                            Reassign
                          </button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
                {canAssign && openTaskId === t.id && (
                  <tr className="border-t border-border bg-surface-muted">
                    <td colSpan={colCount} className="px-3 py-3">
                      <AssignForm
                        task={t}
                        caseId={caseId}
                        pending={assign.isPending}
                        error={assign.isError}
                        onCancel={() => setOpenTaskId(null)}
                        onSubmit={(body) =>
                          assign.mutate({ taskId: t.id, body: { ...body, version: t.version } })
                        }
                      />
                    </td>
                  </tr>
                )}
                {canComplete && completeTaskId === t.id && (
                  <tr className="border-t border-border bg-surface-muted">
                    <td colSpan={colCount} className="px-3 py-3">
                      <CompleteForm
                        pending={complete.isPending || recordResult.isPending}
                        error={complete.isError || recordResult.isError}
                        onCancel={() => setCompleteTaskId(null)}
                        onSubmit={(body) =>
                          // a COMPLETED task → record the per-task office result; else complete it.
                          (t.status === 'COMPLETED' ? recordResult : complete).mutate({
                            taskId: t.id,
                            body: { ...body, version: t.version },
                          })
                        }
                      />
                    </td>
                  </tr>
                )}
                {canRevoke && revokeTaskId === t.id && (
                  <tr className="border-t border-border bg-surface-muted">
                    <td colSpan={colCount} className="px-3 py-3">
                      <ReasonForm
                        required
                        label="Reason"
                        placeholder="Why this task is revoked (required)"
                        submitLabel="Revoke"
                        pending={revoke.isPending}
                        error={revoke.isError}
                        onCancel={() => setRevokeTaskId(null)}
                        onSubmit={(reason) => revoke.mutate({ taskId: t.id, reason })}
                      />
                    </td>
                  </tr>
                )}
                {canRework && revisitTaskId === t.id && (
                  <tr className="border-t border-border bg-surface-muted">
                    <td colSpan={colCount} className="px-3 py-3">
                      <ReasonForm
                        pending={revisit.isPending}
                        error={revisit.isError}
                        onCancel={() => setRevisitTaskId(null)}
                        onSubmit={(reason) => revisit.mutate({ taskId: t.id, reason })}
                      />
                    </td>
                  </tr>
                )}
                {canRework && reassignTaskId === t.id && (
                  <tr className="border-t border-border bg-surface-muted">
                    <td colSpan={colCount} className="px-3 py-3">
                      <AssignForm
                        task={t}
                        caseId={caseId}
                        pending={reassign.isPending}
                        error={reassign.isError}
                        onCancel={() => setReassignTaskId(null)}
                        onSubmit={(body) => reassign.mutate({ taskId: t.id, body })}
                      />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
          {tasks.length === 0 && (
            <tr>
              <td colSpan={colCount} className="px-3 py-6 text-center text-muted-foreground">
                No documents added yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {conflict && (
        <ConflictDialog
          entityLabel="task assignment"
          current={conflict}
          onReload={() => {
            setConflict(null);
            void qc.invalidateQueries({ queryKey: ['case', caseId] });
          }}
          onDiscard={() => {
            setConflict(null);
            setOpenTaskId(null);
          }}
        />
      )}
    </div>
  );
}

function AssignForm({
  task,
  caseId,
  pending,
  error,
  onCancel,
  onSubmit,
}: {
  task: CaseTaskView;
  caseId: string;
  pending: boolean;
  error: boolean;
  onCancel: () => void;
  onSubmit: (body: AssignTaskInput) => void;
}) {
  const [assignedTo, setAssignedTo] = useState(task.assignedTo ?? '');
  const [visitType, setVisitType] = useState<VisitType>(task.visitType ?? 'FIELD');
  const [billCount, setBillCount] = useState(task.billCount || 1);

  // ADR-0024: the pool is the chosen visit-type pool ∩ (FIELD) the task's OWN territory — the same
  // model as Add Task, so reassign and create agree. FIELD needs the task to carry a location.
  const fieldNoLocation = visitType === 'FIELD' && !task.areaId;
  const { data: users, isLoading: usersLoading } = useQuery({
    queryKey: ['eligible-assignees', caseId, task.id, visitType],
    queryFn: () => {
      const p = new URLSearchParams({ visitType });
      if (visitType === 'FIELD' && task.areaId) {
        p.set('areaId', String(task.areaId));
        if (task.pincodeId) p.set('pincodeId', String(task.pincodeId));
      }
      return api<AssignableUser[]>('GET', `/api/v2/cases/${caseId}/eligible-assignees?${p.toString()}`);
    },
    enabled: !fieldNoLocation,
  });
  const pool = users ?? [];

  const submit = () => {
    if (!assignedTo) return;
    onSubmit({ assignedTo, visitType, billCount });
  };

  return (
    <div className="flex flex-wrap items-end gap-3">
      <Field label="Visit type">
        <select
          className="h-9 w-36 rounded-md border border-border bg-background px-2 text-sm"
          value={visitType}
          onChange={(e) => {
            setVisitType(e.target.value as VisitType);
            setAssignedTo(''); // pool changes with the visit type
          }}
        >
          {VISIT_TYPES.map((v) => (
            <option key={v} value={v}>
              {VISIT_TYPE_LABELS[v]}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Executive">
        <select
          className="h-9 w-56 rounded-md border border-border bg-background px-2 text-sm"
          value={assignedTo}
          onChange={(e) => setAssignedTo(e.target.value)}
        >
          <option value="">
            {fieldNoLocation
              ? 'Task has no location'
              : usersLoading
                ? 'Loading…'
                : pool.length === 0
                  ? 'No eligible executive'
                  : 'Select…'}
          </option>
          {pool.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name} ({u.role.replace(/_/g, ' ')})
            </option>
          ))}
        </select>
      </Field>
      <Field label="Bill count">
        <input
          type="number"
          min={0}
          max={50}
          className="h-9 w-24 rounded-md border border-border bg-background px-2 text-sm"
          value={billCount}
          onChange={(e) => setBillCount(Math.max(0, Number(e.target.value) || 0))}
        />
      </Field>
      <button
        className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"
        onClick={submit}
        disabled={pending || !assignedTo}
      >
        {pending ? 'Saving…' : 'Save'}
      </button>
      <button className="h-9 rounded-md border border-border px-4 text-sm" onClick={onCancel}>
        Cancel
      </button>
      {error && <span className="text-xs text-destructive">Assignment failed.</span>}
    </div>
  );
}

/** Finalize a task (ADR-0025): the back-office checker records the official result + a mandatory
 *  remark. One result dropdown (default unset → a conscious choice) + remark; Complete is disabled
 *  until both are valid (Zion's single FINAL STATUS, no field-evidence layer for desk/KYC). */
function CompleteForm({
  pending,
  error,
  onCancel,
  onSubmit,
}: {
  pending: boolean;
  error: boolean;
  onCancel: () => void;
  onSubmit: (body: CompleteTaskInput) => void;
}) {
  const [result, setResult] = useState<KycResult | ''>('');
  const [remark, setRemark] = useState('');
  const valid = result !== '' && remark.trim().length > 0;

  return (
    <div className="flex flex-wrap items-end gap-3">
      <Field label="Result">
        <select
          className="h-9 w-44 rounded-md border border-border bg-background px-2 text-sm"
          value={result}
          onChange={(e) => setResult(e.target.value as KycResult | '')}
        >
          <option value="">Select…</option>
          {KYC_RESULTS.map((r) => (
            <option key={r} value={r}>
              {KYC_RESULT_LABELS[r]}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Remark">
        <input
          className="h-9 w-72 rounded-md border border-border bg-background px-2 text-sm"
          value={remark}
          onChange={(e) => setRemark(e.target.value)}
          placeholder="Verification finding (required)"
        />
      </Field>
      <button
        className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"
        onClick={() => valid && onSubmit({ result: result as KycResult, remark: remark.trim() })}
        disabled={pending || !valid}
      >
        {pending ? 'Saving…' : 'Complete'}
      </button>
      <button className="h-9 rounded-md border border-border px-4 text-sm" onClick={onCancel}>
        Cancel
      </button>
      {error && <span className="text-xs text-destructive">Completion failed.</span>}
    </div>
  );
}

/** A single-reason inline form (ADR-0033) — drives REVISIT (optional note) and the backend REVOKE
 *  (required reason). The submit is disabled until a required reason is non-empty. */
function ReasonForm({
  pending,
  error,
  onCancel,
  onSubmit,
  required = false,
  label = 'Note (optional)',
  placeholder = 'Why a revisit is needed',
  submitLabel = 'Create revisit',
}: {
  pending: boolean;
  error: boolean;
  onCancel: () => void;
  onSubmit: (reason: string) => void;
  required?: boolean;
  label?: string;
  placeholder?: string;
  submitLabel?: string;
}) {
  const [reason, setReason] = useState('');
  const valid = !required || reason.trim().length > 0;

  return (
    <div className="flex flex-wrap items-end gap-3">
      <Field label={label}>
        <input
          className="h-9 w-80 rounded-md border border-border bg-background px-2 text-sm"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={placeholder}
        />
      </Field>
      <button
        className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"
        onClick={() => valid && onSubmit(reason.trim())}
        disabled={pending || !valid}
      >
        {pending ? 'Saving…' : submitLabel}
      </button>
      <button className="h-9 rounded-md border border-border px-4 text-sm" onClick={onCancel}>
        Cancel
      </button>
      {error && <span className="text-xs text-destructive">Action failed.</span>}
    </div>
  );
}

/** Case finalize (ADR-0032): the ONE final verdict + an optional case-level remark. The office
 *  decides this from the per-task office results; closes the case (AWAITING_COMPLETION → COMPLETED). */
function CaseFinalizeForm({
  pending,
  error,
  onSubmit,
}: {
  pending: boolean;
  error: string | null;
  onSubmit: (body: CaseFinalizeInput) => void;
}) {
  const [result, setResult] = useState<KycResult | ''>('');
  const [remark, setRemark] = useState('');
  const valid = result !== '';

  return (
    <div className="flex flex-wrap items-end gap-3">
      <Field label="Final verdict">
        <select
          className="h-9 w-44 rounded-md border border-border bg-background px-2 text-sm"
          value={result}
          onChange={(e) => setResult(e.target.value as KycResult | '')}
        >
          <option value="">Select…</option>
          {KYC_RESULTS.map((r) => (
            <option key={r} value={r}>
              {KYC_RESULT_LABELS[r]}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Remark (optional)">
        <input
          className="h-9 w-72 rounded-md border border-border bg-background px-2 text-sm"
          value={remark}
          onChange={(e) => setRemark(e.target.value)}
          placeholder="Case-level note"
        />
      </Field>
      <button
        className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"
        onClick={() =>
          valid &&
          onSubmit({ result: result as KycResult, ...(remark.trim() ? { remark: remark.trim() } : {}) })
        }
        disabled={pending || !valid}
      >
        {pending ? 'Finalizing…' : 'Finalize Case'}
      </button>
      {error === 'STALE' && (
        <span className="text-xs text-destructive">Case changed — reload and retry.</span>
      )}
      {error === 'FAILED' && <span className="text-xs text-destructive">Finalize failed.</span>}
    </div>
  );
}

/** Reference attachments (ADR-0025 B2): office users upload a PDF/image to the case or a specific
 *  task; the assignee (field agent / KYC verifier) + scoped users download it via a signed URL. NOT
 *  field photo-capture. Upload is raw bytes (apiUpload); read opens a short-lived signed URL. */
function AttachmentsSection({
  caseId,
  tasks,
  canUpload,
}: {
  caseId: string;
  tasks: CaseTaskView[];
  canUpload: boolean;
}) {
  const qc = useQueryClient();
  const [target, setTarget] = useState(''); // '' = whole case; else a task id
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const { data: attachments } = useQuery({
    queryKey: ['attachments', caseId],
    queryFn: () => api<CaseAttachment[]>('GET', `/api/v2/cases/${caseId}/attachments`),
  });

  const taskLabel = (taskId: string | null) =>
    taskId ? (tasks.find((t) => t.id === taskId)?.taskNumber ?? 'Task') : 'Case';

  const onPick = async (file: File | undefined) => {
    if (!file) return;
    setErr(null);
    setBusy(true);
    try {
      const path = `/api/v2/cases/${caseId}/attachments${target ? `?taskId=${target}` : ''}`;
      await apiUpload(path, file, file.name);
      await qc.invalidateQueries({ queryKey: ['attachments', caseId] });
    } catch (e) {
      setErr(e instanceof ApiError ? (e.code ?? 'Upload failed') : 'Upload failed');
    } finally {
      setBusy(false);
    }
  };

  const download = async (attId: string) => {
    const { url } = await api<{ url: string }>('GET', `/api/v2/cases/${caseId}/attachments/${attId}/url`);
    window.open(url, '_blank', 'noopener');
  };

  const remove = useMutation({
    mutationFn: (attId: string) =>
      api<{ deleted: boolean }>('DELETE', `/api/v2/cases/${caseId}/attachments/${attId}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['attachments', caseId] }),
  });

  const rows = attachments ?? [];
  const colCount = canUpload ? 7 : 6;

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 bg-surface-muted px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Attachments — {rows.length}
        </span>
        {canUpload && (
          <div className="flex items-center gap-2">
            <select
              className="h-8 rounded-md border border-border bg-background px-2 text-xs"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
            >
              <option value="">Whole case</option>
              {tasks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.taskNumber} · {t.unitName}
                </option>
              ))}
            </select>
            <label className="h-8 cursor-pointer rounded-md bg-primary px-3 text-xs font-medium leading-8 text-primary-foreground">
              {busy ? 'Uploading…' : '+ Upload'}
              <input
                type="file"
                className="hidden"
                accept=".pdf,image/png,image/jpeg,image/webp"
                disabled={busy}
                onChange={(e) => {
                  void onPick(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
            </label>
          </div>
        )}
      </div>
      {err && <div className="px-3 py-1 text-xs text-destructive">Upload failed: {err}</div>}
      <table className="w-full text-sm rtable">
        <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-3 py-2 font-semibold">Name</th>
            <th className="px-3 py-2 font-semibold">Attached to</th>
            <th className="px-3 py-2 font-semibold">Type</th>
            <th className="px-3 py-2 font-semibold">Size</th>
            <th className="px-3 py-2 font-semibold">Uploaded by</th>
            <th className="px-3 py-2 font-semibold">Uploaded</th>
            {canUpload && <th className="px-3 py-2 font-semibold">Action</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((a) => (
            <tr key={a.id} className="border-t border-border">
              <td className="px-3 py-2" data-label="Name">
                <button className="text-primary hover:underline" onClick={() => void download(a.id)}>
                  {a.originalName}
                </button>
              </td>
              <td className="px-3 py-2" data-label="Attached to">
                {taskLabel(a.taskId)}
              </td>
              <td className="px-3 py-2 text-xs text-muted-foreground" data-label="Type">
                {a.mimeType}
              </td>
              <td className="px-3 py-2 tabular-nums" data-label="Size">
                {formatBytes(a.fileSize)}
              </td>
              <td className="px-3 py-2" data-label="Uploaded by">
                {a.uploadedByName ?? '—'}
              </td>
              <td className="px-3 py-2 whitespace-nowrap text-muted-foreground" data-label="Uploaded">
                {formatDateTime(a.createdAt)}
              </td>
              {canUpload && (
                <td className="px-3 py-2" data-label="Action">
                  <button
                    className="text-xs font-medium text-destructive hover:underline"
                    onClick={() => remove.mutate(a.id)}
                    disabled={remove.isPending}
                  >
                    Delete
                  </button>
                </td>
              )}
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={colCount} className="px-3 py-6 text-center text-muted-foreground">
                No attachments.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

const KB = 1024;
const MB = KB * 1024;
function formatBytes(n: number): string {
  if (n < KB) return `${n} B`;
  if (n < MB) return `${(n / KB).toFixed(0)} KB`;
  return `${(n / MB).toFixed(1)} MB`;
}

/** Office data-entry (ADR-0037, MIS slice 3b) — a per-CASE section (Zion `NewDataQC` keys the MIS
 *  fields once per case, not per task). COLLAPSED by default (Zion's click-to-expand) so a layout with
 *  many fields never bloats the page; the form lazy-loads only on expand. Gated `data_entry.manage`. */
function DataEntrySection({ caseId }: { caseId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Data Entry</h2>
        <button className="btn-ghost" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {open ? 'Hide' : 'Show details'}
        </button>
      </div>
      {open && (
        <div className="mt-3">
          <DataEntryBody caseId={caseId} />
        </div>
      )}
    </div>
  );
}

/** Lazy body — fetched only once the section is expanded. */
function DataEntryBody({ caseId }: { caseId: string }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['data-entry', caseId],
    queryFn: () => api<CaseDataEntry>('GET', `/api/v2/data-entry/cases/${caseId}`),
  });

  if (isLoading) return <HexagonLoader operation="Loading Data Entry" />;
  if (isError || !data)
    return <p className="text-sm text-destructive">Could not load the data-entry form.</p>;
  if (!data.layout)
    return (
      <p className="text-sm text-muted-foreground">
        No data-entry layout is configured for this case&rsquo;s client &amp; product.
      </p>
    );
  // Remount per case/version so the form state initialises from the freshly-loaded values.
  return <DataEntryFields key={`${caseId}:${data.entry?.version ?? 0}`} caseId={caseId} entry={data} />;
}

function DataEntryFields({ caseId, entry }: { caseId: string; entry: CaseDataEntry }) {
  const qc = useQueryClient();
  // layout is non-null here (the parent renders the empty state otherwise); columns arrive ordered.
  const columns = entry.layout!.columns;
  const stored = entry.entry?.data ?? {};
  const version = entry.entry?.version;

  const [text, setText] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const c of columns)
      if (c.dataType !== 'BOOLEAN')
        init[c.columnKey] = stored[c.columnKey] == null ? '' : String(stored[c.columnKey]);
    return init;
  });
  const [bools, setBools] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    for (const c of columns) if (c.dataType === 'BOOLEAN') init[c.columnKey] = stored[c.columnKey] === true;
    return init;
  });
  const [error, setError] = useState<string | null>(null);

  const isEmpty = (c: ReportLayoutColumn) =>
    c.dataType !== 'BOOLEAN' && (text[c.columnKey] ?? '').trim() === '';
  const missing = columns.filter((c) => c.isRequired && isEmpty(c));
  const valid = missing.length === 0;

  const buildData = (): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const c of columns) {
      if (c.dataType === 'BOOLEAN') {
        out[c.columnKey] = bools[c.columnKey] ?? false;
        continue;
      }
      const v = (text[c.columnKey] ?? '').trim();
      if (v === '') continue; // omit blanks — only keyed values are stored
      out[c.columnKey] = c.dataType === 'NUMBER' ? Number(v) : v;
    }
    return out;
  };

  const save = useMutation({
    mutationFn: () =>
      api<CaseDataEntry>('PUT', `/api/v2/data-entry/cases/${caseId}`, { data: buildData(), version }),
    onSuccess: () => {
      toast('Data entry saved');
      void qc.invalidateQueries({ queryKey: ['data-entry', caseId] });
    },
    onError: (e) => {
      setError(
        e instanceof ApiError && e.code === 'STALE_UPDATE'
          ? 'This data entry was updated elsewhere — reload to get the latest.'
          : 'Save failed. Please try again.',
      );
    },
  });

  // Sections preserve first-appearance order; null-section columns render under no heading.
  const sections = [...new Set(columns.map((c) => c.section ?? ''))];

  return (
    <div className="flex flex-col gap-4">
      {sections.map((section) => (
        <div key={section || '_'} className="flex flex-col gap-2">
          {section && (
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {section}
            </div>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {columns
              .filter((c) => (c.section ?? '') === section)
              .map((c) => (
                <DataEntryField
                  key={c.columnKey}
                  column={c}
                  textValue={text[c.columnKey] ?? ''}
                  boolValue={bools[c.columnKey] ?? false}
                  onText={(v) => setText((s) => ({ ...s, [c.columnKey]: v }))}
                  onBool={(v) => setBools((s) => ({ ...s, [c.columnKey]: v }))}
                />
              ))}
          </div>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-3">
        <button
          className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"
          onClick={() => valid && save.mutate()}
          disabled={save.isPending || !valid}
        >
          {save.isPending ? 'Saving…' : 'Save data entry'}
        </button>
        {!valid && (
          <span className="text-xs text-destructive">
            Required: {missing.map((c) => c.headerLabel).join(', ')}
          </span>
        )}
        {error && <span className="text-xs text-destructive">{error}</span>}
      </div>
    </div>
  );
}

/** One column's input, rendered by its data type (TEXT/NUMBER/DATE/SELECT/BOOLEAN). */
function DataEntryField({
  column,
  textValue,
  boolValue,
  onText,
  onBool,
}: {
  column: ReportLayoutColumn;
  textValue: string;
  boolValue: boolean;
  onText: (v: string) => void;
  onBool: (v: boolean) => void;
}) {
  const label = column.isRequired ? `${column.headerLabel} *` : column.headerLabel;
  const inputClass = 'h-9 w-full rounded-md border border-border bg-background px-2 text-sm';

  if (column.dataType === 'BOOLEAN') {
    return (
      <label className="flex items-center gap-2 pt-6 text-sm">
        <input type="checkbox" checked={boolValue} onChange={(e) => onBool(e.target.checked)} />
        <span>{label}</span>
      </label>
    );
  }
  if (column.dataType === 'SELECT') {
    return (
      <Field label={label}>
        <select className={inputClass} value={textValue} onChange={(e) => onText(e.target.value)}>
          <option value="">Select…</option>
          {column.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </Field>
    );
  }
  return (
    <Field label={label}>
      <input
        className={inputClass}
        type={column.dataType === 'NUMBER' ? 'number' : column.dataType === 'DATE' ? 'date' : 'text'}
        value={textValue}
        onChange={(e) => onText(e.target.value)}
      />
    </Field>
  );
}

/** Pickup Information (ADR-0037) — Zion `NewDataQC`'s FIXED per-case office box. Collapsible like the
 *  Data Entry section; lazy-loads on expand. Gated `data_entry.manage`. */
function PickupSection({ caseId }: { caseId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Pickup Information
        </h2>
        <button className="btn-ghost" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {open ? 'Hide' : 'Show details'}
        </button>
      </div>
      {open && (
        <div className="mt-3">
          <PickupBody caseId={caseId} />
        </div>
      )}
    </div>
  );
}

function PickupBody({ caseId }: { caseId: string }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['pickup', caseId],
    queryFn: () => api<CasePickup>('GET', `/api/v2/data-entry/cases/${caseId}/pickup`),
  });
  if (isLoading) return <HexagonLoader operation="Loading Pickup" />;
  if (isError || !data) return <p className="text-sm text-destructive">Could not load the pickup form.</p>;
  return <PickupForm key={`${caseId}:${data.pickup?.version ?? 0}`} caseId={caseId} data={data} />;
}

/** An ISO instant → a `datetime-local` input value (local time, minute precision); '' when null. */
function isoToLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
/** A `datetime-local` value → an ISO instant (or null when blank). */
const localInputToIso = (v: string): string | null => (v ? new Date(v).toISOString() : null);

function PickupForm({ caseId, data }: { caseId: string; data: CasePickup }) {
  const qc = useQueryClient();
  const p = data.pickup;
  const [pickupDate, setPickupDate] = useState(isoToLocalInput(p?.pickupDate ?? null));
  const [reportedDate, setReportedDate] = useState(isoToLocalInput(p?.reportedDate ?? null));
  const [pickupTrigger, setPickupTrigger] = useState(p?.pickupTrigger ?? '');
  const [samplerName, setSamplerName] = useState(p?.samplerName ?? '');
  const [visitDateTime, setVisitDateTime] = useState(isoToLocalInput(p?.visitDateTime ?? null));
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => {
      const body: SavePickupInput = {
        pickupDate: localInputToIso(pickupDate),
        reportedDate: localInputToIso(reportedDate),
        pickupTrigger: pickupTrigger.trim() || null,
        samplerName: samplerName.trim() || null,
        visitDateTime: localInputToIso(visitDateTime),
        version: p?.version,
      };
      return api<CasePickup>('PUT', `/api/v2/data-entry/cases/${caseId}/pickup`, body);
    },
    onSuccess: () => {
      toast('Pickup saved');
      void qc.invalidateQueries({ queryKey: ['pickup', caseId] });
    },
    onError: (e) => {
      setError(
        e instanceof ApiError && e.code === 'STALE_UPDATE'
          ? 'Pickup was updated elsewhere — reload to get the latest.'
          : 'Save failed. Please try again.',
      );
    },
  });

  const inputClass = 'h-9 w-full rounded-md border border-border bg-background px-2 text-sm';
  return (
    <div className="flex flex-col gap-4">
      {/* Derived, read-only (Zion shows these greyed). */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Meta label="Pickup For Documents / Profile" value={data.pickupForDocuments || '—'} />
        <Meta label="Bank / NBFC Name" value={data.bankName || '—'} />
        <Meta
          label="Time Of Verification (Days)"
          value={data.timeOfVerificationDays == null ? '—' : String(data.timeOfVerificationDays)}
        />
      </div>
      {/* Keyed fields. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Pick Up Date">
          <input
            className={inputClass}
            type="datetime-local"
            value={pickupDate}
            onChange={(e) => setPickupDate(e.target.value)}
          />
        </Field>
        <Field label="Reported Date">
          <input
            className={inputClass}
            type="datetime-local"
            value={reportedDate}
            onChange={(e) => setReportedDate(e.target.value)}
          />
        </Field>
        <Field label="Visit Date & Time">
          <input
            className={inputClass}
            type="datetime-local"
            value={visitDateTime}
            onChange={(e) => setVisitDateTime(e.target.value)}
          />
        </Field>
        <Field label="Pickup Trigger">
          <input
            className={inputClass}
            value={pickupTrigger}
            onChange={(e) => setPickupTrigger(e.target.value)}
          />
        </Field>
        <Field label="Sampler Name">
          <input
            className={inputClass}
            value={samplerName}
            onChange={(e) => setSamplerName(e.target.value)}
          />
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button
          className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"
          onClick={() => save.mutate()}
          disabled={save.isPending}
        >
          {save.isPending ? 'Saving…' : 'Save pickup'}
        </button>
        {error && <span className="text-xs text-destructive">{error}</span>}
      </div>
    </div>
  );
}

/** #6 Field Report (ADR-0039 R1) — the combined per-task view (v1 OptimizedFormSubmissionViewer parity):
 *  the agent's RAW submitted fields PLUS the auto-generated narrative. One expandable row per task; the
 *  report (fields + narrative) lazy-loads on expand. Photos live in the Field Photos card (#7). */
function MobileReportSection({ caseId, tasks }: { caseId: string; tasks: CaseTaskView[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Field Report</h2>
        <button className="btn-ghost" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {open ? 'Hide' : 'Show details'}
        </button>
      </div>
      {open &&
        (tasks.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">No tasks on this case.</p>
        ) : (
          <div className="mt-3 space-y-2">
            {tasks.map((t) => (
              <TaskFieldReport key={t.id} caseId={caseId} task={t} />
            ))}
          </div>
        ))}
    </div>
  );
}

/** One task's field report — header row (task · unit · applicant) expands to lazy-load its fields +
 *  narrative from GET /cases/:id/tasks/:taskId/field-report. */
function TaskFieldReport({ caseId, task }: { caseId: string; task: CaseTaskView }) {
  const [open, setOpen] = useState(false);
  const { data, isLoading, isError } = useQuery({
    queryKey: ['field-report', caseId, task.id],
    queryFn: () => api<FieldReportView>('GET', `/api/v2/cases/${caseId}/tasks/${task.id}/field-report`),
    enabled: open,
  });
  return (
    <div className="rounded-md border border-border">
      <button
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="truncate">
          <span className="font-medium text-foreground">{task.taskNumber}</span>
          <span className="text-muted-foreground">
            {' '}
            · {task.unitName} · {task.applicantName}
          </span>
        </span>
        <span className="text-muted-foreground">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="border-t border-border px-3 py-3">
          {isLoading ? (
            <HexagonLoader operation="Loading Report" />
          ) : isError || !data ? (
            <p className="text-sm text-destructive">Could not load the field report.</p>
          ) : (
            <FieldReportBody report={data} />
          )}
        </div>
      )}
    </div>
  );
}

/** Renders the combined body: raw submitted fields (sectioned) then the generated narrative. */
function FieldReportBody({ report }: { report: FieldReportView }) {
  const hasFields = report.sections.length > 0;
  return (
    <div className="space-y-4">
      {!hasFields && report.narrative === null ? (
        <p className="text-sm text-muted-foreground">No field submission yet for this task.</p>
      ) : (
        <>
          {report.sections.map((section) => (
            <div key={section.title}>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {section.title}
              </h3>
              <div className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                {section.fields.map((f) => (
                  <Meta key={f.label} label={f.label} value={f.value} />
                ))}
              </div>
            </div>
          ))}
          <div>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Generated Report{report.layoutName ? ` · ${report.layoutName}` : ''}
            </h3>
            {report.narrative !== null ? (
              <p className="whitespace-pre-wrap text-sm text-foreground">{report.narrative}</p>
            ) : (
              <p className="text-sm text-muted-foreground">
                No report template configured for {report.verificationType}.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/** #7 Field Photos — the device's submitted photos (ADR-0034). Collapsed by default; lazy-loads. */
function FieldPhotosSection({ caseId }: { caseId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Field Photos</h2>
        <button className="btn-ghost" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {open ? 'Hide' : 'Show details'}
        </button>
      </div>
      {open && (
        <div className="mt-3">
          <FieldPhotosBody caseId={caseId} />
        </div>
      )}
    </div>
  );
}

function FieldPhotosBody({ caseId }: { caseId: string }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['field-photos', caseId],
    queryFn: () => api<CaseFieldPhoto[]>('GET', `/api/v2/cases/${caseId}/field-photos`),
  });
  if (isLoading) return <HexagonLoader operation="Loading Photos" />;
  if (isError || !data) return <p className="text-sm text-destructive">Could not load field photos.</p>;
  if (data.length === 0) return <p className="text-sm text-muted-foreground">No field photos uploaded.</p>;
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {data.map((p) => (
        <FieldPhotoThumb key={p.id} caseId={caseId} photo={p} />
      ))}
    </div>
  );
}

function FieldPhotoThumb({ caseId, photo }: { caseId: string; photo: CaseFieldPhoto }) {
  // The image is served via the existing presigned attachment-url route (works for any kind).
  const { data } = useQuery({
    queryKey: ['field-photo-url', caseId, photo.id],
    queryFn: () => api<{ url: string }>('GET', `/api/v2/cases/${caseId}/attachments/${photo.id}/url`),
  });
  const lat = photo.geoLocation?.latitude;
  const lng = photo.geoLocation?.longitude;
  const hasCoords = typeof lat === 'number' && typeof lng === 'number';
  // On-view fallback (ADR-0040): if the address was never resolved server-side, resolve+freeze it now.
  const { data: addr } = useQuery({
    queryKey: ['field-photo-address', caseId, photo.id],
    queryFn: () =>
      api<{ address: string | null; cached: boolean }>(
        'GET',
        `/api/v2/cases/${caseId}/field-photos/${photo.id}/address`,
      ),
    enabled: !photo.reverseGeocodedAddress && hasCoords,
    staleTime: Infinity,
  });
  const address = photo.reverseGeocodedAddress ?? addr?.address ?? null;
  const accuracy = photo.geoLocation?.accuracy;
  const captureTime = photo.geoLocation?.timestamp;
  const mapsHref = hasCoords ? `https://www.google.com/maps?q=${lat},${lng}` : undefined;
  return (
    <div className="overflow-hidden rounded-md border border-border">
      <a href={data?.url} target="_blank" rel="noreferrer" className="block">
        {data?.url ? (
          <img
            src={data.url}
            alt={photo.photoType ?? photo.originalName}
            className="h-32 w-full object-cover"
          />
        ) : (
          <div className="flex h-32 items-center justify-center bg-surface-muted">
            <HexagonLoader operation="Loading" />
          </div>
        )}
      </a>
      <div className="flex flex-col gap-0.5 px-2 py-1 text-xs">
        <div className="truncate font-medium text-foreground">{photo.photoType ?? '—'}</div>
        {photo.unitName ? <div className="truncate text-muted-foreground">{photo.unitName}</div> : null}
        {address ? (
          <div className="line-clamp-2 text-muted-foreground" title={address}>
            📍 {address}
          </div>
        ) : null}
        {hasCoords ? (
          <a
            href={mapsHref}
            target="_blank"
            rel="noreferrer"
            aria-label="Open photo location in Google Maps"
            className="truncate text-primary hover:underline"
          >
            {lat!.toFixed(6)}, {lng!.toFixed(6)}
            {typeof accuracy === 'number' ? ` (±${Math.round(accuracy)}m)` : ''}
          </a>
        ) : null}
        {captureTime ? (
          <div className="truncate text-muted-foreground">{new Date(captureTime).toLocaleString()}</div>
        ) : null}
      </div>
    </div>
  );
}

/** #9 Client Report download (ADR-0037 follow-up) — config-driven CASE_REPORT generation to
 *  PDF/Word/Excel. The engine is a dedicated next slice; the controls are placeholders until then. */
function CaseReportSection({ caseId }: { caseId: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();

  // Slice 2a: fetch the rendered HTML (auth-bearing) and open it in a new tab via a blob URL — a
  // plain link can't carry the Authorization header.
  const preview = async () => {
    setBusy(true);
    try {
      const { blob } = await apiBlob(`/api/v2/cases/${caseId}/report.html`);
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener');
      // Revoke after the new tab has had time to load the document.
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      toast.error('Could not generate the report preview');
    } finally {
      setBusy(false);
    }
  };

  // Slice 2b/4: report generation is a background job (PDF via Puppeteer / Word via docx, on the
  // worker tier). Enqueue → the job tray shows progress → download the finished file from the tray.
  const generate = useMutation({
    mutationFn: (format: CaseReportFormat) =>
      api<JobView>('POST', `/api/v2/cases/${caseId}/report?format=${format}`),
    onSuccess: (_d, format) => {
      void qc.invalidateQueries({ queryKey: JOBS_KEY });
      toast.success(
        `Generating ${format.toUpperCase()} — it will appear in the background-jobs tray when ready`,
      );
    },
    onError: () => toast.error('Could not start the report'),
  });

  return (
    <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Client Report</h2>
        <button className="btn-ghost" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {open ? 'Hide' : 'Show details'}
        </button>
      </div>
      {open && (
        <div className="mt-3 flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            The client report aggregates the per-task verification narratives, photos with location, and case
            result. Preview opens the rendered report; PDF, Word, and Excel generate in the background and
            appear in the jobs tray when ready.
          </p>
          <div className="flex flex-wrap gap-2">
            <button className="btn-ghost" onClick={preview} disabled={busy}>
              {busy ? 'Generating…' : 'Preview (HTML)'}
            </button>
            <button className="btn" onClick={() => generate.mutate('pdf')} disabled={generate.isPending}>
              {generate.isPending ? 'Starting…' : 'PDF'}
            </button>
            <button
              className="btn-ghost"
              onClick={() => generate.mutate('docx')}
              disabled={generate.isPending}
            >
              Word
            </button>
            <button
              className="btn-ghost"
              onClick={() => generate.mutate('xlsx')}
              disabled={generate.isPending}
            >
              Excel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div>{value}</div>
    </div>
  );
}
