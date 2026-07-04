import { useMemo, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ROLE_HIERARCHY_MODES,
  CreateRoleSchema,
  UpdateRoleSchema,
  type AccessMatrix,
  type RoleDimensionWiring,
  type RoleHierarchyMode,
  type RoleOption,
  type RoleView,
  type ScopeDimensionInfo,
} from '@crm2/sdk';
import { api, ApiError } from '../../lib/sdk.js';
import { zodFieldErrors } from '../../lib/zodForm.js';
import { useAuth } from '../../lib/AuthContext.js';
import { ConflictDialog } from '../../components/ConflictDialog.js';
import { Button } from '../../components/ui/Button.js';
import { Input } from '../../components/ui/Input.js';
import { TextArea } from '../../components/ui/TextArea.js';
import { HexagonLoader } from '../../components/ui/HexagonLoader.js';

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

/**
 * Role create/edit as a full record-page route (ADR-0051 — no modal). `/admin/rbac/new` creates;
 * `/admin/rbac/:code` loads that role by code and edits it (deep-linkable). RBAC: `role.manage` only
 * (the server enforces it on POST/PUT too); a viewer who deep-links here is bounced back to the list.
 */
export function RoleRecordPage() {
  const { code } = useParams();
  const navigate = useNavigate();
  const { has } = useAuth();
  const isEdit = !!code;
  const existing = useQuery({
    queryKey: [QK, code],
    queryFn: () => api<RoleView>('GET', `${BASE}/${code}`),
    enabled: isEdit,
  });

  if (!has('role.manage')) return <Navigate to="/admin/rbac" replace />;
  if (isEdit && existing.isLoading) {
    return (
      <div className="py-10">
        <HexagonLoader operation="Loading role" />
      </div>
    );
  }
  if (isEdit && (existing.isError || !existing.data)) {
    return (
      <div className="space-y-3">
        <Button variant="link" size="sm" onClick={() => navigate('/admin/rbac')}>
          ← Back to access control
        </Button>
        <p className="text-sm text-muted-foreground">Couldn’t load this role.</p>
      </div>
    );
  }
  // Re-mount the form per record (key) so its state seeds cleanly from the loaded role.
  return <RoleForm key={code ?? 'new'} initial={existing.data ?? null} />;
}

function RoleForm({ initial }: { initial: RoleView | null }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const isEdit = !!initial;
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

  const [code, setCode] = useState(initial?.code ?? '');
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [hierarchyMode, setHierarchyMode] = useState<RoleHierarchyMode>(initial?.hierarchyMode ?? 'SELF');
  const [reportsToRole, setReportsToRole] = useState(initial?.reportsToRole ?? '');
  // Password rotation (per-role policy): '' = never expire; new roles default to 90 days.
  const [pwExpiry, setPwExpiry] = useState(
    initial ? (initial.passwordExpiryDays != null ? String(initial.passwordExpiryDays) : '') : '90',
  );
  // Web idle auto-logout (ADR-0045): '' = exempt; new roles default to 10-min idle / 720-min (12h) cap.
  const [idleLogout, setIdleLogout] = useState(
    initial ? (initial.idleLogoutMinutes != null ? String(initial.idleLogoutMinutes) : '') : '10',
  );
  const [maxSession, setMaxSession] = useState(
    initial ? (initial.maxSessionMinutes != null ? String(initial.maxSessionMinutes) : '') : '720',
  );
  // New-device login OTP (ADR-0088); new roles default ON (FIELD_AGENT is seeded OFF until the
  // OTP-capable mobile app releases — flipping this toggle is that release gate).
  const [otpLogin, setOtpLogin] = useState(initial ? initial.otpLoginRequired : true);
  // Fixed trusted-device window (hours): office 24, FIELD_AGENT 720 (30d).
  const [otpTrust, setOtpTrust] = useState(initial ? String(initial.otpTrustHours) : '24');
  const [permissions, setPermissions] = useState<Set<string>>(new Set(initial?.permissions ?? []));
  const [wiring, setWiring] = useState<Map<string, RoleDimensionWiring['mode']>>(
    new Map((initial?.dimensions ?? []).map((d) => [d.dimension, d.mode])),
  );
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [version, setVersion] = useState(initial?.version ?? 0);
  const [conflict, setConflict] = useState<{ updatedAt?: string; version?: number } | null>(null);

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
        otpLoginRequired: otpLogin,
        ...(otpTrust.trim() === '' ? {} : { otpTrustHours: Number(otpTrust) }),
        dimensions,
      };
      if (!isEdit) {
        return api<RoleView>('POST', BASE, {
          code: code.toUpperCase(),
          ...body,
          permissions: [...permissions].sort(),
        });
      }
      // edit = config first, then the permission set with the FRESH version from the config write
      const updated = await api<RoleView>('PUT', `${BASE}/${initial!.code}`, { ...body, version });
      return api<RoleView>('PUT', `${BASE}/${initial!.code}/permissions`, {
        permissions: [...permissions].sort(),
        version: updated.version,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [QK] });
      qc.invalidateQueries({ queryKey: ['access', 'matrix'] });
      navigate('/admin/rbac');
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

  const canSave = !!name.trim() && (isEdit || /^[A-Z][A-Z0-9_]{1,19}$/.test(code.toUpperCase()));

  return (
    <div className="space-y-4">
      <Button variant="link" size="sm" onClick={() => navigate('/admin/rbac')}>
        ← Back to access control
      </Button>
      <div>
        <h1 className="text-xl font-bold tracking-tight">{isEdit ? 'Edit' : 'New'} Role</h1>
        <p className="text-sm text-muted-foreground">
          Roles define permissions; the admin decides what each role sees (hierarchy) and which scope
          dimensions its users can be assigned.
        </p>
      </div>

      <div className="max-w-3xl space-y-4 rounded-lg border border-border bg-card p-6 shadow-sm">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-foreground">
              Code (UPPER_SNAKE, immutable)
            </span>
            <Input
              className="input font-mono"
              uppercase={false}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="ZONE_AUDITOR"
              readOnly={isEdit}
              disabled={isEdit}
            />
            {fieldErrors['code'] && (
              <span className="mt-1 block text-xs text-destructive">{fieldErrors['code']}</span>
            )}
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-foreground">Name</span>
            <Input className="input" value={name} onChange={(e) => setName(e.target.value)} />
            {fieldErrors['name'] && (
              <span className="mt-1 block text-xs text-destructive">{fieldErrors['name']}</span>
            )}
          </label>
        </div>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-foreground">Description</span>
          <TextArea
            className="input min-h-[3.5rem]"
            value={description ?? ''}
            onChange={(e) => setDescription(e.target.value)}
          />
          {fieldErrors['description'] && (
            <span className="mt-1 block text-xs text-destructive">{fieldErrors['description']}</span>
          )}
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
            {fieldErrors['hierarchyMode'] && (
              <span className="mt-1 block text-xs text-destructive">{fieldErrors['hierarchyMode']}</span>
            )}
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
            {fieldErrors['reportsToRole'] && (
              <span className="mt-1 block text-xs text-destructive">{fieldErrors['reportsToRole']}</span>
            )}
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
          {fieldErrors['passwordExpiryDays'] && (
            <span className="mt-1 block text-xs text-destructive">{fieldErrors['passwordExpiryDays']}</span>
          )}
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
          {fieldErrors['idleLogoutMinutes'] && (
            <span className="mt-1 block text-xs text-destructive">{fieldErrors['idleLogoutMinutes']}</span>
          )}
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
          {fieldErrors['maxSessionMinutes'] && (
            <span className="mt-1 block text-xs text-destructive">{fieldErrors['maxSessionMinutes']}</span>
          )}
        </label>

        <label className="flex max-w-xs items-start gap-2">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 accent-primary"
            checked={otpLogin}
            onChange={(e) => setOtpLogin(e.target.checked)}
          />
          <span>
            <span className="block text-xs font-medium text-foreground">
              Require a sign-in code on new devices
            </span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              Email + SMS OTP on unrecognized devices (ADR-0088). Keep OFF for field agents until the
              OTP-capable mobile app is released. Authenticator (TOTP) users are never asked.
            </span>
          </span>
        </label>

        {otpLogin && (
          <label className="block max-w-xs">
            <span className="mb-1 block text-xs font-medium text-foreground">
              Device trust window (hours)
            </span>
            <input
              className="input"
              type="number"
              min={1}
              max={8760}
              value={otpTrust}
              onChange={(e) => setOtpTrust(e.target.value)}
            />
            <span className="mt-1 block text-xs text-muted-foreground">
              A device re-asks for a code this many hours after its last one, regardless of activity. Office
              roles 24 (daily); field agents 720 (30 days).
            </span>
            {fieldErrors['otpTrustHours'] && (
              <span className="mt-1 block text-xs text-destructive">{fieldErrors['otpTrustHours']}</span>
            )}
          </label>
        )}

        <div className="rounded-md border border-border p-3">
          <p className="mb-2 text-sm font-medium text-foreground">Assignable scope dimensions</p>
          <p className="mb-3 text-xs text-muted-foreground">
            What an admin can attach to users of this role. EXPAND adds visibility on top of the hierarchy;
            RESTRICT caps it to the assigned set.
          </p>
          {fieldErrors['dimensions'] && (
            <span className="mb-2 block text-xs text-destructive">{fieldErrors['dimensions']}</span>
          )}
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
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={() => navigate('/admin/rbac')} disabled={mut.isPending}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              setError(null);
              // Validate the EXACT payload the mutationFn posts against the canonical schema.
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
              const errs = isEdit
                ? zodFieldErrors(UpdateRoleSchema, { ...body, version })
                : zodFieldErrors(CreateRoleSchema, {
                    code: code.toUpperCase(),
                    ...body,
                    permissions: [...permissions].sort(),
                  });
              if (Object.keys(errs).length > 0) {
                setFieldErrors(errs);
                return;
              }
              setFieldErrors({});
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
            navigate('/admin/rbac');
          }}
        />
      )}
    </div>
  );
}
