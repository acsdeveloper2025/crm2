import { useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CreateReportTemplateSchema,
  REPORT_TEMPLATE_TYPES,
  UpdateReportTemplateSchema,
  type ReportTemplate,
  type ReportTemplateType,
} from '@crm2/sdk';
import { api, ApiError } from '../../lib/sdk.js';
import { zodFieldErrors } from '../../lib/zodForm.js';
import { useAuth } from '../../lib/AuthContext.js';
import { toDateInput, toIsoDate } from '../../lib/format.js';
import { ConflictDialog } from '../../components/ConflictDialog.js';
import { Button } from '../../components/ui/Button.js';
import { Input } from '../../components/ui/Input.js';
import { TextArea } from '../../components/ui/TextArea.js';
import { HexagonLoader } from '../../components/ui/HexagonLoader.js';

const BASE = '/api/v2/report-templates';
const QK = 'report-templates';
const HTTP_CONFLICT = 409;
const isStale = (e: unknown): e is ApiError =>
  e instanceof ApiError && e.status === HTTP_CONFLICT && e.code === 'STALE_UPDATE';

/**
 * Report Template create/edit as a full record-page route (ADR-0051 — no modal). `/admin/templates/new`
 * creates; `/admin/templates/:id` loads that template by id (additive GET /:id) and edits it
 * (deep-linkable). RBAC: `report_template.manage` only (the server enforces it on POST/PUT too); a viewer
 * who deep-links here is bounced back to the list.
 */
export function TemplateRecordPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { has } = useAuth();
  const isEdit = !!id;
  const existing = useQuery({
    queryKey: [QK, id],
    queryFn: () => api<ReportTemplate>('GET', `${BASE}/${id}`),
    enabled: isEdit,
  });

  if (!has('report_template.manage')) return <Navigate to="/admin/templates" replace />;
  if (isEdit && existing.isLoading) {
    return (
      <div className="py-10">
        <HexagonLoader operation="Loading template" />
      </div>
    );
  }
  if (isEdit && (existing.isError || !existing.data)) {
    return (
      <div className="space-y-3">
        <Button variant="link" size="sm" onClick={() => navigate('/admin/templates')}>
          ← Back to templates
        </Button>
        <p className="text-sm text-muted-foreground">Couldn’t load this template.</p>
      </div>
    );
  }
  // Re-mount the form per record (key) so its state seeds cleanly from the loaded template.
  return <TemplateForm key={id ?? 'new'} initial={existing.data ?? null} />;
}

function TemplateForm({ initial }: { initial: ReportTemplate | null }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const isEdit = !!initial;
  const [code, setCode] = useState(initial?.code ?? '');
  const [name, setName] = useState(initial?.name ?? '');
  const [templateType, setTemplateType] = useState<ReportTemplateType>(
    initial?.templateType ?? 'FIELD_NARRATIVE',
  );
  const [content, setContent] = useState(initial?.content ?? '');
  const [effectiveFrom, setEffectiveFrom] = useState(toDateInput(initial?.effectiveFrom));
  const [version, setVersion] = useState(initial?.version ?? 0); // OCC token the edit started from
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [conflict, setConflict] = useState<{ updatedAt?: string; version?: number } | null>(null);

  // Build the SAME payload the mutationFn posts, used for both zod validation and the request. `code`
  // is coerced to UPPER at submit (WYSIWYG until then — ADR-0058). `effectiveFrom` is optional in the
  // schema and `toIsoDate` may return undefined; spread it only when present (exactOptionalPropertyTypes).
  const buildPayload = () => {
    const iso = toIsoDate(effectiveFrom);
    return {
      code: code.toUpperCase(),
      name,
      templateType,
      content,
      ...(iso !== undefined ? { effectiveFrom: iso } : {}),
    };
  };

  const mut = useMutation({
    mutationFn: () => {
      const payload = buildPayload();
      // code is sent on create; on edit it is also editable (ADR-0020) and `version` (OCC) is sent.
      return isEdit
        ? api<ReportTemplate>('PUT', `${BASE}/${initial!.id}`, { ...payload, version })
        : api<ReportTemplate>('POST', BASE, payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [QK] });
      navigate('/admin/templates');
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
      <Button variant="link" size="sm" onClick={() => navigate('/admin/templates')}>
        ← Back to templates
      </Button>
      <div>
        <h1 className="text-xl font-bold tracking-tight">{isEdit ? 'Edit' : 'New'} Template</h1>
        <p className="text-sm text-muted-foreground">
          Authored report body the report engine renders per verification type.
        </p>
      </div>

      <div className="max-w-2xl space-y-3 rounded-lg border border-border bg-card p-6 shadow-sm">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Code (UPPER_SNAKE)">
            <Input
              className="input"
              uppercase={false}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="FIELD_RESIDENCE_V1"
            />
            {fieldErrors['code'] && (
              <span className="mt-1 block text-xs text-destructive">{fieldErrors['code']}</span>
            )}
          </Field>
          <Field label="Type">
            <select
              className="input"
              value={templateType}
              onChange={(e) => setTemplateType(e.target.value as ReportTemplateType)}
            >
              {REPORT_TEMPLATE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
            {fieldErrors['templateType'] && (
              <span className="mt-1 block text-xs text-destructive">{fieldErrors['templateType']}</span>
            )}
          </Field>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Name">
            <Input className="input" value={name} onChange={(e) => setName(e.target.value)} />
            {fieldErrors['name'] && (
              <span className="mt-1 block text-xs text-destructive">{fieldErrors['name']}</span>
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
        </div>
        <Field label="Template body (Handlebars / text)">
          <TextArea
            className="input min-h-[10rem] font-mono text-xs"
            uppercase={false}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Verification report for {{applicantName}} at {{address}}…"
          />
          {fieldErrors['content'] && (
            <span className="mt-1 block text-xs text-destructive">{fieldErrors['content']}</span>
          )}
        </Field>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={() => navigate('/admin/templates')} disabled={mut.isPending}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              setError(null);
              // Validate the SAME payload shape the mutationFn posts, against the SAME server schema.
              const payload = buildPayload();
              const errs = isEdit
                ? zodFieldErrors(UpdateReportTemplateSchema, payload)
                : zodFieldErrors(CreateReportTemplateSchema, payload);
              if (Object.keys(errs).length > 0) {
                setFieldErrors(errs);
                return;
              }
              setFieldErrors({});
              mut.mutate();
            }}
            disabled={!name || code.length < 2}
            loading={mut.isPending}
          >
            Save
          </Button>
        </div>
      </div>

      {conflict && (
        <ConflictDialog
          entityLabel="template"
          current={conflict}
          onReload={() => {
            if (conflict.version !== undefined) setVersion(conflict.version);
            qc.invalidateQueries({ queryKey: [QK] });
            setConflict(null);
          }}
          onDiscard={() => {
            qc.invalidateQueries({ queryKey: [QK] });
            navigate('/admin/templates');
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
