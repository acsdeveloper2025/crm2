import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  exportQueryToParams,
  pageQueryToParams,
  ROLE_HIERARCHY_MODES,
  type AccessMatrix,
  type ExportRequest,
  type PageQuery,
  type Paginated,
  type RoleDimensionWiring,
  type RoleHierarchyMode,
  type RoleOption,
  type RoleView,
  type ScopeDimensionInfo,
} from '@crm2/sdk';
import { api, apiExport, ApiError } from '../../lib/sdk.js';
import { useAuth } from '../../lib/AuthContext.js';
import { formatDateTime } from '../../lib/format.js';
import { useFocusTrap } from '../../lib/useFocusTrap.js';
import { StatusChip } from '../../components/StatusChip.js';
import { ConflictDialog } from '../../components/ConflictDialog.js';
import { DataGrid, type DataGridColumn } from '../../components/ui/data-grid/index.js';
import { Button } from '../../components/ui/Button.js';
import { Input } from '../../components/ui/Input.js';
import { TextArea } from '../../components/ui/TextArea.js';

const BASE = '/api/v2/roles';
const QK = 'roles';
const HTTP_CONFLICT = 409;
const isStale = (e: unknown): e is ApiError =>
  e instanceof ApiError && e.status === HTTP_CONFLICT && e.code === 'STALE_UPDATE';

const MODE_LABELS: Record<RoleHierarchyMode, string> = {
  ALL: 'All data',
  SUBTREE: 'Own subtree',
  DIRECT_TEAM: 'Direct team',
  SELF: 'Self only',
};

export function RolesPage() {
  const qc = useQueryClient();
  // Mirror the server write guard (role.manage) so viewers don't see write controls (H-1).
  const { has } = useAuth();
  const canManage = has('role.manage');
  const [active, setActive] = useState('');
  const [editing, setEditing] = useState<RoleView | null | undefined>(undefined);
  const [toggleConflict, setToggleConflict] = useState<RoleView | null>(null);
  const [toggleError, setToggleError] = useState<string | null>(null);

  const toggle = useMutation({
    mutationFn: (r: RoleView) =>
      api<RoleView>('POST', `${BASE}/${r.code}/${r.isActive ? 'deactivate' : 'activate'}`, {
        version: r.version, // OCC (ADR-0019)
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: [QK] }),
    onError: (e: unknown, r: RoleView) => {
      if (isStale(e)) setToggleConflict(r);
      else if (e instanceof ApiError && e.code === 'ROLE_IN_USE')
        setToggleError(`${r.code} still has active users — reassign them before deactivating.`);
      else if (e instanceof ApiError && e.code === 'ROLE_LOCKED')
        setToggleError(`${r.code} is a system role and cannot be deactivated.`);
      else setToggleError(e instanceof Error ? e.message : 'Action failed');
    },
  });

  const columns = useMemo<DataGridColumn<RoleView>[]>(
    () => [
      {
        id: 'code',
        header: 'Code',
        sortable: true,
        filterable: true,
        cell: (r) => <span className="font-mono text-xs">{r.code}</span>,
      },
      { id: 'name', header: 'Name', sortable: true, filterable: true, cell: (r) => r.name },
      {
        id: 'hierarchyMode',
        header: 'Sees',
        sortable: true,
        cell: (r) => <span className="text-muted-foreground">{MODE_LABELS[r.hierarchyMode]}</span>,
      },
      {
        id: 'reportsToRole',
        header: 'Reports To',
        cell: (r) => <span className="text-muted-foreground">{r.reportsToRole ?? '—'}</span>,
      },
      {
        id: 'permissions',
        header: 'Permissions',
        cell: (r) =>
          r.grantsAll ? (
            <span className="font-medium text-primary">ALL</span>
          ) : (
            <span className="text-muted-foreground">{r.permissions.length}</span>
          ),
      },
      {
        id: 'passwordExpiryDays',
        header: 'Password Expiry',
        cell: (r) => (
          <span className="text-muted-foreground">
            {r.passwordExpiryDays != null ? `${r.passwordExpiryDays} days` : 'Never'}
          </span>
        ),
      },
      {
        id: 'idleLogoutMinutes',
        header: 'Idle Logout',
        cell: (r) => (
          <span className="text-muted-foreground">
            {r.idleLogoutMinutes != null ? `${r.idleLogoutMinutes} min` : 'Exempt'}
          </span>
        ),
      },
      {
        id: 'maxSessionMinutes',
        header: 'Max Session',
        cell: (r) => (
          <span className="text-muted-foreground">
            {r.maxSessionMinutes != null ? `${r.maxSessionMinutes} min` : 'No cap'}
          </span>
        ),
      },
      {
        id: 'dimensions',
        header: 'Scope Dimensions',
        cell: (r) =>
          r.dimensions.length === 0 ? (
            <span className="text-muted-foreground">—</span>
          ) : (
            <span className="text-xs text-muted-foreground">
              {r.dimensions.map((d) => `${d.dimension} (${d.mode})`).join(', ')}
            </span>
          ),
      },
      {
        id: 'kind',
        header: 'Kind',
        cell: (r) => (
          <span className="text-xs text-muted-foreground">{r.isSystem ? 'SYSTEM' : 'CUSTOM'}</span>
        ),
      },
      {
        id: 'createdAt',
        header: 'Created',
        sortable: true,
        cell: (r) => <span className="text-xs text-muted-foreground">{formatDateTime(r.createdAt)}</span>,
      },
      {
        id: 'updatedAt',
        header: 'Updated',
        sortable: true,
        cell: (r) => <span className="text-xs text-muted-foreground">{formatDateTime(r.updatedAt)}</span>,
      },
      {
        id: 'status',
        header: 'Status',
        sortable: true,
        cell: (r) => <StatusChip isActive={r.isActive} effectiveFrom={r.createdAt} />,
      },
      ...(canManage
        ? [
            {
              id: 'actions',
              header: 'Actions',
              align: 'right',
              cell: (r: RoleView) => (
                <div className="flex items-center justify-end gap-2 whitespace-nowrap">
                  <Button variant="secondary" size="sm" disabled={r.grantsAll} onClick={() => setEditing(r)}>
                    {r.grantsAll ? 'Locked' : 'Edit'}
                  </Button>
                  {!r.isSystem && (
                    <Button
                      variant={r.isActive ? 'destructive' : 'secondary'}
                      size="sm"
                      onClick={() => toggle.mutate(r)}
                    >
                      {r.isActive ? 'Deactivate' : 'Activate'}
                    </Button>
                  )}
                </div>
              ),
            } satisfies DataGridColumn<RoleView>,
          ]
        : []),
    ],
    [toggle, canManage],
  );

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Access Control</h1>
          <p className="text-sm text-muted-foreground">
            Roles define permissions; the admin decides what each role sees (hierarchy) and which scope
            dimensions its users can be assigned. System roles are delete-locked; Super Admin is fully locked.
          </p>
        </div>
        {canManage && <Button onClick={() => setEditing(null)}>+ New Role</Button>}
      </div>

      <DataGrid<RoleView>
        columns={columns}
        queryKey={QK}
        rowId={(r) => r.code}
        defaultSort="code"
        searchPlaceholder="Search code or name…"
        filters={{ active: active || undefined }}
        fetchPage={(query: PageQuery) =>
          api<Paginated<RoleView>>('GET', `${BASE}?${pageQueryToParams(query).toString()}`)
        }
        dateFilters={[{ id: 'createdAt', label: 'Created' }]}
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

      {toggleError && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40">
          <div className="w-full max-w-sm rounded-lg border border-border bg-card p-6 text-card-foreground shadow-lg">
            <h2 className="mb-2 text-lg font-semibold">Cannot deactivate</h2>
            <p className="mb-4 text-sm text-muted-foreground">{toggleError}</p>
            <div className="flex justify-end">
              <Button onClick={() => setToggleError(null)}>OK</Button>
            </div>
          </div>
        </div>
      )}

      {editing !== undefined && <RoleDialog row={editing} onClose={() => setEditing(undefined)} />}

      {toggleConflict && (
        <ConflictDialog
          entityLabel="role"
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

function RoleDialog({ row, onClose }: { row: RoleView | null; onClose: () => void }) {
  const qc = useQueryClient();
  const isEdit = !!row;
  // permission catalog (labels + groups) — the matrix endpoint owns display metadata
  const matrix = useQuery({
    queryKey: ['access', 'matrix'],
    queryFn: () => api<AccessMatrix>('GET', '/api/v2/access/matrix'),
  }).data;
  const dimensionCatalog =
    useQuery({
      queryKey: [QK, 'dimensions'],
      queryFn: () => api<ScopeDimensionInfo[]>('GET', `${BASE}/dimensions`),
    }).data ?? [];
  const roleOptions =
    useQuery({
      queryKey: [QK, 'options'],
      queryFn: () => api<RoleOption[]>('GET', `${BASE}/options`),
    }).data ?? [];

  const [code, setCode] = useState(row?.code ?? '');
  const [name, setName] = useState(row?.name ?? '');
  const [description, setDescription] = useState(row?.description ?? '');
  const [hierarchyMode, setHierarchyMode] = useState<RoleHierarchyMode>(row?.hierarchyMode ?? 'SELF');
  const [reportsToRole, setReportsToRole] = useState(row?.reportsToRole ?? '');
  // Password rotation (per-role policy): '' = never expire; new roles default to 90 days.
  const [pwExpiry, setPwExpiry] = useState(
    row ? (row.passwordExpiryDays != null ? String(row.passwordExpiryDays) : '') : '90',
  );
  // Web idle auto-logout (ADR-0045): '' = exempt; new roles default to 10-min idle / 720-min (12h) cap.
  const [idleLogout, setIdleLogout] = useState(
    row ? (row.idleLogoutMinutes != null ? String(row.idleLogoutMinutes) : '') : '10',
  );
  const [maxSession, setMaxSession] = useState(
    row ? (row.maxSessionMinutes != null ? String(row.maxSessionMinutes) : '') : '720',
  );
  const [permissions, setPermissions] = useState<Set<string>>(new Set(row?.permissions ?? []));
  const [wiring, setWiring] = useState<Map<string, RoleDimensionWiring['mode']>>(
    new Map((row?.dimensions ?? []).map((d) => [d.dimension, d.mode])),
  );
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(row?.version ?? 0);
  const [conflict, setConflict] = useState<{ updatedAt?: string; version?: number } | null>(null);
  const dialogRef = useFocusTrap<HTMLDivElement>(true, onClose);

  const byGroup = useMemo(() => {
    const groups = new Map<string, AccessMatrix['permissions']>();
    for (const p of matrix?.permissions ?? []) groups.set(p.group, [...(groups.get(p.group) ?? []), p]);
    return groups;
  }, [matrix]);

  const hasRestrict = [...wiring.values()].includes('RESTRICT');
  const dimensions: RoleDimensionWiring[] = [...wiring.entries()].map(([dimension, mode]) => ({
    dimension,
    mode,
  }));

  const mut = useMutation({
    mutationFn: async () => {
      const body = {
        name,
        description,
        hierarchyMode,
        reportsToRole: reportsToRole || null,
        passwordExpiryDays: pwExpiry.trim() === '' ? null : Number(pwExpiry),
        idleLogoutMinutes: idleLogout.trim() === '' ? null : Number(idleLogout),
        maxSessionMinutes: maxSession.trim() === '' ? null : Number(maxSession),
        dimensions,
      };
      if (!isEdit) {
        return api<RoleView>('POST', BASE, { code, ...body, permissions: [...permissions].sort() });
      }
      // edit = config first, then the permission set with the FRESH version from the config write
      const updated = await api<RoleView>('PUT', `${BASE}/${row!.code}`, { ...body, version });
      return api<RoleView>('PUT', `${BASE}/${row!.code}/permissions`, {
        permissions: [...permissions].sort(),
        version: updated.version,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [QK] });
      qc.invalidateQueries({ queryKey: ['access', 'matrix'] });
      onClose();
    },
    onError: (e: unknown) => {
      if (isStale(e)) {
        const current = (e.body as { current?: { updatedAt?: string; version?: number } } | null)?.current;
        setConflict(current ?? {});
      } else if (e instanceof ApiError && e.code === 'ROLE_EXISTS') {
        setError('A role with this code already exists.');
      } else if (e instanceof ApiError && e.code === 'INVALID_REPORTS_TO_ROLE') {
        setError('Invalid reporting role (unknown, inactive, or it would form a cycle).');
      } else setError(e instanceof Error ? e.message : 'Save failed');
    },
  });

  const canSave = !!name.trim() && (isEdit || /^[A-Z][A-Z0-9_]{1,19}$/.test(code));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="role-dialog-title"
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-border bg-card p-6 text-card-foreground shadow-lg"
      >
        <h2 id="role-dialog-title" className="mb-4 text-lg font-semibold">
          {isEdit ? `Edit Role — ${row!.code}` : 'New Role'}
        </h2>
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-foreground">
                Code (UPPER_SNAKE, immutable)
              </span>
              <Input
                className="input font-mono"
                uppercase={false}
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="ZONE_AUDITOR"
                readOnly={isEdit}
                disabled={isEdit}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-foreground">Name</span>
              <Input className="input" value={name} onChange={(e) => setName(e.target.value)} />
            </label>
          </div>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-foreground">Description</span>
            <TextArea
              className="input min-h-[3.5rem]"
              value={description ?? ''}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-foreground">
                Data visibility (hierarchy)
              </span>
              <select
                className="input"
                value={hierarchyMode}
                onChange={(e) => setHierarchyMode(e.target.value as RoleHierarchyMode)}
              >
                {ROLE_HIERARCHY_MODES.map((m) => (
                  <option key={m} value={m}>
                    {MODE_LABELS[m]}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-foreground">
                Users of this role report to
              </span>
              <select
                className="input"
                value={reportsToRole ?? ''}
                onChange={(e) => setReportsToRole(e.target.value)}
              >
                <option value="">— None (top of a line) —</option>
                {roleOptions
                  .filter((o) => o.code !== code)
                  .map((o) => (
                    <option key={o.code} value={o.code}>
                      {o.name}
                    </option>
                  ))}
              </select>
            </label>
          </div>

          <label className="block max-w-xs">
            <span className="mb-1 block text-xs font-medium text-foreground">
              Force password change every (days)
            </span>
            <input
              className="input"
              type="number"
              min={1}
              max={3650}
              value={pwExpiry}
              onChange={(e) => setPwExpiry(e.target.value)}
              placeholder="Never"
            />
            <span className="mt-1 block text-xs text-muted-foreground">
              Leave blank to never expire (e.g. field agents and admins).
            </span>
          </label>

          <label className="block max-w-xs">
            <span className="mb-1 block text-xs font-medium text-foreground">
              Idle auto-logout after (minutes)
            </span>
            <input
              className="input"
              type="number"
              min={1}
              max={1440}
              value={idleLogout}
              onChange={(e) => setIdleLogout(e.target.value)}
              placeholder="Exempt"
            />
            <span className="mt-1 block text-xs text-muted-foreground">
              Web inactivity timeout. Leave blank to exempt (e.g. field agents).
            </span>
          </label>

          <label className="block max-w-xs">
            <span className="mb-1 block text-xs font-medium text-foreground">
              Maximum session length (minutes)
            </span>
            <input
              className="input"
              type="number"
              min={5}
              max={10080}
              value={maxSession}
              onChange={(e) => setMaxSession(e.target.value)}
              placeholder="No cap"
            />
            <span className="mt-1 block text-xs text-muted-foreground">
              Absolute lifetime; forces re-login even with activity. Leave blank for no cap.
            </span>
          </label>

          <div className="rounded-md border border-border p-3">
            <p className="mb-2 text-sm font-medium text-foreground">Assignable scope dimensions</p>
            <p className="mb-3 text-xs text-muted-foreground">
              What an admin can attach to users of this role. EXPAND adds visibility on top of the hierarchy;
              RESTRICT caps it to the assigned set.
            </p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {dimensionCatalog.map((d) => {
                const mode = wiring.get(d.code);
                return (
                  <div key={d.code} className="flex items-center gap-2">
                    <label className="flex flex-1 items-center gap-2">
                      <input
                        type="checkbox"
                        checked={mode !== undefined}
                        onChange={(e) => {
                          const next = new Map(wiring);
                          if (e.target.checked) next.set(d.code, 'EXPAND');
                          else next.delete(d.code);
                          setWiring(next);
                        }}
                      />
                      <span className="text-sm text-foreground">{d.label}</span>
                    </label>
                    {mode !== undefined && (
                      <select
                        className="input w-[8.5rem] py-1 text-xs"
                        aria-label={`${d.label} mode`}
                        value={mode}
                        onChange={(e) => {
                          const next = new Map(wiring);
                          next.set(d.code, e.target.value as RoleDimensionWiring['mode']);
                          setWiring(next);
                        }}
                      >
                        <option value="EXPAND">EXPAND</option>
                        <option value="RESTRICT">RESTRICT</option>
                      </select>
                    )}
                  </div>
                );
              })}
            </div>
            {hasRestrict && (
              <p className="mt-3 text-xs font-medium text-destructive">
                RESTRICT is fail-closed: until an admin assigns entities, users of this role see NOTHING for
                that dimension.
              </p>
            )}
          </div>

          <div className="rounded-md border border-border p-3">
            <p className="mb-2 text-sm font-medium text-foreground">Permissions</p>
            {[...byGroup.entries()].map(([group, perms]) => (
              <div key={group} className="mb-3">
                <p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">{group}</p>
                <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                  {perms.map((p) => (
                    <label key={p.code} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={permissions.has(p.code)}
                        onChange={(e) => {
                          const next = new Set(permissions);
                          if (e.target.checked) next.add(p.code);
                          else next.delete(p.code);
                          setPermissions(next);
                        }}
                      />
                      <span className="text-sm text-foreground">{p.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
            <p className="text-xs text-muted-foreground">
              Default-deny: a role holds exactly what is ticked here. Granting “Roles — Manage” makes a role
              able to change any role’s permissions — effectively admin-equivalent.
            </p>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <div className="mt-5 flex justify-end gap-2">
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
          entityLabel="role"
          current={conflict}
          onReload={() => {
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
