/**
 * Realtime client (ADR-0027). One socket.io connection to the API's default `/socket.io` path (the
 * same path the mobile app uses), authenticated by the JWT access token. `auth` is a callback so each
 * (re)connect reads the CURRENT token — after a silent refresh the next reconnect uses the fresh token.
 * The socket is a live-update channel only; the durable feed is always the REST `/notifications`.
 */
import { io, type Socket } from 'socket.io-client';
import { tokenStore } from './auth.js';

let socket: Socket | null = null;

/** Connect (idempotent). Returns the shared socket; callers attach listeners via {@link onRealtime}. */
export function connectSocket(): Socket {
  if (socket) return socket;
  socket = io({
    // The token rides in the handshake; the server verifies it (no anonymous sockets).
    auth: (cb: (data: { token: string | null }) => void) => cb({ token: tokenStore.access() }),
    reconnection: true,
  });
  return socket;
}

/** Drop the connection (on logout) so the next login re-handshakes with the new identity. */
export function disconnectSocket(): void {
  socket?.disconnect();
  socket = null;
}

/**
 * Subscribe to a server event; returns an unsubscribe fn (for useEffect cleanup). Connects lazily so
 * a component can subscribe without ordering against an explicit connect call.
 */
export function onRealtime(event: string, handler: (payload: unknown) => void): () => void {
  const s = connectSocket();
  s.on(event, handler);
  return () => {
    s.off(event, handler);
  };
}
