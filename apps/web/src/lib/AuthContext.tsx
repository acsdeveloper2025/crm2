import { createContext, useContext, useEffect, useState } from 'react';
import type { AuthUser, LoginResponse, PendingPolicy } from '@crm2/sdk';
import { api, setUnauthorizedHandler } from './sdk.js';
import { tokenStore } from './auth.js';
import { disconnectSocket } from './socket.js';
import { hasPermission } from './permissions.js';

interface AuthState {
  user: AuthUser | null;
  /** false until the initial session probe completes (avoids a login-screen flash) */
  ready: boolean;
  /** login returned mustChangePassword (an admin-issued one-time password, or an over-age password per
   *  the role's rotation policy) → the app blocks into the forced change-password screen until cleared. */
  mustChangePassword: boolean;
  /** login returned mustAcceptPolicies → the app blocks into the policy-acceptance screen until the
   *  user accepts every pending active policy (ADR-0042). */
  mustAcceptPolicies: boolean;
  /** the active policies this user still owes acceptance for (empty once accepted/cleared). */
  pendingPolicies: PendingPolicy[];
  /** reason shown on the login screen after an idle/absolute timeout (null when none) (ADR-0045). */
  logoutReason: string | null;
  login: (username: string, password: string, mfaCode?: string) => Promise<void>;
  logout: () => Promise<void>;
  /** idle/absolute timeout: revoke THIS browser session only (not logout-everywhere), then drop. */
  idleLogout: (reason: string) => Promise<void>;
  /** records the user's acceptance of all pending policies, then clears the gate. */
  acceptPolicies: () => Promise<void>;
  /** true if the current user holds `perm` (or grantsAll). UX gating must mirror the server perm. */
  has: (perm: string) => boolean;
}

const AuthCtx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [ready, setReady] = useState(false);
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const [mustAcceptPolicies, setMustAcceptPolicies] = useState(false);
  const [pendingPolicies, setPendingPolicies] = useState<PendingPolicy[]>([]);
  const [logoutReason, setLogoutReason] = useState<string | null>(null);

  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null));
    void (async () => {
      if (tokenStore.access() ?? tokenStore.jti()) {
        try {
          setUser(await api<AuthUser>('GET', '/api/v2/auth/me'));
        } catch {
          tokenStore.clear();
        }
      }
      setReady(true);
    })();
  }, []);

  const login = async (username: string, password: string, mfaCode?: string): Promise<void> => {
    const res = await api<LoginResponse>('POST', '/api/v2/auth/login', {
      username,
      password,
      ...(mfaCode ? { mfaCode } : {}),
      deviceId: tokenStore.deviceId(),
    });
    tokenStore.set(res.tokens.accessToken, res.tokens.jti);
    tokenStore.markSessionStart();
    setLogoutReason(null);
    setMustChangePassword(res.mustChangePassword);
    setMustAcceptPolicies(res.mustAcceptPolicies);
    setPendingPolicies(res.pendingPolicies);
    setUser(res.user);
  };

  const acceptPolicies = async (): Promise<void> => {
    // Acceptances are recorded in the shared `consents` store, keyed by policy version (usually one
    // pending policy; loop to cover the rare multi-policy case).
    for (const p of pendingPolicies) {
      await api('POST', '/api/v2/consents/accept', { policyVersion: p.contentVersion });
    }
    setPendingPolicies([]);
    setMustAcceptPolicies(false);
  };

  const logout = async (): Promise<void> => {
    try {
      await api('POST', '/api/v2/auth/logout');
    } catch {
      // logout is best-effort; clear the local session regardless
    }
    tokenStore.clear();
    tokenStore.clearSessionStart();
    disconnectSocket(); // drop the realtime channel so the next login re-handshakes (ADR-0027)
    setMustChangePassword(false);
    setMustAcceptPolicies(false);
    setPendingPolicies([]);
    setUser(null);
  };

  const idleLogout = async (reason: string): Promise<void> => {
    // Idle/absolute timeout (ADR-0045) revokes ONLY this browser session — a walked-away web tab must
    // not kill the user's mobile/other-device sessions (that's what manual logout-everywhere is for).
    const jti = tokenStore.jti();
    if (jti) {
      try {
        await api('POST', `/api/v2/auth/sessions/${jti}/revoke`);
      } catch {
        // best-effort — clear locally regardless
      }
    }
    tokenStore.clear();
    tokenStore.clearSessionStart();
    disconnectSocket();
    setLogoutReason(reason);
    setMustChangePassword(false);
    setMustAcceptPolicies(false);
    setPendingPolicies([]);
    setUser(null);
  };

  return (
    <AuthCtx.Provider
      value={{
        user,
        ready,
        mustChangePassword,
        mustAcceptPolicies,
        pendingPolicies,
        logoutReason,
        login,
        logout,
        idleLogout,
        acceptPolicies,
        has: (perm) => hasPermission(user, perm),
      }}
    >
      {children}
    </AuthCtx.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
