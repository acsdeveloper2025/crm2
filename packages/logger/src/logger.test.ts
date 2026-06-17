import { describe, it, expect } from 'vitest';
import { createLogger, LOG_LEVELS } from './index.js';

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

  it('exposes all six mandated levels in order', () => {
    expect(LOG_LEVELS).toEqual(['trace', 'debug', 'info', 'warn', 'error', 'fatal']);
  });
});
