import { describe, it, expect, vi } from 'vitest';
import { createLogger, LOG_LEVELS } from './index.js';

/** Run `fn` with env vars temporarily set, then restore (no leakage between tests). */
function withEnv(vars: Record<string, string | undefined>, fn: () => void): void {
  const prev: Record<string, string | undefined> = {};
  for (const k of Object.keys(vars)) prev[k] = process.env[k];
  try {
    for (const [k, v] of Object.entries(vars)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    fn();
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

const capture = () => {
  const lines: string[] = [];
  return { lines, write: (l: string) => lines.push(l), now: () => '2026-01-01T00:00:00.000Z' };
};

describe('@crm2/logger', () => {
  it('emits structured JSON with time, level, msg', () => {
    const c = capture();
    createLogger({ level: 'trace', write: c.write, now: c.now }).info('case created', { caseId: 7 });
    expect(JSON.parse(c.lines[0]!)).toEqual({
      time: '2026-01-01T00:00:00.000Z',
      level: 'info',
      msg: 'case created',
      caseId: 7,
    });
  });

  it('filters below the configured level', () => {
    const c = capture();
    const log = createLogger({ level: 'warn', write: c.write, now: c.now });
    log.debug('noise');
    log.info('noise');
    log.warn('kept');
    log.error('kept');
    expect(c.lines).toHaveLength(2);
  });

  it('child() merges bindings (request context)', () => {
    const c = capture();
    createLogger({ level: 'trace', write: c.write, now: c.now })
      .child({ requestId: 'r1', userId: 'u1' })
      .error('failed', { status: 500 });
    expect(JSON.parse(c.lines[0]!)).toMatchObject({
      requestId: 'r1',
      userId: 'u1',
      status: 500,
      level: 'error',
    });
  });

  it('redacts sensitive-named fields (ADR-0076 SEC-11) but keeps benign ones', () => {
    const c = capture();
    createLogger({ level: 'trace', write: c.write, now: c.now }).info('login', {
      authorization: 'Bearer abc',
      password: 'hunter2',
      refreshToken: 'rt_xyz',
      apiKey: 'k',
      userId: 'u1',
      caseId: 7,
    });
    expect(JSON.parse(c.lines[0]!)).toMatchObject({
      authorization: '[REDACTED]',
      password: '[REDACTED]',
      refreshToken: '[REDACTED]',
      apiKey: '[REDACTED]',
      userId: 'u1', // not sensitive → kept
      caseId: 7,
    });
  });

  // LOGGING-01 (docs/audit/14-logging.md): redact() was shallow — a nested secret passed through.
  it('redacts sensitive-named fields nested inside objects and arrays', () => {
    const c = capture();
    createLogger({ level: 'trace', write: c.write, now: c.now }).info('event', {
      user: { id: 'u1', password: 'hunter2' },
      items: [{ token: 'tok_1' }, { name: 'benign' }],
      deep: { a: { b: { c: { secret: 'sh' } } } },
    });
    const line = JSON.parse(c.lines[0]!);
    expect(line.user).toEqual({ id: 'u1', password: '[REDACTED]' });
    expect(line.items).toEqual([{ token: '[REDACTED]' }, { name: 'benign' }]);
    expect(line.deep.a.b.c.secret).toBe('[REDACTED]');
  });

  it('does not mangle a Date value while redacting', () => {
    const c = capture();
    const when = new Date('2026-01-01T00:00:00.000Z');
    createLogger({ level: 'trace', write: c.write, now: c.now }).info('event', { when });
    expect(JSON.parse(c.lines[0]!).when).toBe(when.toISOString());
  });

  it('exposes all six mandated levels in order', () => {
    expect(LOG_LEVELS).toEqual(['trace', 'debug', 'info', 'warn', 'error', 'fatal']);
  });

  it('emits via the trace and fatal level methods', () => {
    const c = capture();
    const log = createLogger({ level: 'trace', write: c.write, now: c.now });
    log.trace('lowest');
    log.fatal('highest');
    expect(c.lines.map((l) => JSON.parse(l).level)).toEqual(['trace', 'fatal']);
  });

  it('resolves level from LOG_LEVEL env and uses the default stdout sink + clock', () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    try {
      withEnv({ LOG_LEVEL: 'warn', NODE_ENV: undefined }, () => {
        const log = createLogger(); // no level/write/now → env level + default sink + default clock
        log.info('dropped'); // below warn → filtered
        log.warn('kept'); // emitted via the default process.stdout sink
      });
      expect(stdout).toHaveBeenCalledTimes(1);
      const rec = JSON.parse(String(stdout.mock.calls[0]![0]).trim());
      expect(rec).toMatchObject({ level: 'warn', msg: 'kept' });
      expect(typeof rec.time).toBe('string'); // default now() produced a real ISO timestamp
    } finally {
      stdout.mockRestore();
    }
  });

  it('falls back to info in production and debug otherwise when no level is given', () => {
    const c = capture();
    withEnv({ LOG_LEVEL: undefined, NODE_ENV: 'production' }, () => {
      createLogger({ write: c.write, now: c.now }).info('prod');
    });
    expect(c.lines).toHaveLength(1); // info is the floor in production

    c.lines.length = 0;
    withEnv({ LOG_LEVEL: undefined, NODE_ENV: 'development' }, () => {
      createLogger({ write: c.write, now: c.now }).debug('dev');
    });
    expect(c.lines).toHaveLength(1); // debug is the floor outside production
  });
});
