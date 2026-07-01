import type { Server as HttpServer } from 'node:http';
import { Server as IOServer, type Socket, type DefaultEventsMap } from 'socket.io';
import { Redis } from 'ioredis';
import { createAdapter } from '@socket.io/redis-adapter';
import type { Env } from '@crm2/config';
import { loadEnv } from '@crm2/config';
import { logger } from '@crm2/logger';
import { verifyAccessToken } from '../jwt.js';
import { getRoleAttributes } from '../access/index.js';
import { isAccessRevoked } from '../tokenRevocation/index.js';

/**
 * Real-time transport seam (ADR-0027). Callers depend on the {@link Realtime} interface, never on
 * socket.io directly — services emit through `getRealtime()`, so a process with no socket server
 * (tests, the future worker role) degrades to a no-op instead of crashing. Mirrors `platform/storage`
 * and `platform/geocode`: a config-gated factory + an injectable override for tests.
 *
 * Transport is socket.io because the unchanged mobile app is a socket.io consumer (LOCKED contract:
 * `user:<id>` room, `location:request`). Multi-instance fan-out uses the Valkey (Redis) adapter when
 * `REDIS_CACHE_URL` is set; otherwise socket.io's in-memory adapter (dev/tests need no Valkey).
 */
export interface Realtime {
  /** Deliver an event to one user's sockets (every authenticated socket auto-joins `user:<id>`). */
  emitToUser(userId: string, event: string, payload: unknown): void;
  /** Deliver to the supervisor console room (sockets whose role grants `page.field_monitoring`). */
  emitToFieldMonitoring(event: string, payload: unknown): void;
  /** Deliver to the office room (sockets whose role grants `page.dashboard` — every desk role, never
   *  FIELD_AGENT). Used for case/task status fan-out so web views refetch live without spamming the
   *  field app (which never joins this room). */
  emitToOffice(event: string, payload: unknown): void;
  /** Force-disconnect every live socket of one user (ADR-0076 Phase 2): a user-wide revoke must drop
   *  the realtime channel too, not just the REST tokens — else a revoked socket keeps receiving fan-out. */
  disconnectUser(userId: string): void;
}

const noopRealtime: Realtime = {
  emitToUser: () => undefined,
  emitToFieldMonitoring: () => undefined,
  emitToOffice: () => undefined,
  disconnectUser: () => undefined,
};

let override: Realtime | null = null;
let active: Realtime | null = null;

/** For tests: inject a fake realtime (mirrors setGeocoder/setStorage). Pass null to restore. */
export function setRealtime(r: Realtime | null): void {
  override = r;
}

/** The active realtime: the live socket server once initialized, else a no-op. */
export function getRealtime(): Realtime {
  return override ?? active ?? noopRealtime;
}

const FIELD_MONITORING_PERM = 'page.field_monitoring';
const FIELD_MONITORING_ROOM = 'perm:field_monitoring';
// page.dashboard is granted to every web (desk) role and NEVER to FIELD_AGENT (migration 0047) — the
// natural gate for the office case/task status feed (the field app stays out of this room).
const OFFICE_PERM = 'page.dashboard';
const OFFICE_ROOM = 'perm:office';
const BEARER = 'Bearer ';

function userRoom(userId: string): string {
  return `user:${userId}`;
}

interface SocketData {
  userId: string;
  canFieldMonitoring: boolean;
  canOffice: boolean;
}
type AppSocket = Socket<DefaultEventsMap, DefaultEventsMap, DefaultEventsMap, SocketData>;
type AppServer = IOServer<DefaultEventsMap, DefaultEventsMap, DefaultEventsMap, SocketData>;

/** The access token: socket.io `auth.token` (what the mobile/web client sends) or a Bearer header. */
function extractToken(socket: AppSocket): string | null {
  const auth = socket.handshake.auth as { token?: unknown };
  if (typeof auth.token === 'string') return auth.token;
  const header = socket.handshake.headers.authorization;
  if (header?.startsWith(BEARER)) return header.slice(BEARER.length);
  return null;
}

/**
 * The security-critical handshake decision (exported for tests): verify the token and resolve which
 * rooms the socket may join. Returns null for any invalid/expired/missing token (connection rejected)
 * — never a partial identity. `canFieldMonitoring` is decided from resolved role attributes here, so
 * the client can never assert its way into the supervisor room.
 */
export async function resolveSocketIdentity(token: string | null): Promise<SocketData | null> {
  const claims = token ? await verifyAccessToken(token) : null;
  if (!claims) return null;
  // Kill switch (ADR-0076 Phase 2): a revoked user must not be able to open a fresh socket with a
  // still-unexpired-but-killed access token (the REST path already rejects it).
  if (await isAccessRevoked(claims.userId, claims.iat)) return null;
  const attrs = await getRoleAttributes(claims.role);
  const grantsAll = attrs?.grantsAll ?? false;
  const permissions = attrs?.permissions ?? [];
  return {
    userId: claims.userId,
    canFieldMonitoring: grantsAll || permissions.includes(FIELD_MONITORING_PERM),
    canOffice: grantsAll || permissions.includes(OFFICE_PERM),
  };
}

/** Engage the Valkey adapter for multi-instance fan-out, or stay in-memory when unconfigured. */
function configureAdapter(io: AppServer, env: Env): void {
  const url = env.REDIS_CACHE_URL;
  if (!url) {
    logger.info('realtime: in-memory adapter (no REDIS_CACHE_URL)');
    return;
  }
  try {
    const pubClient = new Redis(url, { lazyConnect: false, maxRetriesPerRequest: null });
    const subClient = pubClient.duplicate();
    pubClient.on('error', (e: Error) => logger.warn('realtime pub error', { error: e.message }));
    subClient.on('error', (e: Error) => logger.warn('realtime sub error', { error: e.message }));
    io.adapter(createAdapter(pubClient, subClient));
    logger.info('realtime: Valkey adapter engaged');
  } catch (e) {
    logger.warn('realtime: Valkey adapter init failed, using in-memory', {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

/**
 * Stand up the socket.io server on the shared HTTP server: JWT handshake (reuses `verifyAccessToken`
 * + the same role-attribute resolution as `enrichAuth`), then scope-correct room joins. An invalid or
 * missing token rejects the connection — there are no anonymous sockets. Room membership IS the
 * authorization: `perm:field_monitoring` is joined only when the resolved role grants it.
 */
// MERGED-SOCKETIO-CORS (docs/audit/02-authorization.md, docs/audit/06-csrf.md — independently raised
// by both the authorization and CSRF audits): `origin: true` reflected ANY origin. The handshake still
// requires a valid bearer JWT regardless (verifyAccessToken below), so this was latent, not actively
// exploitable — but an explicit allowlist is a real second factor rather than none. The mobile app is a
// non-browser socket.io client and doesn't send an Origin header the way a browser does, so it's
// unaffected either way.
const PROD_ORIGIN = 'https://crm.allcheckservices.com';
const DEV_ORIGINS = ['http://localhost:5273', 'http://127.0.0.1:5273'];

export function initRealtime(httpServer: HttpServer, env: Env = loadEnv()): AppServer {
  const io: AppServer = new IOServer(httpServer, {
    cors: { origin: env.NODE_ENV === 'production' ? PROD_ORIGIN : DEV_ORIGINS, credentials: true },
  });

  configureAdapter(io, env);

  io.use((socket, next) => {
    void (async (): Promise<void> => {
      try {
        const identity = await resolveSocketIdentity(extractToken(socket));
        if (!identity) {
          next(new Error('UNAUTHENTICATED'));
          return;
        }
        socket.data.userId = identity.userId;
        socket.data.canFieldMonitoring = identity.canFieldMonitoring;
        socket.data.canOffice = identity.canOffice;
        next();
      } catch (e) {
        next(e instanceof Error ? e : new Error('HANDSHAKE_FAILED'));
      }
    })();
  });

  io.on('connection', (socket) => {
    void socket.join(userRoom(socket.data.userId));
    if (socket.data.canFieldMonitoring) void socket.join(FIELD_MONITORING_ROOM);
    if (socket.data.canOffice) void socket.join(OFFICE_ROOM);
  });

  active = {
    emitToUser: (userId, event, payload) => {
      io.to(userRoom(userId)).emit(event, payload);
    },
    emitToFieldMonitoring: (event, payload) => {
      io.to(FIELD_MONITORING_ROOM).emit(event, payload);
    },
    emitToOffice: (event, payload) => {
      io.to(OFFICE_ROOM).emit(event, payload);
    },
    disconnectUser: (userId) => {
      void io.in(userRoom(userId)).disconnectSockets(true);
    },
  };

  logger.info('realtime: socket.io server initialized');
  return io;
}
