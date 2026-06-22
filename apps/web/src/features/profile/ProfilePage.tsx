/**
 * My Profile (self-service). Mirrors v1's profile page, v2-native: an Identity card (read-only
 * identity + an inline edit of the only self-editable contact fields, email & phone, + the avatar)
 * and a Change Password card. MFA + active sessions live on the dedicated /security page, linked from
 * here (not duplicated). All reads/writes go to the self-scoped `/users/me` + `/auth/change-password`
 * endpoints — a user only ever touches their own record.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  UpdateSelfProfileSchema,
  ChangePasswordSchema,
  type UserPolicyAcceptance,
  type UserView,
} from '@crm2/sdk';
import { api, ApiError } from '../../lib/sdk.js';
import { formatDateTime } from '../../lib/format.js';
import { UserPhoto } from '../../components/UserPhoto.js';
import { PasswordPolicyChecklist, isPasswordStrong } from '../../components/PasswordPolicyChecklist.js';
import { Button } from '../../components/ui/Button.js';
import { Input } from '../../components/ui/Input.js';

const ME = ['me-profile'];

/** One read-only labelled field. Renders an em-dash when empty so every row keeps its height. */
function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm text-foreground">{value || '—'}</dd>
    </div>
  );
}

function IdentityCard({ me }: { me: UserView }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [email, setEmail] = useState(me.email ?? '');
  const [phone, setPhone] = useState(me.phone ?? '');
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => {
      // Empty string clears the value (→ null); validate the shape before the round-trip.
      const payload = { email: email.trim() || null, phone: phone.trim() || null };
      const parsed = UpdateSelfProfileSchema.safeParse(payload);
      if (!parsed.success) {
        const first = parsed.error.issues[0];
        throw new ApiError(
          0,
          first?.path[0] === 'phone'
            ? 'Enter a valid phone (e.g. +919876543210).'
            : 'Enter a valid email address.',
        );
      }
      return api<UserView>('PATCH', '/api/v2/users/me/profile', payload);
    },
    onSuccess: () => {
      setEditing(false);
      setError(null);
      void qc.invalidateQueries({ queryKey: ME });
      toast.success('Contact details updated.');
    },
    onError: (e) => setError(e instanceof ApiError ? e.code : 'Could not save. Try again.'),
  });

  return (
    <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
      <div className="mb-4 flex items-start justify-between gap-4">
        <h2 className="font-semibold">Identity</h2>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
            me.isActive ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
          }`}
        >
          {me.isActive ? 'Active' : 'Inactive'}
        </span>
      </div>

      <div className="mb-5">
        <UserPhoto self />
      </div>

      <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Full name" value={me.name} />
        <Field label="Username" value={me.username} />
        <Field label="Employee ID" value={me.employeeId} />
        <Field label="Role" value={me.role.replace(/_/g, ' ')} />
        <Field label="Department" value={me.departmentName} />
        <Field label="Designation" value={me.designationName} />
        <Field label="Reports to" value={me.reportsToName} />
      </dl>

      <div className="mt-5 border-t border-border pt-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold">Contact</h3>
          {!editing && (
            <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
              Edit
            </Button>
          )}
        </div>

        {editing ? (
          <div className="space-y-3">
            <div>
              <label
                htmlFor="me-email"
                className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground"
              >
                Email
              </label>
              <Input
                id="me-email"
                className="input"
                type="email"
                uppercase={false}
                value={email}
                placeholder="name@example.com"
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div>
              <label
                htmlFor="me-phone"
                className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground"
              >
                Phone
              </label>
              <Input
                id="me-phone"
                className="input"
                uppercase={false}
                value={phone}
                placeholder="+919876543210"
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="flex gap-2">
              <Button onClick={() => save.mutate()} loading={save.isPending}>
                Save
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setEditing(false);
                  setError(null);
                  setEmail(me.email ?? '');
                  setPhone(me.phone ?? '');
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Email" value={me.email} />
            <Field label="Phone" value={me.phone} />
          </dl>
        )}
      </div>
    </div>
  );
}

function ChangePasswordCard() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);

  const change = useMutation({
    mutationFn: () => {
      if (next !== confirm) throw new ApiError(0, 'The new passwords do not match.');
      const parsed = ChangePasswordSchema.safeParse({ currentPassword: current, newPassword: next });
      if (!parsed.success)
        throw new ApiError(0, 'New password needs 8+ characters with upper, lower, a digit and a symbol.');
      return api('POST', '/api/v2/auth/change-password', parsed.data);
    },
    onSuccess: () => {
      setCurrent('');
      setNext('');
      setConfirm('');
      setError(null);
      toast.success('Password changed. Other devices will need to sign in again.');
    },
    onError: (e) =>
      setError(
        e instanceof ApiError && e.code === 'INVALID_CREDENTIALS'
          ? 'Your current password is incorrect.'
          : e instanceof ApiError && e.message
            ? e.message
            : 'Could not change the password. Try again.',
      ),
  });

  return (
    <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
      <h2 className="mb-1 font-semibold">Change password</h2>
      <p className="mb-4 text-sm text-muted-foreground">
        Set a new password. Other signed-in devices are signed out for safety.
      </p>
      <div className="max-w-sm space-y-3">
        <Input
          className="input"
          type="password"
          uppercase={false}
          autoComplete="current-password"
          placeholder="Current password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
        />
        <Input
          className="input"
          type="password"
          uppercase={false}
          autoComplete="new-password"
          placeholder="New password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
        />
        {next.length > 0 && <PasswordPolicyChecklist password={next} />}
        <Input
          className="input"
          type="password"
          uppercase={false}
          autoComplete="new-password"
          placeholder="Confirm new password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
        {confirm.length > 0 && next !== confirm && (
          <p className="text-xs text-destructive">Passwords do not match.</p>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button
          onClick={() => change.mutate()}
          loading={change.isPending}
          disabled={!current || !isPasswordStrong(next) || next !== confirm}
        >
          Update password
        </Button>
      </div>
    </div>
  );
}

/**
 * Self-service view of the user's own policy-acceptance log (ADR-0043). Read-only — accepting a
 * policy happens through the login gate, not here. Mirrors the admin section in UserDialog but drops
 * the IP column (own log; the IP adds no signal to the user themselves).
 */
const UA_PREVIEW_LEN = 40;
const truncateUa = (ua: string | null): string =>
  ua ? (ua.length > UA_PREVIEW_LEN ? `${ua.slice(0, UA_PREVIEW_LEN)}…` : ua) : '—';

function PolicyAcceptancesCard() {
  const q = useQuery({
    queryKey: ['my-consents'],
    queryFn: () => api<UserPolicyAcceptance[]>('GET', '/api/v2/auth/my-consents'),
  });

  return (
    <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
      <h2 className="mb-1 font-semibold">Policy Acceptances</h2>
      <p className="mb-4 text-sm text-muted-foreground">
        The policies you have accepted. Acceptance is recorded automatically when you sign in.
      </p>
      {q.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : q.isError ? (
        <p className="text-sm text-destructive">Could not load your acceptances.</p>
      ) : !q.data || q.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">You haven&apos;t accepted any policies yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="py-1 pr-3 font-medium">Policy</th>
                <th className="py-1 pr-3 font-medium">Version</th>
                <th className="py-1 pr-3 font-medium">Accepted</th>
                <th className="py-1 pr-3 font-medium">Device</th>
              </tr>
            </thead>
            <tbody>
              {q.data.map((a) => (
                <tr key={a.id} className="border-b border-border/50">
                  <td className="py-1 pr-3 text-foreground">{a.policyName ?? a.policyCode ?? '—'}</td>
                  <td className="py-1 pr-3 font-mono text-muted-foreground">{a.policyVersion}</td>
                  <td className="py-1 pr-3 text-muted-foreground">{formatDateTime(a.acceptedAt)}</td>
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

export function ProfilePage() {
  const me = useQuery({ queryKey: ME, queryFn: () => api<UserView>('GET', '/api/v2/users/me/profile') });

  return (
    <div className="max-w-2xl space-y-4">
      <div>
        <h1 className="text-xl font-bold tracking-tight">My Profile</h1>
        <p className="text-sm text-muted-foreground">
          Your identity and contact details.{' '}
          <Link to="/security" className="text-primary hover:underline">
            Two-factor authentication and active sessions
          </Link>{' '}
          live on the Security page.
        </p>
      </div>

      {me.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : me.data ? (
        <>
          <IdentityCard me={me.data} />
          <ChangePasswordCard />
          <PolicyAcceptancesCard />
        </>
      ) : (
        <p className="text-sm text-destructive">Could not load your profile.</p>
      )}
    </div>
  );
}
