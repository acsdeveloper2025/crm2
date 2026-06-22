import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { VerificationUnit } from '@crm2/sdk';
import { api, ApiError } from '../../lib/sdk.js';
import { toDateInput, toIsoDate } from '../../lib/format.js';
import { useFocusTrap } from '../../lib/useFocusTrap.js';
import { ConflictDialog } from '../../components/ConflictDialog.js';
import { Input } from '../../components/ui/Input.js';

const HTTP_CONFLICT = 409;
const isStale = (e: unknown): e is ApiError =>
  e instanceof ApiError && e.status === HTTP_CONFLICT && e.code === 'STALE_UPDATE';

type Kind = 'FIELD_VISIT' | 'KYC_DOCUMENT';

/** kind → the locked invariant profile (so the UI cannot author an invalid unit). */
function profileFor(kind: Kind) {
  return kind === 'FIELD_VISIT'
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

interface Props {
  unit: VerificationUnit | null; // null = create
  onClose: () => void;
}

export function VerificationUnitDialog({ unit, onClose }: Props) {
  const qc = useQueryClient();
  const isEdit = !!unit;
  const [code, setCode] = useState(unit?.code ?? '');
  const [name, setName] = useState(unit?.name ?? '');
  const [category, setCategory] = useState(unit?.category ?? 'FIELD');
  const [kind, setKind] = useState<Kind>((unit?.kind as Kind) ?? 'FIELD_VISIT');
  const [requiredFormCode, setRequiredFormCode] = useState(unit?.requiredFormCode ?? '');
  const [piiSensitive, setPiiSensitive] = useState(unit?.piiSensitive ?? false);
  const [description, setDescription] = useState(unit?.description ?? '');
  const [effectiveFrom, setEffectiveFrom] = useState(toDateInput(unit?.effectiveFrom));
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(unit?.version ?? 0); // OCC token the edit started from
  const [conflict, setConflict] = useState<{ updatedAt?: string; version?: number } | null>(null);
  const dialogRef = useFocusTrap<HTMLDivElement>(true, onClose);

  useEffect(() => {
    if (!isEdit) setCategory(kind === 'FIELD_VISIT' ? 'FIELD' : 'IDENTITY');
  }, [kind, isEdit]);

  const mut = useMutation({
    mutationFn: () => {
      const profile = profileFor(kind);
      const payload = {
        ...profile,
        name,
        category,
        kind,
        description: description || null,
        piiSensitive,
        ...(toIsoDate(effectiveFrom) ? { effectiveFrom: toIsoDate(effectiveFrom) } : {}),
        ...(kind === 'FIELD_VISIT' ? { requiredFormCode: requiredFormCode || code } : {}),
      };
      return isEdit
        ? api<VerificationUnit>('PUT', `/api/v2/verification-units/${unit!.id}`, {
            ...payload,
            code,
            version,
          })
        : api<VerificationUnit>('POST', '/api/v2/verification-units', { ...payload, code });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['verification-units'] });
      onClose();
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="vu-dialog-title"
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg border border-border bg-card p-6 text-card-foreground shadow-lg"
      >
        <h2 id="vu-dialog-title" className="mb-4 text-lg font-semibold">
          {isEdit ? 'Edit' : 'New'} Verification Unit
        </h2>
        <div className="space-y-3">
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
          </Field>
          <Field label="Name">
            <Input className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Kind">
            <select
              className="input"
              value={kind}
              disabled={isEdit}
              onChange={(e) => setKind(e.target.value as Kind)}
            >
              <option value="FIELD_VISIT">Field Visit</option>
              <option value="KYC_DOCUMENT">KYC Document</option>
            </select>
          </Field>
          <Field label="Category">
            <Input className="input" value={category} onChange={(e) => setCategory(e.target.value)} />
          </Field>
          {kind === 'FIELD_VISIT' && (
            <Field label="Form code">
              <Input
                className="input"
                uppercase={false}
                value={requiredFormCode ?? ''}
                onChange={(e) => setRequiredFormCode(e.target.value)}
                placeholder="RESIDENCE_FORM"
              />
            </Field>
          )}
          <Field label="Description">
            <Input className="input" value={description} onChange={(e) => setDescription(e.target.value)} />
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
            <input
              type="checkbox"
              checked={piiSensitive}
              onChange={(e) => setPiiSensitive(e.target.checked)}
            />
            PII sensitive (DPDP masking)
          </label>
          <p className="rounded bg-surface-muted p-2 text-xs text-muted-foreground">
            {kind === 'FIELD_VISIT'
              ? 'Profile locked: FIELD_AGENT · ≥5 photos · GPS · agent commission · revisit (parent rate).'
              : 'Profile locked: KYC_VERIFIER · document · client invoice · no commission · recheck (fresh rate).'}
          </p>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose} disabled={mut.isPending}>
            Cancel
          </button>
          <button
            className="btn"
            onClick={() => {
              setError(null);
              mut.mutate();
            }}
            disabled={mut.isPending || !name || !code}
          >
            {mut.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {conflict && (
        <ConflictDialog
          entityLabel="verification unit"
          current={conflict}
          onReload={() => {
            if (conflict.version !== undefined) setVersion(conflict.version);
            qc.invalidateQueries({ queryKey: ['verification-units'] });
            setConflict(null);
          }}
          onDiscard={() => {
            qc.invalidateQueries({ queryKey: ['verification-units'] });
            onClose();
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
