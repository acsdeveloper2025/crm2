import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Policy } from '@crm2/sdk';
import { api, ApiError } from '../../lib/sdk.js';
import { useFocusTrap } from '../../lib/useFocusTrap.js';
import { ConflictDialog } from '../../components/ConflictDialog.js';

const HTTP_CONFLICT = 409;
const isStale = (e: unknown): e is ApiError =>
  e instanceof ApiError && e.status === HTTP_CONFLICT && e.code === 'STALE_UPDATE';

interface Props {
  policy: Policy | null; // null = create
  onClose: () => void;
}

export function PolicyDialog({ policy, onClose }: Props) {
  const qc = useQueryClient();
  const isEdit = !!policy;
  const [code, setCode] = useState(policy?.code ?? '');
  const [name, setName] = useState(policy?.name ?? '');
  const [description, setDescription] = useState(policy?.description ?? '');
  const [content, setContent] = useState(policy?.content ?? '');
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(policy?.version ?? 0); // OCC token the edit started from
  const [conflict, setConflict] = useState<{ updatedAt?: string; version?: number } | null>(null);
  const dialogRef = useFocusTrap<HTMLDivElement>(true, onClose);

  const mut = useMutation({
    mutationFn: () => {
      const payload = { name, description: description || null, content };
      // code is set on create only; on edit it is omitted (immutable-ish) and `version` (OCC) is sent.
      return isEdit
        ? api<Policy>('PUT', `/api/v2/policies/${policy!.id}`, { ...payload, version })
        : api<Policy>('POST', '/api/v2/policies', { ...payload, code });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['policies'] });
      onClose();
    },
    onError: (e: unknown) => {
      if (isStale(e)) {
        const current = (e.body as { current?: { updatedAt?: string; version?: number } } | null)?.current;
        setConflict(current ?? {});
      } else setError(e instanceof Error ? e.message : 'Save failed');
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="policy-dialog-title"
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg border border-border bg-card p-6 text-card-foreground shadow-lg"
      >
        <h2 id="policy-dialog-title" className="mb-4 text-lg font-semibold">
          {isEdit ? 'Edit' : 'New'} Policy
        </h2>
        <div className="space-y-3">
          {!isEdit && (
            <Field label="Code (UPPER_SNAKE)">
              <input
                className="input"
                value={code}
                onChange={(e) =>
                  setCode(
                    e.target.value
                      .toUpperCase()
                      .replace(/[^A-Z0-9]+/g, '_')
                      .replace(/^_+/, ''),
                  )
                }
                placeholder="PRIVACY_POLICY"
              />
            </Field>
          )}
          <Field label="Name">
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Description (optional)">
            <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
          <Field label="Content (Markdown)">
            <textarea
              className="input min-h-[16rem]"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="# Policy heading&#10;&#10;Policy body in Markdown…"
            />
          </Field>
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
            disabled={mut.isPending || !name || !content || (!isEdit && !code)}
          >
            {mut.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {conflict && (
        <ConflictDialog
          entityLabel="policy"
          current={conflict}
          onReload={() => {
            if (conflict.version !== undefined) setVersion(conflict.version);
            qc.invalidateQueries({ queryKey: ['policies'] });
            setConflict(null);
          }}
          onDiscard={() => {
            qc.invalidateQueries({ queryKey: ['policies'] });
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
