import { useCallback, useEffect, useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  VISIT_TYPES,
  VISIT_TYPE_LABELS,
  type AvailableUnit,
  type RatePreview,
  type AssignableUser,
  type CaseApplicant,
  type CaseTaskView,
  type Location,
  type Paginated,
  type TatPolicyOption,
  type VisitType,
} from '@crm2/sdk';
import { api, apiUpload } from '../../lib/sdk.js';
import { Input } from '../../components/ui/Input.js';
import { Button, buttonClass } from '../../components/ui/Button.js';

interface TaskRow {
  /** Stable client-side id (keys the row + its assign-readiness, survives add/remove reordering). */
  id: string;
  verificationUnitId: string;
  applicantId: string;
  address: string;
  trigger: string;
  /** Target TAT in hours (ADR-0044) — the office SLA promise; replaces the old abstract priority. */
  tatHours: number;
  // ADR-0024 assign-at-create (only when canAssign): the pool, the FIELD location, and the executive.
  // ADR-0056: the field rate type is NOT collected here — the server derives it from the chosen
  // executive's commission at the location (and blocks a FIELD assign with no commission there).
  visitType: VisitType | '';
  pincodeQuery: string;
  /** A `locations` (pincode, area) row id — the FIELD task's verification location (= area = pincode). */
  locationId: string;
  assigneeId: string;
  /** Optional per-task reference document (ADR-0025 B2) — uploaded to the new task after it's created. */
  file: File | null;
}
const emptyTask = (): TaskRow => ({
  id: crypto.randomUUID(),
  verificationUnitId: '',
  applicantId: '',
  address: '',
  trigger: '',
  tatHours: 24, // default 24h (= the old MEDIUM default)
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
  // ADR-0044: the configurable target-TAT bands (4/6/8/12/24/48h) for the per-task TAT picker.
  const { data: tatBands } = useQuery({
    queryKey: ['tat-policies', 'options'],
    queryFn: () => api<TatPolicyOption[]>('GET', '/api/v2/tat-policies/options'),
  });
  const [rows, setRows] = useState<TaskRow[]>([emptyTask()]);
  const [attachError, setAttachError] = useState(false);
  // ADR-0056: a row is "assign-blocked" when its chosen FIELD executive has no commission at the location
  // (the server would 400 NO_FIELD_COMMISSION). Each TaskRowEditor reports it up by row id so we can
  // disable Add and avoid a surprise round-trip — the inline message tells the operator what to fix.
  const [blockedIds, setBlockedIds] = useState<Record<string, boolean>>({});
  // Stable so each TaskRowEditor's report effect fires only when its own blocked state changes.
  const reportBlocked = useCallback(
    (id: string, blocked: boolean) =>
      setBlockedIds((prev) => (prev[id] === blocked ? prev : { ...prev, [id]: blocked })),
    [],
  );
  const setRow = (i: number, patch: Partial<TaskRow>) =>
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  // ADR-0056: "Assign later" (a bare PENDING task with no visit type / no location) is removed for
  // assigners — it produced tasks that could never be dispatched. A visit type is now required, and a
  // FIELD task must carry its dispatch address + location so it is assignable. The EXECUTIVE may still be
  // left for later (a located PENDING task is assignable from the case page). Create-only roles (no
  // case.assign) keep the lean unit+applicant rule — their tasks get visit type/location at the assign.
  const valid = rows.filter((r) => {
    if (!r.verificationUnitId || !r.applicantId) return false;
    if (!canAssign) return true;
    if (!r.visitType) return false;
    if (r.visitType === 'FIELD') return !!r.address.trim() && !!r.locationId;
    return true; // OFFICE: no visit location
  });
  const hasBlocked = valid.some((r) => blockedIds[r.id]);

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
            tatHours: r.tatHours, // ADR-0044 target TAT; priority defaults MEDIUM server-side (vestigial)
            ...(assigning ? { visitType: r.visitType as VisitType } : {}),
            // A FIELD task carries its location (= area = pincode row); OFFICE has none.
            ...(assigning && r.visitType === 'FIELD' && locationId
              ? { pincodeId: locationId, areaId: locationId }
              : {}),
            // ADR-0056: no fieldRateType — the server derives it from the assignee's commission.
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
          key={r.id}
          index={i}
          caseId={caseId}
          clientId={clientId}
          productId={productId}
          row={r}
          units={units ?? []}
          tatBands={tatBands ?? []}
          applicants={applicants}
          canAssign={canAssign}
          onChange={(patch) => setRow(i, patch)}
          onBlockedChange={reportBlocked}
          {...(rows.length > 1
            ? {
                onRemove: () => {
                  setRows((rs) => rs.filter((_, idx) => idx !== i));
                  setBlockedIds(({ [r.id]: _drop, ...rest }) => rest);
                },
              }
            : {})}
        />
      ))}
      <Button variant="secondary" size="sm" onClick={() => setRows((rs) => [...rs, emptyTask()])}>
        + Add another task
      </Button>
      {units && units.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No verification units enabled for this client + product — map them in{' '}
          <span className="font-medium">Admin → CPV Mapping</span>.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          disabled={valid.length === 0 || hasBlocked}
          loading={add.isPending}
          onClick={() => add.mutate()}
        >
          {`${submitLabel ?? 'Add'} ${valid.length} Task${valid.length === 1 ? '' : 's'}`}
        </Button>
        {onCancel && (
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
        {hasBlocked && (
          <span className="text-sm text-destructive">
            Resolve the missing commission on the highlighted task(s) before adding.
          </span>
        )}
        {add.isError && <span className="text-sm text-destructive">Failed to add tasks.</span>}
        {attachError && (
          <span className="text-sm text-warning">Tasks added, but some attachments failed to upload.</span>
        )}
      </div>
    </div>
  );
}

function TaskRowEditor({
  index,
  caseId,
  clientId,
  productId,
  row,
  units,
  tatBands,
  applicants,
  canAssign,
  onChange,
  onBlockedChange,
  onRemove,
}: {
  index: number;
  caseId: string;
  clientId: number;
  productId: number;
  row: TaskRow;
  units: AvailableUnit[];
  tatBands: TatPolicyOption[];
  applicants: Pick<CaseApplicant, 'id' | 'name' | 'applicantType'>[];
  canAssign: boolean;
  onChange: (patch: Partial<TaskRow>) => void;
  onBlockedChange: (id: string, blocked: boolean) => void;
  onRemove?: () => void;
}) {
  const isField = row.visitType === 'FIELD';
  // OFFICE/desk (incl. KYC document) tasks have no visit address and no LOCAL/OGL field rate type.
  const isOffice = row.visitType === 'OFFICE';
  // Dispatch fields (address/trigger/attachment) are shown ONLY once the visit type is chosen — they
  // depend on HOW the task is verified. A create-only role (no visit-type picker) keeps them visible.
  const showDispatch = !canAssign || !!row.visitType;

  // ADR-0056 rate-type preview: shown AFTER the executive is chosen. CLIENT = the location bill label
  // (Rate Management); FIELD = the chosen executive's derived trip band (Commission) — scoped by assigneeId.
  const { data: ratePreview } = useQuery({
    queryKey: ['rate-preview', clientId, productId, row.verificationUnitId, row.locationId, row.assigneeId],
    queryFn: () =>
      api<RatePreview>(
        'GET',
        `/api/v2/cases/rate-preview?clientId=${clientId}&productId=${productId}&verificationUnitId=${row.verificationUnitId}&locationId=${row.locationId}&assigneeId=${row.assigneeId}`,
      ),
    enabled: !!row.verificationUnitId && !!row.locationId && !!row.assigneeId,
  });

  // ADR-0056: a FIELD row whose chosen executive has no commission at the location is server-blocked
  // (the preview returns no field band). Report it up so the parent disables Add — no surprise 400.
  const assignBlocked =
    canAssign && isField && !!row.assigneeId && !!ratePreview && ratePreview.fieldRateTypes.length === 0;
  useEffect(() => onBlockedChange(row.id, assignBlocked), [row.id, assignBlocked, onBlockedChange]);

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
          <Button variant="destructive" size="sm" onClick={onRemove}>
            Remove
          </Button>
        )}
      </div>

      {/* One uniform grid: every field is a quarter-width column on large screens, so the box keeps a
          clean rectangular shape no matter which conditional fields are visible. Wide/long inputs and
          the attachment span more columns. */}
      <div className="grid grid-cols-1 gap-x-4 gap-y-3 p-3 sm:grid-cols-2 lg:grid-cols-4">
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
        {/* ADR-0044: target TAT (the office's SLA promise) — a configurable band, replaces the old
            abstract LOW/MEDIUM/HIGH/URGENT priority. The backend derives due_at = assigned_at + tat. */}
        <FieldLabel label="Target TAT">
          <select
            className="input"
            value={String(row.tatHours)}
            onChange={(e) => onChange({ tatHours: Number(e.target.value) })}
          >
            {tatBands.map((tp) => (
              <option key={tp.id} value={String(tp.tatHours)}>
                {tp.label}
              </option>
            ))}
          </select>
        </FieldLabel>
        {canAssign ? (
          <FieldLabel label="Visit type">
            <select
              className="input"
              value={row.visitType}
              onChange={(e) => {
                // changing the pool clears the dependent location + assignee + field-rate-type picks;
                // OFFICE also clears the address (office/desk tasks have no visit address).
                const nv = e.target.value as VisitType | '';
                onChange({
                  visitType: nv,
                  pincodeQuery: '',
                  locationId: '',
                  assigneeId: '',
                  ...(nv === 'OFFICE' ? { address: '' } : {}),
                });
              }}
            >
              <option value="">Select visit type…</option>
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

        {/* Dispatch fields appear only once a visit type is chosen (showDispatch) — they depend on HOW
            the task is verified. Address is a FIELD-only visit location (OFFICE/desk has none). */}
        {showDispatch && !isOffice && (
          <FieldLabel label="Address" className="sm:col-span-2">
            <Input
              className="input"
              value={row.address}
              onChange={(e) => onChange({ address: e.target.value })}
              placeholder="Where the agent verifies"
            />
          </FieldLabel>
        )}
        {showDispatch && (
          <FieldLabel label="Trigger (instruction)" className="sm:col-span-2">
            <Input
              className="input"
              value={row.trigger}
              onChange={(e) => onChange({ trigger: e.target.value })}
              placeholder="Bank instruction shown to the field agent"
            />
          </FieldLabel>
        )}

        {/* ADR-0024 assignment — FIELD reveals pincode → area; both pools show the eligible executive. */}
        {canAssign && isField && (
          <>
            <FieldLabel label="Pincode">
              <Input
                uppercase={false}
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
            {!row.locationId && (
              <p className="text-xs text-muted-foreground sm:col-span-2 lg:col-span-4">
                A field task needs a pincode + area to be dispatched — set them above (the executive can be
                left for later).
              </p>
            )}
          </>
        )}
        {/* ADR-0024/0056: pick the executive FIRST — the field rate type then derives from THIS executive. */}
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
                      : 'Select — or leave to assign later'}
              </option>
              {pool?.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </FieldLabel>
        )}
        {/* No executive covers this territory → name where to fix it (FIELD pool = territory-scoped). */}
        {canAssign && isField && poolReady && !poolLoading && (pool?.length ?? 0) === 0 && (
          <p className="text-xs text-destructive sm:col-span-2 lg:col-span-4">
            No field executive covers this pincode/area — assign one this territory in{' '}
            <span className="font-medium">Admin → User Management</span> (or leave it Assign-later).
          </p>
        )}
        {/* ADR-0056 rate-type preview — shown AFTER the executive is chosen. CLIENT = the location bill
            label (Rate Management); FIELD = the chosen executive's derived trip band (Commission). The
            field rate type is NOT a manual pick. No band ⇒ this executive has no commission here and the
            FIELD assignment is blocked server-side. */}
        {ratePreview && (
          <div className="rounded-md border border-border bg-surface-muted px-3 py-2 text-xs sm:col-span-2 lg:col-span-4">
            <span className="font-medium text-foreground">Rate types at this location:</span>{' '}
            <span className="text-muted-foreground">Client</span>{' '}
            <span className="font-mono uppercase">{ratePreview.clientRateType ?? '—'}</span>
            <span className="mx-2 text-muted-foreground">·</span>
            <span className="text-muted-foreground">Field</span>{' '}
            <span className="font-mono uppercase">
              {ratePreview.fieldRateTypes.length ? ratePreview.fieldRateTypes.join(' / ') : '—'}
            </span>
            {ratePreview.clientRateType === null && (
              <p className="mt-1 text-muted-foreground">
                No client rate at this location — set it in{' '}
                <span className="font-medium">Rate Management</span> (the bill resolves ₹0 until then).
              </p>
            )}
            {isField && ratePreview.fieldRateTypes.length === 0 && (
              <p className="mt-1 text-destructive">
                This executive has no commission here — add one in{' '}
                <span className="font-medium">Commission Rates</span> (for this client or Universal) with a
                rate type. Assignment is blocked until then.
              </p>
            )}
          </div>
        )}

        {/* Per-task reference document (ADR-0025 B2) — full-width; shown once a visit type is chosen. */}
        {showDispatch && (
          <FileField label="Attachment (optional)" file={row.file} onPick={(f) => onChange({ file: f })} />
        )}
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
        <label className={`${buttonClass('ghost')} cursor-pointer text-sm`}>
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
          <Button variant="destructive" size="sm" onClick={() => onPick(null)}>
            Remove
          </Button>
        )}
      </div>
    </div>
  );
}
