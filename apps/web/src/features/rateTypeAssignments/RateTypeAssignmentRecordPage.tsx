import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { RateTypeAssignmentView } from '@crm2/sdk';
import { api } from '../../lib/sdk.js';
import { Button } from '../../components/ui/Button.js';
import { HexagonLoader } from '../../components/ui/HexagonLoader.js';
import { exitPath } from '../clientSetup/index.js';

const BASE = '/api/v2/rate-type-assignments';
const LIST_PATH = '/admin/rate-type-assignments';

/**
 * Read-only detail for a single rate-type assignment (`/admin/rate-type-assignments/:id`). The four
 * fields ARE the immutable unique key (NULLS-NOT-DISTINCT), so there is nothing to edit — to change a
 * row, deactivate it and create a new one. Creation lives on `/new` (RateTypeAssignmentCreatePage, the
 * merged multi-add page). View gate is `page.masterdata` (the route enforces it).
 */
export function RateTypeAssignmentRecordPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const exitTo = exitPath(searchParams.get('returnTo'), LIST_PATH);
  const existing = useQuery({
    queryKey: ['rate-type-assignment', id],
    queryFn: () => api<RateTypeAssignmentView>('GET', `${BASE}/${id}`),
    enabled: !!id,
  });

  if (!id) return <Navigate to={LIST_PATH} replace />;
  if (existing.isLoading) {
    return (
      <div className="py-10">
        <HexagonLoader operation="Loading rate type assignment" />
      </div>
    );
  }
  if (existing.isError || !existing.data) {
    return (
      <div className="space-y-3">
        <Button variant="link" size="sm" onClick={() => navigate(exitTo)}>
          ← Back to rate type assignments
        </Button>
        <p className="text-sm text-muted-foreground">Couldn’t load this assignment.</p>
      </div>
    );
  }
  return <AssignmentDetail row={existing.data} exitTo={exitTo} />;
}

/** Read-only detail — every field is part of the immutable key. */
function AssignmentDetail({ row, exitTo }: { row: RateTypeAssignmentView; exitTo: string }) {
  const navigate = useNavigate();
  return (
    <div className="space-y-4">
      <Button variant="link" size="sm" onClick={() => navigate(exitTo)}>
        ← Back to rate type assignments
      </Button>
      <div>
        <h1 className="text-xl font-bold tracking-tight">Rate Type Assignment</h1>
        <p className="text-sm text-muted-foreground">
          The combination is the immutable key — to change a row, deactivate it and create a new one.
        </p>
      </div>
      <div className="max-w-md space-y-3 rounded-lg border border-border bg-card p-6 shadow-sm">
        <dl className="space-y-2 rounded-md border border-border p-3 text-sm">
          <ReadOnlyRow label="Client" value={row.clientName ?? row.clientCode} />
          <ReadOnlyRow
            label="Product"
            value={`${row.productCode ?? ''} ${row.productName ?? ''}`.trim() || null}
            universal
          />
          <ReadOnlyRow label="Verification Unit" value={row.verificationUnitName} universal />
          <ReadOnlyRow label="Rate Type" value={row.rateTypeCode} mono />
          <ReadOnlyRow label="Status" value={row.isActive ? 'Active' : 'Inactive'} />
        </dl>
      </div>
    </div>
  );
}

/** One read-only line in the detail summary. `universal` renders blanks as "Universal". */
function ReadOnlyRow({
  label,
  value,
  mono,
  universal,
}: {
  label: string;
  value: string | null;
  mono?: boolean;
  universal?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className={`text-right text-foreground${mono ? ' font-mono text-xs' : ''}`}>
        {value ?? <span className="text-muted-foreground">{universal ? 'Universal' : '—'}</span>}
      </dd>
    </div>
  );
}
