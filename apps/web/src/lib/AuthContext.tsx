import { createContext, useContext, useEffect, useState } from 'react';
import type { AuthUser, LoginResponse, PendingPolicy } from '@crm2/sdk';
import { api, setUnauthorizedHandler } from './sdk.js';
import { tokenStore } from './auth.js';
import { disconnectSocket } from './socket.js';

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
  login: (username: string, password: string, mfaCode?: string) => Promise<void>;
  logout: () => Promise<void>;
  /** records the user's acceptance of all pending policies, then clears the gate. */
  acceptPolicies: () => Promise<void>;
}

const AuthCtx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [ready, setReady] = useState(false);
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const [mustAcceptPolicies, setMustAcceptPolicies] = useState(false);
  const [pendingPolicies, setPendingPolicies] = useState<PendingPolicy[]>([]);

  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null));
    void (async () => {
      if (tokenStore.access() ?? tokenStore.refresh()) {
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
    });
    tokenStore.set(res.tokens.accessToken, res.tokens.refreshToken);
    setMustChangePassword(res.mustChangePassword);
    setMustAcceptPolicies(res.mustAcceptPolicies);
    setPendingPolicies(res.pendingPolicies);
    setUser(res.user);
  };

  const acceptPolicies = async (): Promise<void> => {
    await api('POST', '/api/v2/auth/accept-policies', { policyIds: pendingPolicies.map((p) => p.id) });
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
    disconnectSocket(); // drop the realtime channel so the next login re-handshakes (ADR-0027)
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
        login,
        logout,
        acceptPolicies,
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
