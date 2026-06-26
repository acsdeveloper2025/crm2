import { useEffect, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { VerificationUnit } from '@crm2/sdk';
import { CreateVerificationUnitSchema, UpdateVerificationUnitSchema } from '@crm2/sdk';
import { api, ApiError } from '../../lib/sdk.js';
import { useAuth } from '../../lib/AuthContext.js';
import { toDateInput, toIsoDate } from '../../lib/format.js';
import { zodFieldErrors } from '../../lib/zodForm.js';
import { ConflictDialog } from '../../components/ConflictDialog.js';
import { Button } from '../../components/ui/Button.js';
import { Input } from '../../components/ui/Input.js';
import { HexagonLoader } from '../../components/ui/HexagonLoader.js';

const BASE = '/api/v2/verification-units';
const LIST = '/admin/verification-units';
const QK = 'verification-units';
const HTTP_CONFLICT = 409;
const isStale = (e: unknown): e is ApiError =>
  e instanceof ApiError && e.status === HTTP_CONFLICT && e.code === 'STALE_UPDATE';

type WorkerRole = 'FIELD_AGENT' | 'KYC_VERIFIER';

/** worker_role → the locked invariant profile (ADR-0070 — so the UI cannot author an invalid unit). */
function profileFor(workerRole: WorkerRole) {
  return workerRole === 'FIELD_AGENT'
    ? {
        workerRole: 'FIELD_AGENT',
        assignmentMethod: 'TERRITORY_AUTO',
        requiredPhotos: 5,
        requiredGps: true,
        requiredAttachments: [],
        billingProfile: 'AGENT_COMMISSION',
        commissionProfile: 'FIELD_RATE',
        reportTemplateType: 'FIELD_NARRATIVE',
        reverificationRule: 'REVISIT_PARENT_RATE',
      }
    : {
        workerRole: 'KYC_VERIFIER',
        assignmentMethod: 'DESK_POOL',
        requiredPhotos: 0,
        requiredGps: false,
        requiredAttachments: [{ type: 'DOCUMENT', min: 1 }],
        requiredFormCode: null,
        billingProfile: 'CLIENT_INVOICE',
        commissionProfile: 'NONE',
        reportTemplateType: 'KYC_DOCUMENT',
        reverificationRule: 'RECHECK_FRESH_RATE',
      };
}

/**
 * Verification-unit create/edit as a full record-page route (ADR-0051 — no modal). `/admin/verification-units/new`
 * creates; `/admin/verification-units/:id` loads that unit by id and edits it (deep-linkable). RBAC:
 * `verification_unit.manage` only (the server enforces it on POST/PUT too); a viewer who deep-links here is
 * bounced back to the list.
 */
export function VerificationUnitRecordPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { has } = useAuth();
  const isEdit = !!id;
  const existing = useQuery({
    queryKey: [QK, id],
    queryFn: () => api<VerificationUnit>('GET', `${BASE}/${id}`),
    enabled: isEdit,
  });

  if (!has('verification_unit.manage')) return <Navigate to={LIST} replace />;
  if (isEdit && existing.isLoading) {
    return (
      <div className="py-10">
        <HexagonLoader operation="Loading verification unit" />
      </div>
    );
  }
  if (isEdit && (existing.isError || !existing.data)) {
    return (
      <div className="space-y-3">
        <Button variant="link" size="sm" onClick={() => navigate(LIST)}>
          ← Back to verification units
        </Button>
        <p className="text-sm text-muted-foreground">Couldn’t load this unit.</p>
      </div>
    );
  }
  // The 9 mobile-hardcoded FIELD_VISIT units are system-locked (their codes drive the mobile form
  // templates + field mapping). The list hides Edit + the server 409s an edit; block the deep-linked
  // record route too so the edit form never renders for one.
  if (isEdit && existing.data?.isSystem) {
    return (
      <div className="space-y-3">
        <Button variant="link" size="sm" onClick={() => navigate(LIST)}>
          ← Back to verification units
        </Button>
        <p className="text-sm text-muted-foreground">
          This is a system verification unit (linked to the mobile app) and can’t be edited.
        </p>
      </div>
    );
  }
  // Re-mount the form per record (key) so its state seeds cleanly from the loaded unit.
  return <UnitForm key={id ?? 'new'} initial={existing.data ?? null} />;
}

function UnitForm({ initial }: { initial: VerificationUnit | null }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const isEdit = !!initial;
  const [code, setCode] = useState(initial?.code ?? '');
  const [name, setName] = useState(initial?.name ?? '');
  const [category, setCategory] = useState(initial?.category ?? 'FIELD');
  const [workerRole, setWorkerRole] = useState<WorkerRole>(initial?.workerRole ?? 'FIELD_AGENT');
  const [requiredFormCode, setRequiredFormCode] = useState(initial?.requiredFormCode ?? '');
  const [piiSensitive, setPiiSensitive] = useState(initial?.piiSensitive ?? false);
  const [description, setDescription] = useState(initial?.description ?? '');
  const [effectiveFrom, setEffectiveFrom] = useState(toDateInput(initial?.effectiveFrom));
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [version, setVersion] = useState(initial?.version ?? 0); // OCC token the edit started from
  const [conflict, setConflict] = useState<{ updatedAt?: string; version?: number } | null>(null);

  useEffect(() => {
    if (!isEdit) setCategory(workerRole === 'FIELD_AGENT' ? 'FIELD' : 'IDENTITY');
  }, [workerRole, isEdit]);

  // The exact write payload (sans OCC `version`) — reused by both the mutation and client validation,
  // so the inline checks run over the SAME field names the server schema enforces.
  const buildPayload = () => {
    const profile = profileFor(workerRole);
    return {
      ...profile,
      code,
      name,
      category,
      description: description || null,
      piiSensitive,
      ...(toIsoDate(effectiveFrom) ? { effectiveFrom: toIsoDate(effectiveFrom) } : {}),
      ...(workerRole === 'FIELD_AGENT' ? { requiredFormCode: requiredFormCode || code } : {}),
    };
  };

  const mut = useMutation({
    mutationFn: () => {
      const payload = buildPayload();
      return isEdit
        ? api<VerificationUnit>('PUT', `${BASE}/${initial!.id}`, {
            ...payload,
            version,
          })
        : api<VerificationUnit>('POST', BASE, payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [QK] });
      navigate(LIST);
    },
    onError: (e: unknown) => {
      if (isStale(e)) {
        const current = (e.body as { current?: { updatedAt?: string; version?: number } } | null)?.current;
        setConflict(current ?? {});
      } else if (e instanceof ApiError && e.code === 'CODE_LOCKED') {
        setError(
          'This code is in use by other records and can’t be changed. Deactivate and recreate to fix it.',
        );
      } else setError(e instanceof Error ? e.message : 'Save failed');
    },
  });

  return (
    <div className="space-y-4">
      <Button variant="link" size="sm" onClick={() => navigate(LIST)}>
        ← Back to verification units
      </Button>
      <div>
        <h1 className="text-xl font-bold tracking-tight">{isEdit ? 'Edit' : 'New'} Verification Unit</h1>
        <p className="text-sm text-muted-foreground">The unified catalog — field visits and KYC documents.</p>
      </div>

      <div className="max-w-lg space-y-3 rounded-lg border border-border bg-card p-6 shadow-sm">
        <Field label="Code (UPPER_SNAKE)">
          <Input
            className="input"
            uppercase={false}
            value={code}
            onChange={(e) =>
              setCode(
                e.target.value
                  .toUpperCase()
                  .replace(/[^A-Z0-9]+/g, '_')
                  .replace(/^_+/, ''),
              )
            }
            placeholder="PAN_CARD"
          />
          {fieldErrors['code'] && (
            <span className="mt-1 block text-xs text-destructive">{fieldErrors['code']}</span>
          )}
        </Field>
        <Field label="Name">
          <Input className="input" value={name} onChange={(e) => setName(e.target.value)} />
          {fieldErrors['name'] && (
            <span className="mt-1 block text-xs text-destructive">{fieldErrors['name']}</span>
          )}
        </Field>
        <Field label="Worker Role">
          <select
            className="input"
            value={workerRole}
            disabled={isEdit}
            onChange={(e) => setWorkerRole(e.target.value as WorkerRole)}
          >
            <option value="FIELD_AGENT">Field Agent (field visit)</option>
            <option value="KYC_VERIFIER">KYC Verifier (desk document)</option>
          </select>
        </Field>
        <Field label="Category">
          <Input className="input" value={category} onChange={(e) => setCategory(e.target.value)} />
          {fieldErrors['category'] && (
            <span className="mt-1 block text-xs text-destructive">{fieldErrors['category']}</span>
          )}
        </Field>
        {workerRole === 'FIELD_AGENT' && (
          <Field label="Form code">
            <Input
              className="input"
              uppercase={false}
              value={requiredFormCode ?? ''}
              onChange={(e) => setRequiredFormCode(e.target.value)}
              placeholder="RESIDENCE_FORM"
            />
            {fieldErrors['requiredFormCode'] && (
              <span className="mt-1 block text-xs text-destructive">{fieldErrors['requiredFormCode']}</span>
            )}
          </Field>
        )}
        <Field label="Description">
          <Input className="input" value={description} onChange={(e) => setDescription(e.target.value)} />
          {fieldErrors['description'] && (
            <span className="mt-1 block text-xs text-destructive">{fieldErrors['description']}</span>
          )}
        </Field>
        <Field label="Effective From (blank = now)">
          <input
            type="date"
            className="input"
            value={effectiveFrom}
            onChange={(e) => setEffectiveFrom(e.target.value)}
          />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={piiSensitive} onChange={(e) => setPiiSensitive(e.target.checked)} />
          PII sensitive (DPDP masking)
        </label>
        <p className="rounded bg-surface-muted p-2 text-xs text-muted-foreground">
          {workerRole === 'FIELD_AGENT'
            ? 'Profile locked: FIELD_AGENT · ≥5 photos · GPS · agent commission · revisit (parent rate).'
            : 'Profile locked: KYC_VERIFIER · document · client invoice · no commission · recheck (fresh rate).'}
        </p>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={() => navigate(LIST)} disabled={mut.isPending}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              setError(null);
              // Validate the SAME payload the mutationFn posts (sans OCC `version`, not a schema field).
              const errs = zodFieldErrors(
                isEdit ? UpdateVerificationUnitSchema : CreateVerificationUnitSchema,
                buildPayload(),
              );
              if (Object.keys(errs).length > 0) {
                setFieldErrors(errs);
                return;
              }
              setFieldErrors({});
              mut.mutate();
            }}
            disabled={!name || !code}
            loading={mut.isPending}
          >
            Save
          </Button>
        </div>
      </div>

      {conflict && (
        <ConflictDialog
          entityLabel="verification unit"
          current={conflict}
          onReload={() => {
            if (conflict.version !== undefined) setVersion(conflict.version);
            qc.invalidateQueries({ queryKey: [QK] });
            setConflict(null);
          }}
          onDiscard={() => {
            qc.invalidateQueries({ queryKey: [QK] });
            navigate(LIST);
          }}
        />
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-foreground">{label}</span>
      {children}
    </label>
  );
}
