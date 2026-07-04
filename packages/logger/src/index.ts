/**
 * @crm2/logger — THE single centralized logger for CRM2.
 * Zero-dependency structured (JSON) logger. console.* is BANNED app-wide (ESLint);
 * all logging goes through this. Levels match the engineering standard:
 *   trace < debug < info < warn < error < fatal
 * Level usage (see ENGINEERING_STANDARDS / DEVELOPMENT_WORKFLOW):
 *   trace=troubleshooting · debug=diagnostics · info=business events ·
 *   warn=recoverable/validation/retry/degraded · error=failed operations · fatal=cannot continue
 * Observability (Part 36): pass request/job bindings via child() — requestId, userId, duration, status.
 */

export const LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

const RANK: Record<LogLevel, number> = { trace: 10, debug: 20, info: 30, warn: 40, error: 50, fatal: 60 };

export type LogBindings = Record<string, unknown>;

export interface Logger {
  trace(msg: string, fields?: LogBindings): void;
  debug(msg: string, fields?: LogBindings): void;
  info(msg: string, fields?: LogBindings): void;
  warn(msg: string, fields?: LogBindings): void;
  error(msg: string, fields?: LogBindings): void;
  fatal(msg: string, fields?: LogBindings): void;
  child(bindings: LogBindings): Logger;
}

export interface LoggerOptions {
  level?: LogLevel;
  bindings?: LogBindings;
  /** sink override (tests). Default: process.stdout. */
  write?: (line: string) => void;
  /** clock override (tests) — UTC ISO string. */
  now?: () => string;
}

function resolveLevel(explicit?: LogLevel): LogLevel {
  const env = (process.env['LOG_LEVEL'] ?? '').toLowerCase();
  if ((LOG_LEVELS as readonly string[]).includes(env)) return env as LogLevel;
  if (explicit) return explicit;
  return process.env['NODE_ENV'] === 'production' ? 'info' : 'debug';
}

/**
 * Defense-in-depth (ADR-0076 SEC-11): mask values of sensitive-named log fields so a careless
 * `logger.info('x', { authorization, password, token, ... })` never leaks a credential to the log
 * sink. Matches the KEY (not the message text); over-masking a benignly-named field is acceptable.
 */
const SENSITIVE_KEY = /pass(word)?|secret|token|authorization|cookie|jwt|api[-_]?key|mfa|credential|otp/i;
const REDACTED = '[REDACTED]';
// LOGGING-01 (docs/audit/14-logging.md): the old version only checked top-level keys, so
// `logger.warn('x', { user: { password } })` or `{ items: [{ token }] }` passed the secret through
// unmasked. Recurses into plain objects/arrays; a depth cap is the cycle guard (simpler than tracking
// visited references, and this only ever sees log-call payloads, never runs on user-controlled depth).
const MAX_REDACT_DEPTH = 6;
function redactValue(value: unknown, depth: number): unknown {
  if (depth > MAX_REDACT_DEPTH || value === null || typeof value !== 'object' || value instanceof Date) {
    return value;
  }
  if (Array.isArray(value)) return value.map((v) => redactValue(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SENSITIVE_KEY.test(k) ? REDACTED : redactValue(v, depth + 1);
  }
  return out;
}
function redact(record: Record<string, unknown>): Record<string, unknown> {
  return redactValue(record, 0) as Record<string, unknown>;
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const min = RANK[resolveLevel(options.level)];
  const base = options.bindings ?? {};
  const write = options.write ?? ((line: string) => process.stdout.write(`${line}\n`));
  const now = options.now ?? (() => new Date().toISOString());

  const emit = (level: LogLevel, msg: string, fields?: LogBindings): void => {
    if (RANK[level] < min) return;
    const record = { time: now(), level, msg, ...base, ...(fields ?? {}) };
    write(JSON.stringify(redact(record)));
  };

  return {
    trace: (m, f) => emit('trace', m, f),
    debug: (m, f) => emit('debug', m, f),
    info: (m, f) => emit('info', m, f),
    warn: (m, f) => emit('warn', m, f),
    error: (m, f) => emit('error', m, f),
    fatal: (m, f) => emit('fatal', m, f),
    child: (bindings) => createLogger({ ...options, bindings: { ...base, ...bindings } }),
  };
}

/** The app-wide default logger. Use `logger.child({ requestId, userId })` per request/job. */
export const logger: Logger = createLogger();
