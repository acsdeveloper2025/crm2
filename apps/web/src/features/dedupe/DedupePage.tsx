import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  exportQueryToParams,
  pageQueryToParams,
  type ExportRequest,
  type PageQuery,
  type Paginated,
  type DuplicateMatch,
} from '@crm2/sdk';
import { api, apiExport } from '../../lib/sdk.js';
import { formatDateTime } from '../../lib/format.js';
import { useAuth } from '../../lib/AuthContext.js';
import { Input } from '../../components/ui/Input.js';
import { DataGrid, type DataGridColumn } from '../../components/ui/data-grid/index.js';
import { Button } from '../../components/ui/Button.js';

const BASE = '/api/v2/cases';
const DEDUPE_VIEW = 'dedupe.view';
const MIN_TERM = 2;

/** Case status → frozen status-token pair (COLOR_SYSTEM_FREEZE). */
const STATUS_TONE: Record<string, string> = {
  NEW: 'bg-st-pending-bg text-st-pending',
  IN_PROGRESS: 'bg-st-in-progress-bg text-st-in-progress',
  COMPLETED: 'bg-st-approved-bg text-st-approved',
  CANCELLED: 'bg-st-rejected-bg text-st-rejected',
};

type Identifiers = {
  name?: string | undefined;
  pan?: string | undefined;
  mobile?: string | undefined;
  company?: string | undefined;
};

/**
 * Dedupe Check — a read-only cross-case duplicate lookup (dedupe.view). The four-field identifier
 * form is the sole search surface (the grid's own search box is disabled); results render in the
 * Universal DataGrid (server pagination/sort/column-visibility/export, date-time, responsive).
 * It records nothing and creates nothing — links through to each matching case.
 */
export function DedupePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const has = (perm: string) =>
    !!user && (user.grantsAll === true || (user.permissions ?? []).includes(perm));

  const [name, setName] = useState('');
  const [pan, setPan] = useState('');
  const [mobile, setMobile] = useState('');
  const [company, setCompany] = useState('');
  // The submitted identifiers drive the grid; editing a field does not refetch until Search.
  const [submitted, setSubmitted] = useState<Identifiers | null>(null);

  const trimmed: Identifiers = useMemo(() => {
    const pick = (v: string) => (v.trim().length >= MIN_TERM ? v.trim() : undefined);
    return { name: pick(name), pan: pick(pan), mobile: pick(mobile), company: pick(company) };
  }, [name, pan, mobile, company]);
  const canSearch = Boolean(trimmed.name ?? trimmed.pan ?? trimmed.mobile ?? trimmed.company);

  const onlyDigits = (v: string) => v.replace(/\D/g, '');

  const columns = useMemo<DataGridColumn<DuplicateMatch>[]>(
    () => [
      {
        id: 'caseNumber',
        header: 'Case',
        sortable: true,
        hideable: false,
        cell: (r) => <span className="font-mono text-xs text-primary">{r.caseNumber}</span>,
      },
      { id: 'applicantName', header: 'Applicant', sortable: true, cell: (r) => r.applicantName },
      { id: 'companyName', header: 'Company', sortable: true, cell: (r) => r.companyName ?? '—' },
      { id: 'mobile', header: 'Mobile', cell: (r) => r.mobile ?? '—' },
      {
        id: 'pan',
        header: 'PAN',
        cell: (r) => <span className="font-mono text-xs">{r.pan ?? '—'}</span>,
      },
      {
        id: 'status',
        header: 'Status',
        sortable: true,
        cell: (r) => (
          <span
            className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${STATUS_TONE[r.status] ?? ''}`}
          >
            {r.status.replace(/_/g, ' ')}
          </span>
        ),
      },
      { id: 'clientName', header: 'Client', sortable: true, cell: (r) => r.clientName },
      { id: 'createdAt', header: 'Created', sortable: true, cell: (r) => formatDateTime(r.createdAt) },
      {
        id: 'matchType',
        header: 'Matched On',
        cell: (r) => (
          <div className="flex flex-wrap gap-1">
            {r.matchType.map((m) => (
              <span key={m} className="rounded bg-surface-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                {m}
              </span>
            ))}
          </div>
        ),
      },
    ],
    [],
  );

  if (!has(DEDUPE_VIEW)) {
    return <p className="text-sm text-destructive">You do not have permission to access this page.</p>;
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold">Dedupe Check</h1>
        <p className="text-sm text-muted-foreground">
          Search existing cases by applicant identity to check for duplicates. Read-only.
        </p>
      </div>

      <form
        className="grid grid-cols-1 items-end gap-2 rounded-lg border border-border bg-card p-3 shadow-sm md:grid-cols-[1.5fr_1fr_1fr_1.5fr_auto]"
        onSubmit={(e) => {
          e.preventDefault();
          if (canSearch) setSubmitted(trimmed);
        }}
      >
        <label className="block text-sm">
          <span className="mb-1 block text-xs font-medium text-muted-foreground">Name</span>
          <Input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Applicant name"
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-xs font-medium text-muted-foreground">PAN</span>
          <Input
            uppercase={false}
            className="input"
            value={pan}
            maxLength={10}
            onChange={(e) => setPan(e.target.value.toUpperCase())}
            placeholder="ABCDE1234F"
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-xs font-medium text-muted-foreground">Mobile</span>
          <Input
            uppercase={false}
            className="input"
            value={mobile}
            inputMode="numeric"
            maxLength={15}
            onChange={(e) => setMobile(onlyDigits(e.target.value))}
            placeholder="Mobile number"
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-xs font-medium text-muted-foreground">Company Name</span>
          <Input
            className="input"
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            placeholder="Company / employer"
          />
        </label>
        <Button type="submit" disabled={!canSearch}>
          Search
        </Button>
      </form>
      {!canSearch && (name || pan || mobile || company) && (
        <p className="text-xs text-muted-foreground">Enter at least 2 characters in one field to search.</p>
      )}

      {submitted ? (
        <DataGrid<DuplicateMatch>
          columns={columns}
          queryKey="dedupe"
          rowId={(r) => `${r.caseId}::${r.applicantName}::${r.pan ?? ''}`}
          searchable={false}
          defaultSort="createdAt"
          defaultSortOrder="desc"
          filters={submitted}
          fetchPage={(q: PageQuery) =>
            api<Paginated<DuplicateMatch>>('GET', `${BASE}/dedupe-search?${pageQueryToParams(q).toString()}`)
          }
          exportFn={(req: ExportRequest) =>
            apiExport(`${BASE}/dedupe-search/export?${exportQueryToParams(req).toString()}`)
          }
          onRowClick={(r) => navigate(`/cases/${r.caseId}`)}
          loadingLabel="Dedupe"
        />
      ) : (
        <p className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          Enter an identifier above and search to check for existing cases.
        </p>
      )}
    </div>
  );
}
