import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  PRIORITIES,
  VISIT_TYPES,
  VISIT_TYPE_LABELS,
  type AvailableUnit,
  type AssignableUser,
  type CaseApplicant,
  type CaseTaskView,
  type Location,
  type Paginated,
  type Priority,
  type VisitType,
} from '@crm2/sdk';
import { api, apiUpload } from '../../lib/sdk.js';

interface TaskRow {
  verificationUnitId: string;
  applicantId: string;
  address: string;
  trigger: string;
  priority: Priority;
  // ADR-0024 assign-at-create (only when canAssign): the pool, the FIELD location, and the executive.
  visitType: VisitType | '';
  pincodeQuery: string;
  /** A `locations` (pincode, area) row id — the FIELD task's verification location (= area = pincode). */
  locationId: string;
  assigneeId: string;
  /** Optional per-task reference document (ADR-0025 B2) — uploaded to the new task after it's created. */
  file: File | null;
}
const emptyTask = (): TaskRow => ({
  verificationUnitId: '',
  applicantId: '',
  address: '',
  trigger: '',
  priority: 'MEDIUM',
  visitType: '',
  pincodeQuery: '',
  locationId: '',
  assigneeId: '',
  file: null,
});

const LOCATION_LIMIT = 50;
const ATTACH_ACCEPT = '.pdf,image/*';

/**
 * Per-task builder (ADR-0023/0024) reused by case creation AND the case detail page. POSTs
 * `{tasks:[…]}` to `/cases/:id/tasks`, then uploads any per-task reference document (ADR-0025 B2) to
 * the new task ids. Each task picks a CPV unit + applicant + dispatch address/trigger/priority; when
 * the operator may assign (case.assign), it also picks a visit type (Field/Office) and — for Field —
 * the pincode→area, which filters the eligible executive pool, then optionally an executive and a doc.
 */
export function AddTasksForm({
  caseId,
  clientId,
  productId,
  applicants,
  canAssign = false,
  submitLabel,
  onAdded,
  onCancel,
}: {
  caseId: string;
  clientId: number;
  productId: number;
  applicants: Pick<CaseApplicant, 'id' | 'name' | 'applicantType'>[];
  canAssign?: boolean;
  submitLabel?: string;
  onAdded: () => void;
  onCancel?: () => void;
}) {
  const { data: units } = useQuery({
    queryKey: ['available-units', clientId, productId],
    queryFn: () =>
      api<AvailableUnit[]>(
        'GET',
        `/api/v2/cases/available-units?clientId=${clientId}&productId=${productId}`,
      ),
  });
  const [rows, setRows] = useState<TaskRow[]>([emptyTask()]);
  const [attachError, setAttachError] = useState(false);
  const setRow = (i: number, patch: Partial<TaskRow>) =>
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const valid = rows.filter((r) => r.verificationUnitId && r.applicantId && r.address.trim());

  const add = useMutation({
    mutationFn: async () => {
      setAttachError(false);
      const created = await api<CaseTaskView[]>('POST', `/api/v2/cases/${caseId}/tasks`, {
        tasks: valid.map((r) => {
          const assigning = canAssign && !!r.visitType;
          const locationId = r.locationId ? Number(r.locationId) : undefined;
          return {
            verificationUnitId: Number(r.verificationUnitId),
            applicantId: r.applicantId,
            address: r.address.trim(),
            trigger: r.trigger.trim(),
            priority: r.priority,
            ...(assigning ? { visitType: r.visitType as VisitType } : {}),
            // A FIELD task carries its location (= area = pincode row); OFFICE has none.
            ...(assigning && r.visitType === 'FIELD' && locationId
              ? { pincodeId: locationId, areaId: locationId }
              : {}),
            ...(assigning && r.assigneeId ? { assigneeId: r.assigneeId } : {}),
          };
        }),
      });
      // The newly-created tasks are the last `valid.length` rows (one batch shares created_at, ordered
      // by the task-number seq = the submit order) → map each row's optional file to its new task.
      const newTasks = created.slice(-valid.length);
      const uploads = valid
        .map((r, i) =>
          r.file && newTasks[i]
            ? apiUpload(`/api/v2/cases/${caseId}/attachments?taskId=${newTasks[i]!.id}`, r.file, r.file.name)
            : null,
        )
        .filter((p): p is Promise<unknown> => p !== null);
      if (uploads.length > 0) {
        const results = await Promise.allSettled(uploads);
        if (results.some((x) => x.status === 'rejected')) setAttachError(true);
      }
      return created;
    },
    onSuccess: () => {
      setRows([emptyTask()]);
      onAdded();
    },
  });

  return (
    <div className="space-y-3">
      {rows.map((r, i) => (
        <TaskRowEditor
          key={i}
          index={i}
          caseId={caseId}
          row={r}
          units={units ?? []}
          applicants={applicants}
          canAssign={canAssign}
          onChange={(patch) => setRow(i, patch)}
          {...(rows.length > 1 ? { onRemove: () => setRows((rs) => rs.filter((_, idx) => idx !== i)) } : {})}
        />
      ))}
      <button
        className="text-sm font-medium text-primary hover:underline"
        onClick={() => setRows((rs) => [...rs, emptyTask()])}
      >
        + Add another task
      </button>
      {units && units.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No verification units are enabled (CPV) for this client + product.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn" disabled={valid.length === 0 || add.isPending} onClick={() => add.mutate()}>
          {add.isPending
            ? 'Adding…'
            : `${submitLabel ?? 'Add'} ${valid.length} Task${valid.length === 1 ? '' : 's'}`}
        </button>
        {onCancel && (
          <button className="btn-ghost" onClick={onCancel}>
            Cancel
          </button>
        )}
        {add.isError && <span className="text-sm text-destructive">Failed to add tasks.</span>}
        {attachError && (
          <span className="text-sm text-amber-600">Tasks added, but some attachments failed to upload.</span>
        )}
      </div>
    </div>
  );
}

function TaskRowEditor({
  index,
  caseId,
  row,
  units,
  applicants,
  canAssign,
  onChange,
  onRemove,
}: {
  index: number;
  caseId: string;
  row: TaskRow;
  units: AvailableUnit[];
  applicants: Pick<CaseApplicant, 'id' | 'name' | 'applicantType'>[];
  canAssign: boolean;
  onChange: (patch: Partial<TaskRow>) => void;
  onRemove?: () => void;
}) {
  const isField = row.visitType === 'FIELD';

  // FIELD only: search the pincode → the area picker lists that pincode's (pincode, area) rows.
  const { data: areaMatches } = useQuery({
    queryKey: ['task-location', row.pincodeQuery],
    queryFn: () =>
      api<Paginated<Location>>(
        'GET',
        `/api/v2/locations?search=${encodeURIComponent(row.pincodeQuery)}&limit=${LOCATION_LIMIT}`,
      ),
    enabled: isField && row.pincodeQuery.trim().length >= 3,
  });
  const areas = areaMatches?.items ?? [];

  // The eligible executive pool for the chosen visit type (+ FIELD location). case.assign-gated.
  const poolReady = !!row.visitType && (row.visitType === 'OFFICE' || !!row.locationId);
  const { data: pool, isLoading: poolLoading } = useQuery({
    queryKey: ['eligible-assignees', caseId, row.visitType, row.locationId],
    queryFn: () => {
      const p = new URLSearchParams({ visitType: row.visitType });
      if (row.locationId) {
        p.set('areaId', row.locationId);
        p.set('pincodeId', row.locationId);
      }
      return api<AssignableUser[]>('GET', `/api/v2/cases/${caseId}/eligible-assignees?${p.toString()}`);
    },
    enabled: canAssign && poolReady,
  });

  return (
    <div className="rounded-lg border border-border bg-card shadow-sm">
      {/* Card header — task number + remove, on one continuous bar. */}
      <div className="flex items-center justify-between border-b border-border bg-surface-muted px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Task {index + 1}
        </span>
        {onRemove && (
          <button className="text-xs font-medium text-destructive hover:underline" onClick={onRemove}>
            Remove
          </button>
        )}
      </div>

      {/* One uniform grid: every field is a quarter-width column on large screens, so the box keeps a
          clean rectangular shape no matter which conditional fields are visible. Wide/long inputs and
          the attachment span more columns. */}
      <div className="grid grid-cols-1 gap-x-4 gap-y-3 p-3 sm:grid-cols-2 lg:grid-cols-4">
        <FieldLabel label="Verification Unit">
          <select
            className="input"
            value={row.verificationUnitId}
            onChange={(e) => onChange({ verificationUnitId: e.target.value })}
          >
            <option value="">Select unit…</option>
            {units.map((u) => (
              <option key={u.verificationUnitId} value={u.verificationUnitId}>
                {u.name}
              </option>
            ))}
          </select>
        </FieldLabel>
        <FieldLabel label="For Applicant">
          <select
            className="input"
            value={row.applicantId}
            onChange={(e) => onChange({ applicantId: e.target.value })}
          >
            <option value="">Select applicant…</option>
            {applicants.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({a.applicantType === 'APPLICANT' ? 'Applicant' : 'Co-applicant'})
              </option>
            ))}
          </select>
        </FieldLabel>
        <FieldLabel label="Priority">
          <select
            className="input"
            value={row.priority}
            onChange={(e) => onChange({ priority: e.target.value as Priority })}
          >
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </FieldLabel>
        {canAssign ? (
          <FieldLabel label="Visit type">
            <select
              className="input"
              value={row.visitType}
              onChange={(e) =>
                // changing the pool clears the dependent location + assignee picks
                onChange({
                  visitType: e.target.value as VisitType | '',
                  pincodeQuery: '',
                  locationId: '',
                  assigneeId: '',
                })
              }
            >
              <option value="">— Assign later —</option>
              {VISIT_TYPES.map((v) => (
                <option key={v} value={v}>
                  {VISIT_TYPE_LABELS[v]}
                </option>
              ))}
            </select>
          </FieldLabel>
        ) : (
          <span className="hidden lg:block" aria-hidden />
        )}

        {/* Address + Trigger are free text — give them more room (half-width each on large). */}
        <FieldLabel label="Address" className="sm:col-span-2">
          <input
            className="input"
            value={row.address}
            onChange={(e) => onChange({ address: e.target.value })}
            placeholder="Where the agent verifies"
          />
        </FieldLabel>
        <FieldLabel label="Trigger (instruction)" className="sm:col-span-2">
          <input
            className="input"
            value={row.trigger}
            onChange={(e) => onChange({ trigger: e.target.value })}
            placeholder="Bank instruction shown to the field agent"
          />
        </FieldLabel>

        {/* ADR-0024 assignment — FIELD reveals pincode → area; both pools show the eligible executive. */}
        {canAssign && isField && (
          <>
            <FieldLabel label="Pincode">
              <input
                className="input"
                value={row.pincodeQuery}
                onChange={(e) => onChange({ pincodeQuery: e.target.value, locationId: '', assigneeId: '' })}
                placeholder="Search pincode (min 3)…"
              />
            </FieldLabel>
            <FieldLabel label="Area">
              <select
                className="input"
                value={row.locationId}
                disabled={areas.length === 0}
                onChange={(e) => onChange({ locationId: e.target.value, assigneeId: '' })}
              >
                <option value="">
                  {row.pincodeQuery.trim().length < 3
                    ? 'Enter a pincode first…'
                    : areas.length === 0
                      ? 'No areas found'
                      : 'Select area…'}
                </option>
                {areas.map((l) => (
                  <option key={l.id} value={String(l.id)}>
                    {l.area} — {l.pincode}, {l.city}
                  </option>
                ))}
              </select>
            </FieldLabel>
          </>
        )}
        {canAssign && row.visitType && (
          <FieldLabel label={`Executive (${VISIT_TYPE_LABELS[row.visitType]})`}>
            <select
              className="input"
              value={row.assigneeId}
              disabled={!poolReady}
              onChange={(e) => onChange({ assigneeId: e.target.value })}
            >
              <option value="">
                {!poolReady
                  ? 'Pick a location first…'
                  : poolLoading
                    ? 'Loading…'
                    : (pool?.length ?? 0) === 0
                      ? 'No eligible executive'
                      : 'Assign later / select…'}
              </option>
              {pool?.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </FieldLabel>
        )}

        {/* Per-task reference document (ADR-0025 B2) — full-width, after the executive. */}
        <FileField label="Attachment (optional)" file={row.file} onPick={(f) => onChange({ file: f })} />
      </div>
    </div>
  );
}

function FieldLabel({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={`block ${className ?? ''}`}>
      <span className="mb-1 block text-xs font-medium text-foreground">{label}</span>
      {children}
    </label>
  );
}

/** A styled per-task file picker (ADR-0025 B2 office reference doc): hidden native input behind a
 *  button, with the chosen filename + a clear affordance. Full grid width. */
function FileField({
  label,
  file,
  onPick,
}: {
  label: string;
  file: File | null;
  onPick: (f: File | null) => void;
}) {
  return (
    <div className="col-span-full">
      <span className="mb-1 block text-xs font-medium text-foreground">{label}</span>
      <div className="flex flex-wrap items-center gap-3">
        <label className="btn-ghost cursor-pointer text-sm">
          {file ? 'Change file' : 'Choose file'}
          <input
            type="file"
            accept={ATTACH_ACCEPT}
            className="hidden"
            onChange={(e) => onPick(e.target.files?.[0] ?? null)}
          />
        </label>
        <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
          {file ? file.name : 'PDF or image, for the executive to reference (optional).'}
        </span>
        {file && (
          <button
            className="text-xs font-medium text-destructive hover:underline"
            onClick={() => onPick(null)}
          >
            Remove
          </button>
        )}
      </div>
    </div>
  );
}
