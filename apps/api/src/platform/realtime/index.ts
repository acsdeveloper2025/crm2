import type { Server as HttpServer } from 'node:http';
import { Server as IOServer, type Socket, type DefaultEventsMap } from 'socket.io';
import { Redis } from 'ioredis';
import { createAdapter } from '@socket.io/redis-adapter';
import type { Env } from '@crm2/config';
import { loadEnv } from '@crm2/config';
import { logger } from '@crm2/logger';
import { verifyAccessToken } from '../jwt.js';
import { getRoleAttributes } from '../access/index.js';

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
}

const noopRealtime: Realtime = {
  emitToUser: () => undefined,
  emitToFieldMonitoring: () => undefined,
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
const BEARER = 'Bearer ';

function userRoom(userId: string): string {
  return `user:${userId}`;
}

interface SocketData {
  userId: string;
  canFieldMonitoring: boolean;
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
  const attrs = await getRoleAttributes(claims.role);
  return {
    userId: claims.userId,
    canFieldMonitoring:
      (attrs?.grantsAll ?? false) || (attrs?.permissions ?? []).includes(FIELD_MONITORING_PERM),
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
export function initRealtime(httpServer: HttpServer, env: Env = loadEnv()): AppServer {
  const io: AppServer = new IOServer(httpServer, {
    cors: { origin: true, credentials: true },
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
        next();
      } catch (e) {
        next(e instanceof Error ? e : new Error('HANDSHAKE_FAILED'));
      }
    })();
  });

  io.on('connection', (socket) => {
    void socket.join(userRoom(socket.data.userId));
    if (socket.data.canFieldMonitoring) void socket.join(FIELD_MONITORING_ROOM);
  });

  active = {
    emitToUser: (userId, event, payload) => {
      io.to(userRoom(userId)).emit(event, payload);
    },
    emitToFieldMonitoring: (event, payload) => {
      io.to(FIELD_MONITORING_ROOM).emit(event, payload);
    },
  };

  logger.info('realtime: socket.io server initialized');
  return io;
}
