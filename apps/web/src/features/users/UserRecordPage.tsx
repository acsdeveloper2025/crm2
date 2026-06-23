import { useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type DepartmentOption,
  type DesignationOption,
  type Paginated,
  type RoleOption,
  type RoleView,
  type UserOption,
  type UserPolicyAcceptance,
  type UserRole,
  type UserView,
} from '@crm2/sdk';
import { api, apiUpload, ApiError } from '../../lib/sdk.js';
import { useAuth } from '../../lib/AuthContext.js';
import { formatDateTime, toDateInput, toIsoDate } from '../../lib/format.js';
import { ConflictDialog } from '../../components/ConflictDialog.js';
import { SessionList } from '../../components/SessionList.js';
import { UserPhoto } from '../../components/UserPhoto.js';
import { PasswordPolicyChecklist, isPasswordStrong } from '../../components/PasswordPolicyChecklist.js';
import { UserAccessSection, type StagedScope } from '../../components/UserAccessSection.js';
import { Button } from '../../components/ui/Button.js';
import { Input } from '../../components/ui/Input.js';
import { HexagonLoader } from '../../components/ui/HexagonLoader.js';
import { Tabs } from '../../components/ui/Tabs.js';
import { ScrollRegion } from '../../components/ui/ScrollRegion.js';

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

/**
 * User create/edit as a full record-page route (ADR-0051 Wave 4 — no modal). `/admin/users/new`
 * creates; `/admin/users/:id` loads that user by id and edits it (deep-linkable). RBAC: `user.manage`
 * only (the server enforces it on POST/PUT too); a viewer who deep-links here is bounced back to the
 * list. The stricter Access tab perm (`access_scope.assign`) is owned by UserAccessSection itself.
 */
export function UserRecordPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { has } = useAuth();
  const isEdit = !!id;
  const existing = useQuery({
    queryKey: [QK, id],
    queryFn: () => api<UserView>('GET', `${BASE}/${id}`),
    enabled: isEdit,
  });

  if (!has('user.manage')) return <Navigate to="/admin/users" replace />;
  if (isEdit && existing.isLoading) {
    return (
      <div className="py-10">
        <HexagonLoader operation="Loading user" />
      </div>
    );
  }
  if (isEdit && (existing.isError || !existing.data)) {
    return (
      <div className="space-y-3">
        <Button variant="link" size="sm" onClick={() => navigate('/admin/users')}>
          ← Back to users
        </Button>
        <p className="text-sm text-muted-foreground">Couldn’t load this user.</p>
      </div>
    );
  }
  // Re-mount the form per record (key) so its state seeds cleanly from the loaded user.
  return <UserForm key={id ?? 'new'} initial={existing.data ?? null} />;
}

function UserForm({ initial }: { initial: UserView | null }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const isEdit = !!initial;
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
  const [username, setUsername] = useState(initial?.username ?? '');
  const [name, setName] = useState(initial?.name ?? '');
  const [email, setEmail] = useState(initial?.email ?? '');
  const [phone, setPhone] = useState(initial?.phone ?? '');
  const [departmentId, setDepartmentId] = useState(initial?.departmentId ? String(initial.departmentId) : '');
  const [designationId, setDesignationId] = useState(
    initial?.designationId ? String(initial.designationId) : '',
  );
  const [role, setRole] = useState<UserRole>(initial?.role ?? 'FIELD_AGENT');
  const [reportsTo, setReportsTo] = useState(initial?.reportsTo ?? '');
  const [password, setPassword] = useState('');
  const [mfaRequired, setMfaRequired] = useState(initial?.mfaRequired ?? false);
  // CREATE mode: a photo staged before the user exists; uploaded right after create succeeds.
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  // Access tab (ADR-0022 slice 6): scope picks staged in create mode, applied post-create.
  const [tab, setTab] = useState<'profile' | 'access'>('profile');
  const [stagedScope, setStagedScope] = useState<StagedScope>({});
  const [effectiveFrom, setEffectiveFrom] = useState(toDateInput(initial?.effectiveFrom));
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(initial?.version ?? 0); // OCC token the edit started from
  const [conflict, setConflict] = useState<{ updatedAt?: string; version?: number } | null>(null);

  // Reports-to is filtered to the role's configured reporting target; top roles report to no one.
  const managerRole = roleOptions.find((o) => o.code === role)?.reportsToRole ?? null;
  const managerOptions = managers.filter((m) => m.id !== initial?.id && m.role === managerRole);
  const reportsToValid = !managerRole || managerOptions.some((m) => m.id === reportsTo);
  const roleDimensions = roleCatalog.find((r) => r.code === role)?.dimensions ?? [];

  const adminDisableMfa = useMutation({
    mutationFn: () => api<{ ok: true }>('POST', `/api/v2/auth/mfa/admin/${initial!.id}/disable`),
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
        ? api<UserView>('PUT', `${BASE}/${initial!.id}`, { username, ...payload, version })
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
      navigate('/admin/users');
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
    <div className="space-y-4">
      <Button variant="link" size="sm" onClick={() => navigate('/admin/users')}>
        ← Back to users
      </Button>
      <div>
        <h1 className="text-xl font-bold tracking-tight">{isEdit ? 'Edit' : 'New'} User</h1>
        <p className="text-sm text-muted-foreground">
          People who operate the system — identity, role, reporting line, and data access.
        </p>
      </div>

      <div className="max-w-3xl space-y-3 rounded-lg border border-border bg-card p-6 shadow-sm">
        <Tabs
          className="mb-4"
          active={tab}
          onChange={setTab}
          tabs={[
            { key: 'profile', label: 'Profile' },
            { key: 'access', label: 'Access' },
          ]}
        />
        {tab === 'access' && (
          <UserAccessSection
            roleCode={role}
            dimensions={roleDimensions}
            {...(initial ? { userId: initial.id } : {})}
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
                value={initial?.employeeId ?? ''}
                readOnly
                disabled
              />
              <span className="mt-1 block text-xs text-muted-foreground">Auto-generated and immutable.</span>
            </label>
          )}
          <div className="rounded-md border border-border p-3">
            {isEdit ? <UserPhoto userId={initial!.id} /> : <UserPhoto onPick={setPhotoFile} />}
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
              <SessionList userId={initial!.id} />
            </div>
          )}
          {isEdit && <PolicyAcceptancesSection userId={initial!.id} />}
        </div>
        {/* outside the tab toggle — a save failure stays visible from the Access tab too */}
        {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
        <div className="mt-5 flex items-center justify-end gap-2">
          {!canSave && saveDisabledReason && (
            <span className="mr-auto text-sm text-muted-foreground">{saveDisabledReason}</span>
          )}
          <Button variant="ghost" onClick={() => navigate('/admin/users')} disabled={mut.isPending}>
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
            navigate('/admin/users');
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
        <ScrollRegion label="Policy acceptances">
          <table className="w-full text-xs rtable">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th scope="col" className="py-1 pr-3 font-medium">
                  Policy
                </th>
                <th scope="col" className="py-1 pr-3 font-medium">
                  Version
                </th>
                <th scope="col" className="py-1 pr-3 font-medium">
                  Accepted
                </th>
                <th scope="col" className="py-1 pr-3 font-medium">
                  IP
                </th>
                <th scope="col" className="py-1 pr-3 font-medium">
                  Source
                </th>
              </tr>
            </thead>
            <tbody>
              {q.data.map((a) => (
                <tr key={a.id} className="border-b border-border/50">
                  <td data-label="Policy" className="py-1 pr-3 text-foreground">
                    {a.policyName ?? a.policyCode ?? '—'}
                  </td>
                  <td data-label="Version" className="py-1 pr-3 font-mono text-muted-foreground">
                    {a.policyVersion}
                  </td>
                  <td data-label="Accepted" className="py-1 pr-3 text-muted-foreground">
                    {formatDateTime(a.acceptedAt)}
                  </td>
                  <td data-label="IP" className="py-1 pr-3 font-mono text-muted-foreground">
                    {a.ip ?? '—'}
                  </td>
                  <td
                    data-label="Source"
                    className="py-1 pr-3 text-muted-foreground"
                    title={a.userAgent ?? undefined}
                  >
                    {truncateUa(a.userAgent)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollRegion>
      )}
    </div>
  );
}
