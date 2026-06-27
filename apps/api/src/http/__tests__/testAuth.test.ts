import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { testAuth } from '../testAuth.js';

/** Run the testAuth middleware once under a given NODE_ENV with a valid x-test-auth header. */
function run(nodeEnv: string): Request {
  const prev = process.env['NODE_ENV'];
  process.env['NODE_ENV'] = nodeEnv;
  try {
    const req = { header: () => 'admin:u1', auth: undefined } as unknown as Request;
    const next = vi.fn() as unknown as NextFunction;
    testAuth()(req, {} as Response, next);
    expect(next).toHaveBeenCalledOnce();
    return req;
  } finally {
    process.env['NODE_ENV'] = prev;
  }
}

describe('testAuth double-guard (ADR-0076)', () => {
  it('honors x-test-auth outside production', () => {
    expect(run('test').auth).toEqual({ role: 'admin', userId: 'u1' });
  });

  it('is a no-op in production even if mounted', () => {
    expect(run('production').auth).toBeUndefined();
  });
});
