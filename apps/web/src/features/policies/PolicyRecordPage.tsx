import { useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Policy } from '@crm2/sdk';
import { api, ApiError } from '../../lib/sdk.js';
import { useAuth } from '../../lib/AuthContext.js';
import { ConflictDialog } from '../../components/ConflictDialog.js';
import { Button } from '../../components/ui/Button.js';
import { Input } from '../../components/ui/Input.js';
import { TextArea } from '../../components/ui/TextArea.js';
import { HexagonLoader } from '../../components/ui/HexagonLoader.js';

const HTTP_CONFLICT = 409;
const isStale = (e: unknown): e is ApiError =>
  e instanceof ApiError && e.status === HTTP_CONFLICT && e.code === 'STALE_UPDATE';

/**
 * Policy create/edit as a full record-page route (ADR-0051 — no modal). `/admin/policies/new` creates;
 * `/admin/policies/:id` loads that policy by id and edits it (deep-linkable). RBAC: `policy.manage` only
 * (the server enforces it on POST/PUT too); a viewer who deep-links here is bounced back to the list.
 */
export function PolicyRecordPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { has } = useAuth();
  const isEdit = !!id;
  const existing = useQuery({
    queryKey: ['policies', id],
    queryFn: () => api<Policy>('GET', `/api/v2/policies/${id}`),
    enabled: isEdit,
  });

  if (!has('policy.manage')) return <Navigate to="/admin/policies" replace />;
  if (isEdit && existing.isLoading) {
    return (
      <div className="py-10">
        <HexagonLoader operation="Loading policy" />
      </div>
    );
  }
  if (isEdit && (existing.isError || !existing.data)) {
    return (
      <div className="space-y-3">
        <Button variant="link" size="sm" onClick={() => navigate('/admin/policies')}>
          ← Back to policies
        </Button>
        <p className="text-sm text-muted-foreground">Couldn’t load this policy.</p>
      </div>
    );
  }
  // Re-mount the form per record (key) so its state seeds cleanly from the loaded policy.
  return <PolicyForm key={id ?? 'new'} initial={existing.data ?? null} />;
}

function PolicyForm({ initial }: { initial: Policy | null }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const isEdit = !!initial;
  const [code, setCode] = useState(initial?.code ?? '');
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [content, setContent] = useState(initial?.content ?? '');
  const [version, setVersion] = useState(initial?.version ?? 0); // OCC token the edit started from
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ updatedAt?: string; version?: number } | null>(null);

  const mut = useMutation({
    mutationFn: () => {
      const payload = { name, description: description || null, content };
      // code is set on create only; on edit it is omitted (immutable) and `version` (OCC) is sent.
      return isEdit
        ? api<Policy>('PUT', `/api/v2/policies/${initial!.id}`, { ...payload, version })
        : api<Policy>('POST', '/api/v2/policies', { ...payload, code });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['policies'] });
      navigate('/admin/policies');
    },
    onError: (e: unknown) => {
      if (isStale(e)) {
        const current = (e.body as { current?: { updatedAt?: string; version?: number } } | null)?.current;
        setConflict(current ?? {});
      } else setError(e instanceof Error ? e.message : 'Save failed');
    },
  });

  return (
    <div className="space-y-4">
      <Button variant="link" size="sm" onClick={() => navigate('/admin/policies')}>
        ← Back to policies
      </Button>
      <div>
        <h1 className="text-xl font-bold tracking-tight">{isEdit ? 'Edit' : 'New'} Policy</h1>
        <p className="text-sm text-muted-foreground">
          Admin-managed, versioned policy every user must accept at login.
        </p>
      </div>

      <div className="max-w-2xl space-y-3 rounded-lg border border-border bg-card p-6 shadow-sm">
        {!isEdit && (
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
              placeholder="PRIVACY_POLICY"
            />
          </Field>
        )}
        <Field label="Name">
          <Input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Description (optional)">
          <Input className="input" value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <Field label="Content (Markdown)">
          <TextArea
            className="input min-h-[20rem]"
            uppercase={false}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="# Policy heading&#10;&#10;Policy body in Markdown…"
          />
        </Field>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={() => navigate('/admin/policies')} disabled={mut.isPending}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              setError(null);
              mut.mutate();
            }}
            disabled={!name || !content || (!isEdit && !code)}
            loading={mut.isPending}
          >
            Save
          </Button>
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
            navigate('/admin/policies');
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
