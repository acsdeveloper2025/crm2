import { describe, it, expect } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { authorize, authorizeAny } from '../authorize.js';
import { PERMISSIONS } from '../permissions.js';

const VIEW = PERMISSIONS.MASTERDATA_VIEW;
const CREATE = PERMISSIONS.CASE_CREATE;

interface FakeRes {
  statusCode: number;
  body: unknown;
  status: (c: number) => FakeRes;
  json: (b: unknown) => FakeRes;
}
const mkRes = (): FakeRes => ({
  statusCode: 200,
  body: undefined,
  status(c) {
    this.statusCode = c;
    return this;
  },
  json(b) {
    this.body = b;
    return this;
  },
});

const run = (
  mw: (req: Request, res: Response, next: NextFunction) => void,
  auth: Request['auth'],
): { res: FakeRes; nexted: boolean } => {
  const res = mkRes();
  let nexted = false;
  mw(
    { auth } as Request,
    res as unknown as Response,
    (() => {
      nexted = true;
    }) as NextFunction,
  );
  return { res, nexted };
};

describe('authorize', () => {
  it('passes a user holding the permission, 403s one without', () => {
    expect(run(authorize(VIEW), { userId: 'u', role: 'r', permissions: [VIEW] }).nexted).toBe(true);
    const denied = run(authorize(VIEW), { userId: 'u', role: 'r', permissions: [CREATE] });
    expect(denied.nexted).toBe(false);
    expect(denied.res.statusCode).toBe(403);
  });
});

describe('authorizeAny', () => {
  it('passes when the user has ANY listed permission', () => {
    const { nexted, res } = run(authorizeAny(VIEW, CREATE), {
      userId: 'u',
      role: 'r',
      permissions: [CREATE],
    });
    expect(nexted).toBe(true);
    expect(res.statusCode).toBe(200);
  });
  it('passes a grantsAll user even with none of the listed permissions', () => {
    expect(
      run(authorizeAny(VIEW, CREATE), { userId: 'u', role: 'r', grantsAll: true, permissions: [] }).nexted,
    ).toBe(true);
  });
  it('403s when the user has none of the listed permissions', () => {
    const { nexted, res } = run(authorizeAny(VIEW, CREATE), {
      userId: 'u',
      role: 'r',
      permissions: ['dedupe.view'],
    });
    expect(nexted).toBe(false);
    expect(res.statusCode).toBe(403);
  });
  it('401s when unauthenticated', () => {
    expect(run(authorizeAny(VIEW), undefined).res.statusCode).toBe(401);
  });
});
