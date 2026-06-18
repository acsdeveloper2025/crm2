import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../lib/AuthContext.js';
import { sessionManager } from '../../lib/sessionManager.js';
import { tokenStore } from '../../lib/auth.js';
import { onRealtime } from '../../lib/socket.js';
import { SessionTimeoutModal } from './SessionTimeoutModal.js';

/**
 * Mounts the idle/absolute-session manager behind the server's role switch (ADR-0045): the timer only
 * starts when the user's `idleLogoutMinutes`/`maxSessionMinutes` is non-null (FIELD_AGENT = exempt).
 * Also drops this browser live on a device-targeted `auth:session_revoked` (admin force-logout). Mount
 * inside the authenticated Layout — App's guards guarantee a user by then.
 */
export function IdleLogoutManager() {
  const { user, idleLogout } = useAuth();
  const [remaining, setRemaining] = useState<number | null>(null);

  // idleLogout is re-created each AuthProvider render; a ref keeps the effect from re-initialising.
  const idleLogoutRef = useRef(idleLogout);
  idleLogoutRef.current = idleLogout;

  const idle = user?.idleLogoutMinutes ?? null;
  const max = user?.maxSessionMinutes ?? null;

  useEffect(() => {
    if (!user || (idle == null && max == null)) return;
    sessionManager.init(
      { idleLogoutMinutes: idle, maxSessionMinutes: max },
      {
        onWarning: (s) => setRemaining(s),
        onClearWarning: () => setRemaining(null),
        onLogout: (reason) => {
          setRemaining(null);
          void idleLogoutRef.current(reason);
        },
      },
    );
    // Admin force-logout / cross-device revoke targeting THIS browser → drop live (ADR-0027/0045).
    const myDevice = tokenStore.deviceId();
    const off = onRealtime('auth:session_revoked', (payload) => {
      const p = payload as { deviceId?: string };
      if (p?.deviceId && p.deviceId === myDevice) {
        setRemaining(null);
        void idleLogoutRef.current('Your session was ended.');
      }
    });
    return () => {
      off();
      sessionManager.destroy();
    };
  }, [user, idle, max]);

  if (remaining == null) return null;
  return (
    <SessionTimeoutModal
      remainingSeconds={remaining}
      onStay={() => {
        sessionManager.extend();
        setRemaining(null);
      }}
      onLogout={() => {
        setRemaining(null);
        void idleLogout('You signed out.');
      }}
    />
  );
}
