import { useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  COLUMN_DATA_TYPES,
  SOURCE_TYPES,
  SOURCE_CATALOG,
  validateColumnSource,
  FIELD_REPORT_DEFAULTS,
  FIELD_REPORT_HELPER_SET,
  DEFAULT_CASE_REPORT_TEMPLATE,
  DEFAULT_PDF_PAGE_SIZE,
  DEFAULT_PDF_ORIENTATION,
  REPORT_PAGE_SIZES,
  REPORT_PAGE_ORIENTATIONS,
  CASE_REPORT_VARIABLE_CATALOG,
  LAYOUT_KINDS,
  CreateReportLayoutSchema,
  UpdateReportLayoutSchema,
  type Option,
  type LayoutKind,
  type SourceType,
  type ColumnDataType,
  type PageSize,
  type PageOrientation,
  type ReportLayoutDetail,
  type VerificationUnitOption,
} from '@crm2/sdk';
import { api, ApiError } from '../../lib/sdk.js';
import { useAuth } from '../../lib/AuthContext.js';
import { zodFieldErrors } from '../../lib/zodForm.js';
import { HexagonLoader } from '../../components/ui/HexagonLoader.js';
import { Button } from '../../components/ui/Button.js';
import { Input } from '../../components/ui/Input.js';
import { TextArea } from '../../components/ui/TextArea.js';
import { toast } from 'sonner';

const HTTP_CONFLICT = 409;
const isStale = (e: unknown): e is ApiError =>
  e instanceof ApiError && e.status === HTTP_CONFLICT && e.code === 'STALE_UPDATE';

const KIND_LABEL: Record<LayoutKind, string> = {
  DATA_ENTRY: 'Data Entry',
  MIS: 'MIS',
  BILLING_MIS: 'Billing MIS',
  // FIELD_REPORT layouts are authored in the Field Report designer (S2); listed here for completeness.
  FIELD_REPORT: 'Field Report',
  // CASE_REPORT layouts are authored in the Case Report designer (S5 slice 3); placeholder label.
  CASE_REPORT: 'Case Report',
};

// All kinds are creatable. Column-based kinds (DATA_ENTRY/MIS/BILLING_MIS) build display columns;
// FIELD_REPORT (ADR-0039 S2b) adds a verification-type key + a Handlebars narrative body, and its
// columns are the VARIABLE CATALOG the body renders against.
const DESIGNER_KINDS = LAYOUT_KINDS;

const slug = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);

/** One editable column row in the designer. `key` is a stable React id (not the column_key). */
interface ColRow {
  key: number;
  columnKey: string;
  headerLabel: string;
  sourceType: SourceType;
  sourceRef: string;
  dataType: ColumnDataType;
  section: string;
  isRequired: boolean;
}

let ROW_SEQ = 1;
const blankRow = (): ColRow => ({
  key: ROW_SEQ++,
  columnKey: '',
  headerLabel: '',
  sourceType: 'CASE_FIELD',
  sourceRef: '',
  dataType: 'TEXT',
  section: '',
  isRequired: false,
});

const FREE_PLACEHOLDER: Partial<Record<SourceType, string>> = {
  DATA_ENTRY_FIELD: 'data-entry field key',
  FORM_DATA_PATH: 'residence.metPersonName',
  DOC_TYPE_COUNT: 'verification unit code',
  COMPUTED: 'expression key',
};

/**
 * Report Layout create/edit as a full record-page route (ADR-0051 — no modal). `/admin/report-layouts/new`
 * creates; `/admin/report-layouts/:id` loads that layout by id and edits it (deep-linkable). RBAC:
 * `report_template.manage` only (the server enforces it on POST/PUT too); a viewer who deep-links here is
 * bounced back to the list.
 */
export function ReportLayoutRecordPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { has } = useAuth();
  const isEdit = !!id;
  const numericId = id ? Number(id) : null;

  const detail = useQuery({
    queryKey: ['report-layout', numericId],
    queryFn: () => api<ReportLayoutDetail>('GET', `/api/v2/report-layouts/${numericId}`),
    enabled: isEdit,
  });

  if (!has('report_template.manage')) return <Navigate to="/admin/report-layouts" replace />;
  if (isEdit && detail.isLoading) {
    return (
      <div className="py-10">
        <HexagonLoader operation="Loading Layout" />
      </div>
    );
  }
  if (isEdit && (detail.isError || !detail.data)) {
    return (
      <div className="space-y-3">
        <Button variant="link" size="sm" onClick={() => navigate('/admin/report-layouts')}>
          ← Back to MIS Layouts
        </Button>
        <p className="text-sm text-muted-foreground">Couldn’t load this layout.</p>
      </div>
    );
  }
  // Re-mount the form per record (key) so its state seeds cleanly from the loaded layout.
  return <Form key={id ?? 'new'} initial={detail.data ?? null} />;
}

/**
 * MIS Layout Designer (ADR-0037 slice 2) — design a per-(client,product) layout for ONE kind from
 * BLANK (no default format). Each column binds to a source from the shared SOURCE_CATALOG; the
 * source-ref control adapts to the source mode (FIXED → a field dropdown; REFLESS → none; FREE → text).
 */
function Form({ initial }: { initial: ReportLayoutDetail | null }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const isEdit = !!initial;

  const clients = useQuery({
    queryKey: ['client-options'],
    queryFn: () => api<Option[]>('GET', '/api/v2/clients/options'),
  });
  const products = useQuery({
    queryKey: ['product-options'],
    queryFn: () => api<Option[]>('GET', '/api/v2/products/options'),
  });
  // FIELD_REPORT verification-type options = the field-visit unit codes (typo-safe key picker).
  const units = useQuery({
    queryKey: ['vunit-options'],
    queryFn: () => api<VerificationUnitOption[]>('GET', '/api/v2/verification-units/options'),
  });
  const fieldUnits = (units.data ?? []).filter((u) => u.workerRole === 'FIELD_AGENT');

  // create-mode form state; in edit mode these are seeded from `initial` via the state initializers.
  const [clientId, setClientId] = useState(initial ? String(initial.clientId) : '');
  const [productId, setProductId] = useState(initial ? String(initial.productId) : '');
  const [kind, setKind] = useState<LayoutKind>(initial?.kind ?? 'MIS');
  const [name, setName] = useState(initial?.name ?? '');
  const [verificationType, setVerificationType] = useState(initial?.verificationType ?? '');
  const [templateBody, setTemplateBody] = useState(initial?.templateBody ?? '');
  const [pageSize, setPageSize] = useState<PageSize>(initial?.pageSize ?? DEFAULT_PDF_PAGE_SIZE);
  const [pageOrientation, setPageOrientation] = useState<PageOrientation>(
    initial?.pageOrientation ?? DEFAULT_PDF_ORIENTATION,
  );
  const [rows, setRows] = useState<ColRow[]>(
    initial
      ? initial.columns.map((c) => ({
          key: ROW_SEQ++,
          columnKey: c.columnKey,
          headerLabel: c.headerLabel,
          sourceType: c.sourceType,
          sourceRef: c.sourceRef ?? '',
          dataType: c.dataType,
          section: c.section ?? '',
          isRequired: c.isRequired,
        }))
      : [blankRow()],
  );
  const [version] = useState(initial?.version ?? 1); // OCC token the edit started from
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const isFieldReport = kind === 'FIELD_REPORT';
  const isCaseReport = kind === 'CASE_REPORT';
  // CASE_REPORT renders the fixed case context (no column catalog) — it authors an HTML body + page geometry.
  const hasColumns = !isCaseReport;
  // Mirror the server gate: ban every raw-output form {{{ }}} / {{& }} / {{~{ }}} / {{~& }} (escape
  // opt-outs → XSS sink). The optional ~ matters — {{~& x}} is raw too.
  const hasRawOutput = /\{\{~?[{&]/.test(templateBody);

  const patch = (key: number, p: Partial<ColRow>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)));
  const move = (i: number, dir: -1 | 1) =>
    setRows((rs) => {
      const j = i + dir;
      if (j < 0 || j >= rs.length) return rs;
      const next = [...rs];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });

  const save = useMutation({
    mutationFn: () => {
      // CASE_REPORT carries no columns (it renders the fixed case context); the others build them.
      const columns = hasColumns
        ? rows.map((r, i) => {
            const refless = SOURCE_CATALOG[r.sourceType].mode === 'REFLESS';
            return {
              columnKey: r.columnKey || slug(r.headerLabel),
              headerLabel: r.headerLabel,
              sourceType: r.sourceType,
              sourceRef: refless ? undefined : r.sourceRef || undefined,
              dataType: r.dataType,
              displayOrder: i,
              ...(kind === 'DATA_ENTRY' ? { isRequired: r.isRequired } : {}),
              ...(r.section ? { section: r.section } : {}),
            };
          })
        : [];
      return isEdit
        ? api<ReportLayoutDetail>('PUT', `/api/v2/report-layouts/${initial!.id}`, {
            name,
            version,
            // CASE_REPORT has no columns — omit them so the update is a pure body/page patch (no
            // needless column DELETE+reinsert). Column kinds + FIELD_REPORT send their columns.
            ...(hasColumns ? { columns } : {}),
            // verificationType is an immutable identity key — only templateBody is editable for FIELD_REPORT.
            ...(isFieldReport ? { templateBody } : {}),
            ...(isCaseReport ? { templateBody, pageSize, pageOrientation } : {}),
          })
        : api<ReportLayoutDetail>('POST', '/api/v2/report-layouts', {
            clientId: Number(clientId),
            productId: Number(productId),
            kind,
            name,
            columns,
            ...(isFieldReport ? { verificationType, templateBody } : {}),
            ...(isCaseReport ? { templateBody, pageSize, pageOrientation } : {}),
          });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['report-layouts'] });
      toast.success(isEdit ? 'Layout updated' : 'Layout created');
      navigate('/admin/report-layouts');
    },
    onError: (e: unknown) =>
      setError(
        isStale(e)
          ? 'This layout changed since you opened it — reload and retry.'
          : e instanceof ApiError
            ? e.code === 'REPORT_LAYOUT_EXISTS'
              ? 'An active layout already exists for this client + product + kind.'
              : e.code === 'VALIDATION'
                ? 'Some columns are invalid — check the source bindings highlighted below.'
                : e.code
            : 'Save failed',
      ),
  });

  // derived column_key per row (server requires unique, non-empty, lowercase). Mirror that here so
  // the operator gets an inline pointer instead of a generic VALIDATION toast from the server.
  const keyOf = (r: ColRow) => r.columnKey || slug(r.headerLabel);
  const keyCounts = new Map<string, number>();
  for (const r of rows) {
    const k = keyOf(r);
    keyCounts.set(k, (keyCounts.get(k) ?? 0) + 1);
  }
  // client-side mirror of the server binding + key validation (live per-row hint).
  const rowError = (r: ColRow): string | null => {
    if (r.headerLabel.trim() === '') return 'Header required';
    const k = keyOf(r);
    if (k === '') return 'Header needs letters or digits';
    if ((keyCounts.get(k) ?? 0) > 1) return `Duplicate key '${k}'`;
    // a key equal to a grammar-helper name would be shadowed by the helper in the template (S3a).
    if (isFieldReport && FIELD_REPORT_HELPER_SET.has(k)) return `Key '${k}' collides with a helper name`;
    return validateColumnSource(
      r.sourceType,
      SOURCE_CATALOG[r.sourceType].mode === 'REFLESS' ? null : r.sourceRef,
    );
  };

  const canSave =
    name.trim() !== '' &&
    // column kinds need ≥1 valid column; CASE_REPORT has none.
    (!hasColumns || (rows.length > 0 && rows.every((r) => rowError(r) === null))) &&
    (isEdit || (clientId !== '' && productId !== '')) &&
    // FIELD_REPORT needs a narrative body, and (on create) a verification-type key.
    (!isFieldReport || (templateBody.trim() !== '' && (isEdit || verificationType !== ''))) &&
    // CASE_REPORT needs an HTML body with NO triple-stash (the output-encoding gate).
    (!isCaseReport || (templateBody.trim() !== '' && !hasRawOutput));

  return (
    <div className="space-y-4">
      <Button variant="link" size="sm" onClick={() => navigate('/admin/report-layouts')}>
        ← Back to MIS Layouts
      </Button>
      <div>
        <h1 className="text-xl font-bold tracking-tight">{isEdit ? 'Edit' : 'New'} Report Layout</h1>
        <p className="text-sm text-muted-foreground">
          Per client + product layout — Data Entry, MIS, Billing MIS columns and Field Report narrative
          templates — built from blank, no default format.
        </p>
      </div>

      <div className="max-w-4xl rounded-lg border border-border bg-card p-6 text-card-foreground shadow-sm">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-foreground">Client</span>
            <select
              className="input"
              value={clientId}
              disabled={isEdit}
              onChange={(e) => setClientId(e.target.value)}
            >
              <option value="">Select…</option>
              {(clients.data ?? []).map((c) => (
                <option key={c.id} value={String(c.id)}>
                  {c.name}
                </option>
              ))}
            </select>
            {fieldErrors['clientId'] && (
              <span className="mt-1 block text-xs text-destructive">{fieldErrors['clientId']}</span>
            )}
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-foreground">Product</span>
            <select
              className="input"
              value={productId}
              disabled={isEdit}
              onChange={(e) => setProductId(e.target.value)}
            >
              <option value="">Select…</option>
              {(products.data ?? []).map((p) => (
                <option key={p.id} value={String(p.id)}>
                  {p.name}
                </option>
              ))}
            </select>
            {fieldErrors['productId'] && (
              <span className="mt-1 block text-xs text-destructive">{fieldErrors['productId']}</span>
            )}
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-foreground">Kind</span>
            <select
              className="input"
              value={kind}
              disabled={isEdit}
              onChange={(e) => setKind(e.target.value as LayoutKind)}
            >
              {DESIGNER_KINDS.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </select>
            {fieldErrors['kind'] && (
              <span className="mt-1 block text-xs text-destructive">{fieldErrors['kind']}</span>
            )}
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-foreground">Name</span>
            <Input
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Axis MIS"
            />
            {fieldErrors['name'] && (
              <span className="mt-1 block text-xs text-destructive">{fieldErrors['name']}</span>
            )}
          </label>
        </div>

        {isFieldReport && (
          <div className="mt-3 space-y-3">
            <label className="block sm:max-w-xs">
              <span className="mb-1 block text-xs font-medium text-foreground">Verification Type</span>
              <select
                className="input"
                value={verificationType}
                disabled={isEdit}
                onChange={(e) => setVerificationType(e.target.value)}
              >
                <option value="">Select…</option>
                {fieldUnits.map((u) => (
                  <option key={u.code} value={u.code}>
                    {u.code} — {u.name}
                  </option>
                ))}
              </select>
              {fieldErrors['verificationType'] && (
                <span className="mt-1 block text-xs text-destructive">{fieldErrors['verificationType']}</span>
              )}
            </label>
            <label className="block">
              <div className="mb-1 flex items-center justify-between">
                <span className="block text-xs font-medium text-foreground">
                  Report Template (Handlebars)
                </span>
                {!isEdit && FIELD_REPORT_DEFAULTS[verificationType] && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      const d = FIELD_REPORT_DEFAULTS[verificationType]!;
                      setTemplateBody(d.templateBody);
                      setRows(
                        d.columns.map((c) => ({
                          key: ROW_SEQ++,
                          columnKey: c.columnKey,
                          headerLabel: c.headerLabel,
                          sourceType: c.sourceType,
                          sourceRef: c.sourceRef ?? '',
                          dataType: c.dataType,
                          section: c.section ?? '',
                          isRequired: c.isRequired ?? false,
                        })),
                      );
                    }}
                  >
                    Load standard template
                  </Button>
                )}
              </div>
              <TextArea
                className="input min-h-[8rem] font-mono text-xs"
                uppercase={false}
                value={templateBody}
                onChange={(e) => setTemplateBody(e.target.value)}
                placeholder={
                  'Visited {{customer_name}} at {{address}}.\n{{#eq outcome "Positive & Door Open"}}Stay confirmed.{{/eq}}'
                }
              />
              {fieldErrors['templateBody'] && (
                <span className="mt-1 block text-xs text-destructive">{fieldErrors['templateBody']}</span>
              )}
              <span className="mt-1 block text-[11px] text-muted-foreground">
                Reference the variables below by their key, e.g.{' '}
                <span className="font-mono">{'{{customer_name}}'}</span>. Conditionals:{' '}
                <span className="font-mono">{'{{#eq outcome "..."}}…{{/eq}}'}</span>.
              </span>
            </label>
          </div>
        )}

        {isCaseReport && (
          <div className="mt-3 space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:max-w-md">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-foreground">Page Size</span>
                <select
                  className="input"
                  value={pageSize}
                  onChange={(e) => setPageSize(e.target.value as PageSize)}
                >
                  {REPORT_PAGE_SIZES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
                {fieldErrors['pageSize'] && (
                  <span className="mt-1 block text-xs text-destructive">{fieldErrors['pageSize']}</span>
                )}
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-foreground">Orientation</span>
                <select
                  className="input"
                  value={pageOrientation}
                  onChange={(e) => setPageOrientation(e.target.value as PageOrientation)}
                >
                  {REPORT_PAGE_ORIENTATIONS.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
                {fieldErrors['pageOrientation'] && (
                  <span className="mt-1 block text-xs text-destructive">
                    {fieldErrors['pageOrientation']}
                  </span>
                )}
              </label>
            </div>
            <label className="block">
              <div className="mb-1 flex items-center justify-between">
                <span className="block text-xs font-medium text-foreground">
                  Report Template (HTML + Handlebars)
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setTemplateBody(DEFAULT_CASE_REPORT_TEMPLATE)}
                >
                  Load default template
                </Button>
              </div>
              <TextArea
                className="input min-h-[16rem] font-mono text-xs"
                uppercase={false}
                value={templateBody}
                onChange={(e) => setTemplateBody(e.target.value)}
                placeholder={'<h1>{{client.name}}</h1>\n<p>{{case.caseNumber}} — {{case.customerName}}</p>'}
              />
              {hasRawOutput && (
                <span className="mt-1 block text-xs text-destructive">
                  Raw un-escaped output (<span className="font-mono">{'{{{ }}}'}</span> or{' '}
                  <span className="font-mono">{'{{& }}'}</span>) is not allowed — use{' '}
                  <span className="font-mono">{'{{ }}'}</span> so values are HTML-escaped.
                </span>
              )}
              {!hasRawOutput && fieldErrors['templateBody'] && (
                <span className="mt-1 block text-xs text-destructive">{fieldErrors['templateBody']}</span>
              )}
              <span className="mt-1 block text-[11px] text-muted-foreground">
                Values are HTML-escaped automatically. Use{' '}
                <span className="font-mono">{'{{nl2br narrative}}'}</span> for multi-line text,{' '}
                <span className="font-mono">{'{{fmtDate case.receivedDate}}'}</span> for dates.
              </span>
            </label>
            <div>
              <h3 className="mb-1 text-sm font-semibold">Available variables</h3>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {CASE_REPORT_VARIABLE_CATALOG.map((g) => (
                  <div key={g.group} className="rounded-md border border-border p-2">
                    <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {g.group}
                    </div>
                    <ul className="space-y-0.5">
                      {g.vars.map((v) => (
                        <li key={v.path} className="flex items-baseline justify-between gap-2 text-[11px]">
                          <span className="font-mono text-foreground">{`{{${v.path}}}`}</span>
                          <span className="text-muted-foreground">{v.note}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {hasColumns && (
          <>
            <div className="mt-5 flex items-center justify-between">
              <h3 className="text-sm font-semibold">
                {isFieldReport ? 'Variables' : 'Columns'} ({rows.length})
              </h3>
              <Button variant="ghost" size="sm" onClick={() => setRows((rs) => [...rs, blankRow()])}>
                + Add {isFieldReport ? 'Variable' : 'Column'}
              </Button>
            </div>
            {fieldErrors['columns'] && (
              <span className="mt-1 block text-xs text-destructive">{fieldErrors['columns']}</span>
            )}

            <div className="mt-2 space-y-2">
              {rows.map((r, i) => {
                const mode = SOURCE_CATALOG[r.sourceType].mode;
                const err = rowError(r);
                return (
                  <div key={r.key} className="rounded-md border border-border p-2">
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-12 sm:items-end">
                      <label className="block sm:col-span-3">
                        <span className="mb-1 block text-[11px] uppercase tracking-wide text-muted-foreground">
                          Header
                        </span>
                        <Input
                          className="input"
                          value={r.headerLabel}
                          onChange={(e) =>
                            patch(r.key, {
                              headerLabel: e.target.value,
                              ...(r.columnKey === '' ? { columnKey: slug(e.target.value) } : {}),
                            })
                          }
                          placeholder="Case Number"
                        />
                      </label>
                      <label className="block sm:col-span-2">
                        <span className="mb-1 block text-[11px] uppercase tracking-wide text-muted-foreground">
                          Source
                        </span>
                        <select
                          className="input"
                          value={r.sourceType}
                          onChange={(e) =>
                            patch(r.key, { sourceType: e.target.value as SourceType, sourceRef: '' })
                          }
                        >
                          {SOURCE_TYPES.map((st) => (
                            <option key={st} value={st}>
                              {st.replace(/_/g, ' ')}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="block sm:col-span-3">
                        <span className="mb-1 block text-[11px] uppercase tracking-wide text-muted-foreground">
                          Field
                        </span>
                        {mode === 'FIXED' ? (
                          <select
                            className="input"
                            value={r.sourceRef}
                            onChange={(e) => {
                              const f = SOURCE_CATALOG[r.sourceType].fields?.find(
                                (x) => x.key === e.target.value,
                              );
                              patch(r.key, {
                                sourceRef: e.target.value,
                                ...(f ? { dataType: f.dataType } : {}),
                              });
                            }}
                          >
                            <option value="">Select…</option>
                            {(SOURCE_CATALOG[r.sourceType].fields ?? []).map((f) => (
                              <option key={f.key} value={f.key}>
                                {f.label}
                              </option>
                            ))}
                          </select>
                        ) : mode === 'FREE' ? (
                          <Input
                            className="input"
                            uppercase={false}
                            value={r.sourceRef}
                            onChange={(e) => patch(r.key, { sourceRef: e.target.value })}
                            placeholder={FREE_PLACEHOLDER[r.sourceType]}
                          />
                        ) : (
                          <div className="flex h-9 items-center text-xs text-muted-foreground">
                            — derived —
                          </div>
                        )}
                      </label>
                      <label className="block sm:col-span-2">
                        <span className="mb-1 block text-[11px] uppercase tracking-wide text-muted-foreground">
                          Type
                        </span>
                        <select
                          className="input"
                          value={r.dataType}
                          onChange={(e) => patch(r.key, { dataType: e.target.value as ColumnDataType })}
                        >
                          {COLUMN_DATA_TYPES.map((dt) => (
                            <option key={dt} value={dt}>
                              {dt}
                            </option>
                          ))}
                        </select>
                      </label>
                      <div className="flex items-center gap-1 sm:col-span-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          iconOnly
                          aria-label="Move up"
                          disabled={i === 0}
                          onClick={() => move(i, -1)}
                        >
                          ↑
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          iconOnly
                          aria-label="Move down"
                          disabled={i === rows.length - 1}
                          onClick={() => move(i, 1)}
                        >
                          ↓
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          iconOnly
                          aria-label="Remove column"
                          onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
                        >
                          ✕
                        </Button>
                      </div>
                    </div>
                    <div className="mt-1 flex items-center gap-3">
                      <Input
                        className="input h-7 max-w-[14rem] text-xs"
                        value={r.section}
                        onChange={(e) => patch(r.key, { section: e.target.value })}
                        placeholder="Section (optional)"
                      />
                      {kind === 'DATA_ENTRY' && (
                        <label className="flex items-center gap-1 text-xs text-muted-foreground">
                          <input
                            type="checkbox"
                            checked={r.isRequired}
                            onChange={(e) => patch(r.key, { isRequired: e.target.checked })}
                          />
                          Required
                        </label>
                      )}
                      <span className="text-[11px] text-muted-foreground">
                        key: <span className="font-mono">{r.columnKey || slug(r.headerLabel) || '—'}</span>
                      </span>
                      {err && <span className="text-xs text-destructive">{err}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => navigate('/admin/report-layouts')} disabled={save.isPending}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              setError(null);
              // Validate the EXACT payload the mutationFn posts against the canonical schema.
              const columns = hasColumns
                ? rows.map((r, i) => {
                    const refless = SOURCE_CATALOG[r.sourceType].mode === 'REFLESS';
                    return {
                      columnKey: r.columnKey || slug(r.headerLabel),
                      headerLabel: r.headerLabel,
                      sourceType: r.sourceType,
                      sourceRef: refless ? undefined : r.sourceRef || undefined,
                      dataType: r.dataType,
                      displayOrder: i,
                      ...(kind === 'DATA_ENTRY' ? { isRequired: r.isRequired } : {}),
                      ...(r.section ? { section: r.section } : {}),
                    };
                  })
                : [];
              const errs = isEdit
                ? zodFieldErrors(UpdateReportLayoutSchema, {
                    name,
                    version,
                    ...(hasColumns ? { columns } : {}),
                    ...(isFieldReport ? { templateBody } : {}),
                    ...(isCaseReport ? { templateBody, pageSize, pageOrientation } : {}),
                  })
                : zodFieldErrors(CreateReportLayoutSchema, {
                    clientId: Number(clientId),
                    productId: Number(productId),
                    kind,
                    name,
                    columns,
                    ...(isFieldReport ? { verificationType, templateBody } : {}),
                    ...(isCaseReport ? { templateBody, pageSize, pageOrientation } : {}),
                  });
              if (Object.keys(errs).length > 0) {
                setFieldErrors(errs);
                return;
              }
              setFieldErrors({});
              save.mutate();
            }}
            disabled={!canSave}
            loading={save.isPending}
          >
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}
