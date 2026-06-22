import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  exportQueryToParams,
  pageQueryToParams,
  type DepartmentOption,
  type DesignationOption,
  type ExportRequest,
  type PageQuery,
  type Paginated,
  type RoleOption,
  type RoleView,
  type TempPasswordResponse,
  type UserOption,
  type UserPolicyAcceptance,
  type UserRole,
  type UserView,
} from '@crm2/sdk';
import { api, apiBlob, apiExport, apiUpload, ApiError } from '../../lib/sdk.js';
import { formatDateTime, toDateInput, toIsoDate } from '../../lib/format.js';
import { useFocusTrap } from '../../lib/useFocusTrap.js';
import { BulkStatusActions } from '../../components/BulkStatusActions.js';
import { StatusChip } from '../../components/StatusChip.js';
import { ConflictDialog } from '../../components/ConflictDialog.js';
import { SessionList } from '../../components/SessionList.js';
import { UserPhoto } from '../../components/UserPhoto.js';
import { PasswordPolicyChecklist, isPasswordStrong } from '../../components/PasswordPolicyChecklist.js';
import { UserAccessSection, type StagedScope } from '../../components/UserAccessSection.js';
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

const ROLES_FETCH_LIMIT = 200;

/** The full role rows (dimension wiring drives the Access tab). Small config catalog. */
function useRoleCatalog(): RoleView[] {
  return (
    useQuery({
      queryKey: ['roles', 'catalog'],
      queryFn: async () =>
        (await api<Paginated<RoleView>>('GET', `/api/v2/roles?limit=${ROLES_FETCH_LIMIT}`)).items,
    }).data ?? []
  );
}

export function UsersPage() {
  const qc = useQueryClient();
  const roleOptions = useRoleOptions();
  const [active, setActive] = useState('');
  const [editing, setEditing] = useState<UserView | null | undefined>(undefined); // undefined=closed, null=create
  const [toggleConflict, setToggleConflict] = useState<UserView | null>(null);
  // The user whose password the admin is resetting (3-way dialog: email / view / set a password).
  const [resetting, setResetting] = useState<UserView | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

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
            <Button variant="secondary" size="sm" onClick={() => setEditing(u)}>
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
          <ImportButton config={{ basePath: BASE, queryKey: QK, entityLabel: 'user' }} />
          {/* Bulk assignment (ADR-0022): spreadsheet import + all-assignments export of data scope */}
          <ImportButton
            config={{ basePath: `${BASE}/scope`, queryKey: 'user-scope', entityLabel: 'scope assignment' }}
          />
          <Button
            variant="secondary"
            onClick={async () => {
              try {
                const { blob, filename } = await apiBlob(`${BASE}/scope/export?mode=all&format=xlsx`);
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = filename;
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
          <Button onClick={() => setEditing(null)}>+ New</Button>
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
          <div className="w-full max-w-sm rounded-lg border border-border bg-card p-6 text-card-foreground shadow-lg">
            <h2 className="mb-2 text-lg font-semibold">Export failed</h2>
            <p className="mb-4 text-sm text-muted-foreground">{exportError}</p>
            <div className="flex justify-end">
              <Button onClick={() => setExportError(null)}>OK</Button>
            </div>
          </div>
        </div>
      )}

      {resetting && <ResetPasswordDialog user={resetting} onClose={() => setResetting(null)} />}

      {editing !== undefined && <UserDialog row={editing} onClose={() => setEditing(undefined)} />}

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

function UserDialog({ row, onClose }: { row: UserView | null; onClose: () => void }) {
  const qc = useQueryClient();
  const isEdit = !!row;
  // Open role catalog (ADR-0022): the role picker, the role-aware reports-to filtering
  // (roles.reports_to_role) and the Access tab's dimension wiring all come from the roles feeds.
  const roleOptions = useRoleOptions();
  const roleCatalog = useRoleCatalog();
  const managers =
    useQuery({
      queryKey: ['users', 'managers'],
      queryFn: () => api<UserOption[]>('GET', `${BASE}/options`),
    }).data ?? [];
  const departments =
    useQuery({
      queryKey: ['departments', 'options'],
      queryFn: () => api<DepartmentOption[]>('GET', '/api/v2/departments/options'),
    }).data ?? [];
  const designations =
    useQuery({
      queryKey: ['designations', 'options'],
      queryFn: () => api<DesignationOption[]>('GET', '/api/v2/designations/options'),
    }).data ?? [];
  const [username, setUsername] = useState(row?.username ?? '');
  const [name, setName] = useState(row?.name ?? '');
  const [email, setEmail] = useState(row?.email ?? '');
  const [phone, setPhone] = useState(row?.phone ?? '');
  const [departmentId, setDepartmentId] = useState(row?.departmentId ? String(row.departmentId) : '');
  const [designationId, setDesignationId] = useState(row?.designationId ? String(row.designationId) : '');
  const [role, setRole] = useState<UserRole>(row?.role ?? 'FIELD_AGENT');
  const [reportsTo, setReportsTo] = useState(row?.reportsTo ?? '');
  const [password, setPassword] = useState('');
  const [mfaRequired, setMfaRequired] = useState(row?.mfaRequired ?? false);
  // CREATE mode: a photo staged before the user exists; uploaded right after create succeeds.
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  // Access tab (ADR-0022 slice 6): scope picks staged in create mode, applied post-create.
  const [tab, setTab] = useState<'profile' | 'access'>('profile');
  const [stagedScope, setStagedScope] = useState<StagedScope>({});
  const [effectiveFrom, setEffectiveFrom] = useState(toDateInput(row?.effectiveFrom));
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(row?.version ?? 0); // OCC token the edit started from
  const [conflict, setConflict] = useState<{ updatedAt?: string; version?: number } | null>(null);
  const dialogRef = useFocusTrap<HTMLDivElement>(true, onClose);

  // Reports-to is filtered to the role's configured reporting target; top roles report to no one.
  const managerRole = roleOptions.find((o) => o.code === role)?.reportsToRole ?? null;
  const managerOptions = managers.filter((m) => m.id !== row?.id && m.role === managerRole);
  const reportsToValid = !managerRole || managerOptions.some((m) => m.id === reportsTo);
  const roleDimensions = roleCatalog.find((r) => r.code === role)?.dimensions ?? [];

  const adminDisableMfa = useMutation({
    mutationFn: () => api<{ ok: true }>('POST', `/api/v2/auth/mfa/admin/${row!.id}/disable`),
    onError: (e: unknown) => setError(e instanceof Error ? e.message : 'Could not disable MFA'),
  });

  const mut = useMutation({
    mutationFn: () => {
      const payload = {
        name,
        role,
        phone,
        departmentId: departmentId ? Number(departmentId) : null,
        designationId: designationId ? Number(designationId) : null,
        ...(email ? { email } : isEdit ? { email: null } : {}),
        ...(managerRole && reportsTo ? { reportsTo } : isEdit ? { reportsTo: null } : {}),
        ...(toIsoDate(effectiveFrom) ? { effectiveFrom: toIsoDate(effectiveFrom) } : {}),
        ...(!isEdit && password ? { password } : {}),
        ...(isEdit ? { mfaRequired } : {}),
      };
      return isEdit
        ? api<UserView>('PUT', `${BASE}/${row!.id}`, { username, ...payload, version })
        : api<UserView>('POST', BASE, { username, ...payload });
    },
    onSuccess: async (saved) => {
      // CREATE mode: now that the user exists, upload the staged photo (best-effort — a created user
      // must not be lost if storage is unconfigured/unavailable; the photo can be added later in edit).
      if (!isEdit && photoFile) {
        try {
          await apiUpload(`${BASE}/${saved.id}/photo`, photoFile, photoFile.name);
        } catch {
          /* non-fatal: the user was created; the photo just wasn't stored */
        }
      }
      // CREATE mode: apply the staged Access-tab scope picks (best-effort, same pattern — anything
      // that fails can be added later in edit).
      if (!isEdit) {
        for (const [dimension, items] of Object.entries(stagedScope)) {
          const entityIds = items.map((i) => i.entityId).filter((x): x is number => x !== undefined);
          const entityValues = items.map((i) => i.entityValue).filter((x): x is string => x !== undefined);
          try {
            if (entityIds.length)
              await api('POST', `${BASE}/${saved.id}/scope-assignments`, { dimension, entityIds });
            if (entityValues.length)
              await api('POST', `${BASE}/${saved.id}/scope-assignments`, { dimension, entityValues });
          } catch {
            /* non-fatal: the user exists; remaining scope can be assigned in edit */
          }
        }
      }
      qc.invalidateQueries({ queryKey: [QK] });
      onClose();
    },
    onError: (e: unknown) => {
      if (isStale(e)) {
        const current = (e.body as { current?: { updatedAt?: string; version?: number } } | null)?.current;
        setConflict(current ?? {}); // open the conflict dialog with the fresh row
      } else if (e instanceof ApiError && e.code === 'USER_EXISTS') {
        setError('A user with this username already exists.');
      } else setError(e instanceof Error ? e.message : 'Save failed');
    },
  });

  // phone/department/designation are optional + nullable at the API (UpdateUserSchema) — the FE must
  // not hard-require them, or an existing user lacking them can never be saved. Validate phone FORMAT
  // (E.164) when provided; a complete profile is encouraged on CREATE but never blocks an edit.
  const phoneValid = !phone || /^\+?[1-9]\d{7,14}$/.test(phone);
  const canSave =
    !!name && username.length >= 3 && phoneValid && (isEdit || isPasswordStrong(password)) && reportsToValid;
  const saveDisabledReason = !name
    ? 'Enter a name.'
    : username.length < 3
      ? 'Username must be at least 3 characters.'
      : !phoneValid
        ? 'Phone must be E.164 (e.g. 9876543210 or +919876543210).'
        : !isEdit && !isPasswordStrong(password)
          ? 'Set an initial password: 8+ chars with upper, lower, a digit and a symbol.'
          : !reportsToValid
            ? 'Pick a valid reporting manager.'
            : '';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="user-dialog-title"
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg border border-border bg-card p-6 text-card-foreground shadow-lg"
      >
        <h2 id="user-dialog-title" className="mb-3 text-lg font-semibold">
          {isEdit ? 'Edit User' : 'New User'}
        </h2>
        <div className="mb-4 flex gap-1 border-b border-border" role="tablist">
          {(['profile', 'access'] as const).map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              className={`px-3 py-1.5 text-sm font-medium ${
                tab === t
                  ? 'border-b-2 border-primary text-primary'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              onClick={() => setTab(t)}
            >
              {t === 'profile' ? 'Profile' : 'Access'}
            </button>
          ))}
        </div>
        {tab === 'access' && (
          <UserAccessSection
            roleCode={role}
            dimensions={roleDimensions}
            {...(row ? { userId: row.id } : {})}
            staged={stagedScope}
            onStageChange={setStagedScope}
          />
        )}
        <div className={tab === 'profile' ? 'space-y-3' : 'hidden'}>
          {isEdit && (
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-foreground">Employee ID</span>
              <Input
                className="input font-mono"
                uppercase={false}
                value={row?.employeeId ?? ''}
                readOnly
                disabled
              />
              <span className="mt-1 block text-xs text-muted-foreground">Auto-generated and immutable.</span>
            </label>
          )}
          <div className="rounded-md border border-border p-3">
            {isEdit ? <UserPhoto userId={row!.id} /> : <UserPhoto onPick={setPhotoFile} />}
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-foreground">Username (lowercase)</span>
              <Input
                className="input"
                uppercase={false}
                value={username}
                onChange={(e) => setUsername(e.target.value.toLowerCase())}
                placeholder="jane_doe"
              />
              {isEdit && (
                <span className="mt-1 block text-xs text-muted-foreground">
                  Editable — a login rename (must stay unique).
                </span>
              )}
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-foreground">Full name</span>
              <Input className="input" value={name} onChange={(e) => setName(e.target.value)} />
            </label>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-foreground">Phone</span>
              <Input
                className="input"
                uppercase={false}
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+919876543210"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-foreground">Email (optional)</span>
              <Input
                className="input"
                uppercase={false}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-foreground">Department</span>
              <select
                className="input"
                value={departmentId}
                onChange={(e) => setDepartmentId(e.target.value)}
              >
                <option value="">— Select —</option>
                {departments.map((d) => (
                  <option key={d.id} value={String(d.id)}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-foreground">Designation</span>
              <select
                className="input"
                value={designationId}
                onChange={(e) => setDesignationId(e.target.value)}
              >
                <option value="">— Select —</option>
                {designations.map((d) => (
                  <option key={d.id} value={String(d.id)}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-foreground">Role</span>
              <select
                className="input"
                value={role}
                onChange={(e) => {
                  setRole(e.target.value as UserRole);
                  setReportsTo(''); // role change invalidates the manager pick
                  setStagedScope({}); // …and any staged scope (the new role's wiring may differ)
                }}
              >
                {roleOptions.map((r) => (
                  <option key={r.code} value={r.code}>
                    {r.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-foreground">
                Reports to{managerRole ? ` (a ${managerRole.replace(/_/g, ' ').toLowerCase()})` : ''}
              </span>
              <select
                className="input"
                value={reportsTo}
                disabled={!managerRole}
                onChange={(e) => setReportsTo(e.target.value)}
              >
                <option value="">{managerRole ? '— Select —' : '— None (top role) —'}</option>
                {managerOptions.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {!isEdit && (
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-foreground">Password</span>
              <Input
                type="password"
                className="input"
                uppercase={false}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="8+ chars, upper, lower, digit, symbol"
              />
              {password.length > 0 && (
                <div className="mt-2">
                  <PasswordPolicyChecklist password={password} />
                </div>
              )}
            </label>
          )}
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-foreground">
              Effective From (blank = now)
            </span>
            <input
              type="date"
              className="input"
              value={effectiveFrom}
              onChange={(e) => setEffectiveFrom(e.target.value)}
            />
          </label>
          {isEdit && (
            <div className="rounded-md border border-border p-3">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={mfaRequired}
                  onChange={(e) => setMfaRequired(e.target.checked)}
                />
                <span className="text-sm text-foreground">
                  Require MFA — the user must set up two-factor before their next sign-in
                </span>
              </label>
              <Button
                variant="destructive"
                size="sm"
                className="mt-2"
                loading={adminDisableMfa.isPending}
                onClick={() => adminDisableMfa.mutate()}
              >
                Disable this user’s MFA enrolment
              </Button>
            </div>
          )}
          {isEdit && (
            <div className="rounded-md border border-border p-3">
              <p className="mb-2 text-sm font-medium text-foreground">Active sessions</p>
              <SessionList userId={row!.id} />
            </div>
          )}
          {isEdit && <PolicyAcceptancesSection userId={row!.id} />}
        </div>
        {/* outside the tab toggle — a save failure stays visible from the Access tab too */}
        {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
        <div className="mt-5 flex items-center justify-end gap-2">
          {!canSave && saveDisabledReason && (
            <span className="mr-auto text-sm text-muted-foreground">{saveDisabledReason}</span>
          )}
          <Button variant="ghost" onClick={onClose} disabled={mut.isPending}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              setError(null);
              mut.mutate();
            }}
            disabled={!canSave}
            loading={mut.isPending}
          >
            Save
          </Button>
        </div>
      </div>

      {conflict && (
        <ConflictDialog
          entityLabel="user"
          current={conflict}
          onReload={() => {
            // adopt the latest version, keep the user's edits in the form, let them save again
            if (conflict.version !== undefined) setVersion(conflict.version);
            qc.invalidateQueries({ queryKey: [QK] });
            setConflict(null);
          }}
          onDiscard={() => {
            qc.invalidateQueries({ queryKey: [QK] });
            onClose();
          }}
        />
      )}
    </div>
  );
}

/**
 * Admin view of a user's policy-acceptance log (ADR-0043). Read-only — acceptances are recorded by
 * the user's own accept/login flow via the shared `consents` store and never written from here.
 * Empty + loading states muted; UA truncated to keep the row compact (full UA on hover via title).
 */
const UA_PREVIEW_LEN = 40;
const truncateUa = (ua: string | null): string =>
  ua ? (ua.length > UA_PREVIEW_LEN ? `${ua.slice(0, UA_PREVIEW_LEN)}…` : ua) : '—';

function PolicyAcceptancesSection({ userId }: { userId: string }) {
  const q = useQuery({
    queryKey: ['user-acceptances', userId],
    queryFn: () => api<UserPolicyAcceptance[]>('GET', `/api/v2/policies/users/${userId}/acceptances`),
  });

  return (
    <div className="rounded-md border border-border p-3">
      <p className="mb-2 text-sm font-medium text-foreground">Policy Acceptances</p>
      {q.isLoading ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : q.isError ? (
        <p className="text-xs text-destructive">Could not load acceptances.</p>
      ) : !q.data || q.data.length === 0 ? (
        <p className="text-xs text-muted-foreground">No policies accepted yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="py-1 pr-3 font-medium">Policy</th>
                <th className="py-1 pr-3 font-medium">Version</th>
                <th className="py-1 pr-3 font-medium">Accepted</th>
                <th className="py-1 pr-3 font-medium">IP</th>
                <th className="py-1 pr-3 font-medium">Source</th>
              </tr>
            </thead>
            <tbody>
              {q.data.map((a) => (
                <tr key={a.id} className="border-b border-border/50">
                  <td className="py-1 pr-3 text-foreground">{a.policyName ?? a.policyCode ?? '—'}</td>
                  <td className="py-1 pr-3 font-mono text-muted-foreground">{a.policyVersion}</td>
                  <td className="py-1 pr-3 text-muted-foreground">{formatDateTime(a.acceptedAt)}</td>
                  <td className="py-1 pr-3 font-mono text-muted-foreground">{a.ip ?? '—'}</td>
                  <td className="py-1 pr-3 text-muted-foreground" title={a.userAgent ?? undefined}>
                    {truncateUa(a.userAgent)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
