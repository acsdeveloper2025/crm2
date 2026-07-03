import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  exportQueryToParams,
  pageQueryToParams,
  type ExportRequest,
  type PageQuery,
  type Paginated,
  type RoleOption,
  type TempPasswordResponse,
  type UserView,
} from '@crm2/sdk';
import { toast } from 'sonner';
import { api, apiExport, ApiError } from '../../lib/sdk.js';
import { formatDateTime } from '../../lib/format.js';
import { useFocusTrap } from '../../lib/useFocusTrap.js';
import { BulkStatusActions } from '../../components/BulkStatusActions.js';
import { StatusChip } from '../../components/StatusChip.js';
import { ConflictDialog } from '../../components/ConflictDialog.js';
import { PasswordPolicyChecklist, isPasswordStrong } from '../../components/PasswordPolicyChecklist.js';
import { DataGrid, type DataGridColumn } from '../../components/ui/data-grid/index.js';
import { ImportButton } from '../../components/import/ImportModal.js';
import { Button } from '../../components/ui/Button.js';
import { DownloadIcon } from '../../components/ui/icons.js';
import { Input } from '../../components/ui/Input.js';

const HTTP_CONFLICT = 409;
const isStale = (e: unknown): e is ApiError =>
  e instanceof ApiError && e.status === HTTP_CONFLICT && e.code === 'STALE_UPDATE';

const BASE = '/api/v2/users';
const QK = 'users';

/** Open role catalog (ADR-0022): every role select/filter/label comes from the /roles feeds. */
function useRoleOptions(): RoleOption[] {
  return (
    useQuery({
      queryKey: ['roles', 'options'],
      queryFn: () => api<RoleOption[]>('GET', '/api/v2/roles/options'),
    }).data ?? []
  );
}

export function UsersPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const roleOptions = useRoleOptions();
  const [active, setActive] = useState('');
  const [toggleConflict, setToggleConflict] = useState<UserView | null>(null);
  // The user whose password the admin is resetting (3-way dialog: email / view / set a password).
  const [resetting, setResetting] = useState<UserView | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  // KN-3: focus-trap the export-failed alert (mirror RolesPage's toggle-error dialog) so focus moves
  // into it, Escape closes, and focus restores to the trigger — not left behind the modal.
  const exportErrorRef = useFocusTrap<HTMLDivElement>(!!exportError, () => setExportError(null));

  const toggle = useMutation({
    mutationFn: (u: UserView) =>
      api<UserView>('POST', `${BASE}/${u.id}/${u.isActive ? 'deactivate' : 'activate'}`, {
        version: u.version, // OCC: (de)activation is a version-guarded edit (ADR-0019)
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: [QK] }),
    onError: (e: unknown, u: UserView) => {
      if (isStale(e)) setToggleConflict(u); // someone else changed this user first
    },
  });

  const unlock = useMutation({
    mutationFn: (u: UserView) => api<{ ok: true }>('POST', `${BASE}/${u.id}/unlock`),
    onSuccess: () => qc.invalidateQueries({ queryKey: [QK] }),
  });

  const columns = useMemo<DataGridColumn<UserView>[]>(
    () => [
      {
        id: 'employeeId',
        header: 'Employee ID',
        sortable: false,
        cell: (u) => <span className="font-mono text-xs">{u.employeeId ?? '—'}</span>,
      },
      {
        id: 'username',
        header: 'Username',
        sortable: true,
        filterable: true,
        cell: (u) => <span className="font-mono text-xs">{u.username}</span>,
      },
      { id: 'name', header: 'Name', sortable: true, filterable: true, cell: (u) => u.name },
      {
        id: 'phone',
        header: 'Phone',
        cell: (u) => <span className="text-muted-foreground">{u.phone ?? '—'}</span>,
      },
      {
        id: 'role',
        header: 'Role',
        sortable: true,
        filterable: true,
        filterOptions: roleOptions.map((r) => ({ value: r.code, label: r.name })),
        cell: (u) => u.role.replace(/_/g, ' '),
      },
      {
        id: 'departmentName',
        header: 'Department',
        cell: (u) => <span className="text-muted-foreground">{u.departmentName ?? '—'}</span>,
      },
      {
        id: 'designationName',
        header: 'Designation',
        cell: (u) => <span className="text-muted-foreground">{u.designationName ?? '—'}</span>,
      },
      {
        id: 'reportsTo',
        header: 'Reports To',
        sortable: true,
        cell: (u) => <span className="text-muted-foreground">{u.reportsToName ?? '—'}</span>,
      },
      {
        id: 'effectiveFrom',
        header: 'Effective From',
        sortable: true,
        cell: (u) => <span className="text-xs text-muted-foreground">{formatDateTime(u.effectiveFrom)}</span>,
      },
      {
        id: 'createdAt',
        header: 'Created',
        sortable: true,
        cell: (u) => <span className="text-xs text-muted-foreground">{formatDateTime(u.createdAt)}</span>,
      },
      {
        id: 'updatedAt',
        header: 'Updated',
        sortable: true,
        cell: (u) => <span className="text-xs text-muted-foreground">{formatDateTime(u.updatedAt)}</span>,
      },
      {
        id: 'status',
        header: 'Status',
        sortable: true,
        cell: (u) => <StatusChip isActive={u.isActive} effectiveFrom={u.effectiveFrom} />,
      },
      {
        id: 'actions',
        header: 'Actions',
        align: 'right',
        cell: (u) => (
          <div className="flex items-center justify-end gap-2 whitespace-nowrap">
            <Button variant="secondary" size="sm" onClick={() => navigate(`/admin/users/${u.id}`)}>
              Edit
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setResetting(u)}>
              Reset Pwd
            </Button>
            <Button variant="secondary" size="sm" onClick={() => unlock.mutate(u)}>
              Unlock
            </Button>
            <Button
              variant={u.isActive ? 'destructive' : 'secondary'}
              size="sm"
              onClick={() => toggle.mutate(u)}
            >
              {u.isActive ? 'Deactivate' : 'Activate'}
            </Button>
          </div>
        ),
      },
    ],
    [toggle, unlock, roleOptions],
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight">User Management</h1>
          <p className="text-sm text-muted-foreground">
            People who operate the system — identity, role, and reporting line.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ImportButton config={{ basePath: BASE, queryKey: QK, entityLabel: 'user' }} label="Import Users" />
          {/* Bulk assignment (ADR-0022): spreadsheet import + all-assignments export of data scope */}
          <ImportButton
            config={{ basePath: `${BASE}/scope`, queryKey: 'user-scope', entityLabel: 'scope assignment' }}
            label="Import Scope"
          />
          <Button
            variant="secondary"
            onClick={async () => {
              try {
                // Route through apiExport (B-13/B3 contract): a large export ≥ the job threshold
                // returns 202 + a background job instead of a synchronous blob (mirrors the DataGrid).
                const out = await apiExport(`${BASE}/scope/export?mode=all&format=xlsx`);
                if (out.kind === 'job') {
                  toast('Export started in the background', {
                    description: 'You’ll be notified when the scope export is ready to download.',
                  });
                  return;
                }
                const url = URL.createObjectURL(out.blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = out.filename;
                document.body.appendChild(a);
                a.click();
                a.remove();
                URL.revokeObjectURL(url);
              } catch (e) {
                setExportError(e instanceof Error ? e.message : 'Export failed');
              }
            }}
          >
            <DownloadIcon />
            Export Scope
          </Button>
          <Button onClick={() => navigate('/admin/users/new')}>+ New</Button>
        </div>
      </div>

      <DataGrid<UserView>
        columns={columns}
        queryKey={QK}
        selectable
        bulkActions={(sel) => <BulkStatusActions selection={sel} basePath={BASE} queryKey={QK} />}
        rowId={(u) => u.id}
        defaultSort="name"
        searchPlaceholder="Search username or name…"
        filters={{ active: active || undefined }}
        fetchPage={(query: PageQuery) =>
          api<Paginated<UserView>>('GET', `${BASE}?${pageQueryToParams(query).toString()}`)
        }
        dateFilters={[
          { id: 'createdAt', label: 'Created' },
          { id: 'effectiveFrom', label: 'Effective From' },
        ]}
        exportFn={(req: ExportRequest) => apiExport(`${BASE}/export?${exportQueryToParams(req).toString()}`)}
        toolbar={
          <select
            className="input w-[10rem]"
            aria-label="Filter by status"
            value={active}
            onChange={(e) => setActive(e.target.value)}
          >
            <option value="">All statuses</option>
            <option value="true">Active</option>
            <option value="false">Inactive</option>
          </select>
        }
      />

      {exportError && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40">
          <div
            ref={exportErrorRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="users-export-error-title"
            className="w-full max-w-sm rounded-lg border border-border bg-card p-6 text-card-foreground shadow-lg"
          >
            <h2 id="users-export-error-title" className="mb-2 text-lg font-semibold">
              Export failed
            </h2>
            <p className="mb-4 text-sm text-muted-foreground">{exportError}</p>
            <div className="flex justify-end">
              <Button onClick={() => setExportError(null)}>OK</Button>
            </div>
          </div>
        </div>
      )}

      {resetting && <ResetPasswordDialog user={resetting} onClose={() => setResetting(null)} />}

      {toggleConflict && (
        <ConflictDialog
          entityLabel="user"
          current={undefined}
          onReload={() => {
            qc.invalidateQueries({ queryKey: [QK] });
            setToggleConflict(null);
          }}
          onDiscard={() => {
            qc.invalidateQueries({ queryKey: [QK] });
            setToggleConflict(null);
          }}
        />
      )}
    </div>
  );
}

/**
 * Admin reset-password dialog. Three ways to issue a ONE-TIME password (the user is forced to change
 * it on first login in all three): email it to the user, generate-and-view it, or set a specific one
 * (complexity-checked). Email omits the plaintext when it actually sends; otherwise the password is
 * shown so the admin can deliver it manually.
 */
function ResetPasswordDialog({ user, onClose }: { user: UserView; onClose: () => void }) {
  const [typing, setTyping] = useState(false); // "set a password" sub-form is open
  const [typed, setTyped] = useState('');
  const [result, setResult] = useState<{ kind: 'view' | 'email' | 'set'; password?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useFocusTrap<HTMLDivElement>(true, onClose);

  const genTemp = useMutation({
    mutationFn: (deliver: 'view' | 'email') =>
      api<TempPasswordResponse>('POST', `${BASE}/${user.id}/generate-temp-password`, { deliver }),
    onSuccess: (res) =>
      // a successful email returns no plaintext; otherwise show the password (view, or email fallback)
      setResult({
        kind: res.emailed ? 'email' : 'view',
        ...(res.temporaryPassword ? { password: res.temporaryPassword } : {}),
      }),
    onError: () => setError('Could not reset the password. Please try again.'),
  });
  const setPwd = useMutation({
    mutationFn: () => api('POST', `${BASE}/${user.id}/password`, { password: typed, mustChange: true }),
    onSuccess: () => setResult({ kind: 'set' }),
    onError: () => setError('Could not set the password. Please try again.'),
  });
  const busy = genTemp.isPending || setPwd.isPending;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="reset-pwd-title"
        className="w-full max-w-md rounded-lg border border-border bg-card p-6 text-card-foreground shadow-lg"
      >
        <h2 id="reset-pwd-title" className="mb-1 text-lg font-semibold">
          Reset password — {user.username}
        </h2>

        {result ? (
          <div className="space-y-3">
            {result.kind === 'email' ? (
              <p className="text-sm text-foreground">
                ✓ A one-time password was emailed to <span className="font-medium">{user.email}</span>.{' '}
                {user.name} must change it on first login.
              </p>
            ) : result.kind === 'set' ? (
              <p className="text-sm text-foreground">
                ✓ Password set. {user.name} must change it on first login.
              </p>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  Copy this now — it is shown only once. {user.name} must change it on first login.
                </p>
                <code className="block select-all rounded border border-border bg-muted px-3 py-2 font-mono text-sm">
                  {result.password}
                </code>
              </>
            )}
            <div className="flex justify-end">
              <Button onClick={onClose}>Done</Button>
            </div>
          </div>
        ) : typing ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Set a one-time password. {user.name} must change it on first login.
            </p>
            <Input
              className="input"
              type="password"
              uppercase={false}
              autoComplete="new-password"
              placeholder="New password"
              value={typed}
              autoFocus
              onChange={(e) => setTyped(e.target.value)}
            />
            {typed.length > 0 && <PasswordPolicyChecklist password={typed} />}
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setTyping(false)} disabled={busy}>
                Back
              </Button>
              <Button
                onClick={() => {
                  setError(null);
                  setPwd.mutate();
                }}
                disabled={busy || !isPasswordStrong(typed)}
                loading={setPwd.isPending}
              >
                Set password
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="mb-2 text-sm text-muted-foreground">
              Issue a one-time password — the user must change it on first login.
            </p>
            <button
              className="block w-full rounded-md border border-border px-3 py-2 text-left text-sm hover:bg-accent disabled:opacity-50"
              disabled={busy || !user.email}
              onClick={() => {
                setError(null);
                genTemp.mutate('email');
              }}
            >
              <span className="font-medium">Reset & email</span>
              <span className="block text-xs text-muted-foreground">
                {user.email ? `Email it to ${user.email}` : 'No email on file for this user'}
              </span>
            </button>
            <button
              className="block w-full rounded-md border border-border px-3 py-2 text-left text-sm hover:bg-accent disabled:opacity-50"
              disabled={busy}
              onClick={() => {
                setError(null);
                genTemp.mutate('view');
              }}
            >
              <span className="font-medium">Reset & view</span>
              <span className="block text-xs text-muted-foreground">
                Generate one and show it to you once
              </span>
            </button>
            <button
              className="block w-full rounded-md border border-border px-3 py-2 text-left text-sm hover:bg-accent disabled:opacity-50"
              disabled={busy}
              onClick={() => {
                setError(null);
                setTyping(true);
              }}
            >
              <span className="font-medium">Set a password</span>
              <span className="block text-xs text-muted-foreground">
                Type one that meets the complexity rules
              </span>
            </button>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="flex justify-end pt-1">
              <Button variant="ghost" onClick={onClose} disabled={busy}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
