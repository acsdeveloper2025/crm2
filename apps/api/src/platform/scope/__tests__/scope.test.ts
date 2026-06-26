import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createTestDb } from '@crm2/test-utils';
import { setPool } from '../../db.js';
import { invalidateRoleCache } from '../../access/index.js';
import { getScopedUserIds, resolveScope, composeScopePredicate, DIMENSIONS } from '../index.js';

const RUN = !!process.env['DATABASE_URL'];
const db = RUN ? createTestDb() : null;

// A small org tree: MANAGER → TEAM_LEADER → { FIELD_AGENT, KYC_VERIFIER, BACKEND_USER }.
const U = {
  MGR: '00000000-0000-0000-0000-0000000000a1',
  TL: '00000000-0000-0000-0000-0000000000a2',
  FA: '00000000-0000-0000-0000-0000000000a3',
  KYC: '00000000-0000-0000-0000-0000000000a4',
  BE: '00000000-0000-0000-0000-0000000000a5',
} as const;

async function seedTree(): Promise<void> {
  const ins = (id: string, role: string, reportsTo: string | null) =>
    db!.pool.query(`INSERT INTO users (id, username, name, role, reports_to) VALUES ($1, $2, $2, $3, $4)`, [
      id,
      `${role.toLowerCase()}_${id.slice(-2)}`,
      role,
      reportsTo,
    ]);
  await ins(U.MGR, 'MANAGER', null);
  await ins(U.TL, 'TEAM_LEADER', U.MGR);
  await ins(U.FA, 'FIELD_AGENT', U.TL);
  await ins(U.KYC, 'KYC_VERIFIER', U.TL);
  await ins(U.BE, 'BACKEND_USER', U.TL);
}

const sorted = (a: string[] | undefined): string[] => [...(a ?? [])].sort();
const hierarchyLeg = (ph: string): string => `ct.assigned_to = ANY(${ph})`;

describe.skipIf(!RUN)('data scope engine (ADR-0022 — role attributes, no role names)', () => {
  beforeAll(async () => {
    await db!.migrate();
    setPool(db!.pool);
  });
  afterAll(async () => {
    await db!.end();
  });
  beforeEach(async () => {
    await db!.truncate('user_scope_assignments', 'users');
    await seedTree();
    invalidateRoleCache();
  });

  it('hierarchy modes drive visibility: ALL → undefined, SUBTREE → tree, DIRECT_TEAM → team, SELF → self', async () => {
    expect(await getScopedUserIds({ role: 'SUPER_ADMIN', userId: U.MGR })).toBeUndefined();
    expect(sorted(await getScopedUserIds({ role: 'MANAGER', userId: U.MGR }))).toEqual(
      sorted([U.MGR, U.TL, U.FA, U.KYC, U.BE]),
    );
    expect(sorted(await getScopedUserIds({ role: 'TEAM_LEADER', userId: U.TL }))).toEqual(
      sorted([U.TL, U.FA, U.KYC, U.BE]),
    );
    expect(await getScopedUserIds({ role: 'FIELD_AGENT', userId: U.FA })).toEqual([U.FA]);
    expect(await getScopedUserIds({ role: 'BACKEND_USER', userId: U.BE })).toEqual([U.BE]);
  });

  it('an UNKNOWN role fail-closes to SELF (never "all")', async () => {
    expect(await getScopedUserIds({ role: 'GHOST_ROLE', userId: U.FA })).toEqual([U.FA]);
  });

  it('assignments only count when the role WIRING holds the dimension (orphans are inert)', async () => {
    // a CLIENT assignment on a FIELD_AGENT (role holds PINCODE/AREA, not CLIENT) must be ignored
    await db!.pool.query(
      `INSERT INTO user_scope_assignments (user_id, dimension_code, entity_id) VALUES ($1, 'CLIENT', 42)`,
      [U.FA],
    );
    const scope = await resolveScope({ role: 'FIELD_AGENT', userId: U.FA });
    expect(scope.expand).toBeUndefined();
    expect(scope.restrict).toBeUndefined();
    expect(scope.userIds).toEqual([U.FA]);
  });

  it('EXPAND wiring with assignments lands in scope.expand; empty EXPAND is omitted', async () => {
    await db!.pool.query(
      `INSERT INTO user_scope_assignments (user_id, dimension_code, entity_id) VALUES ($1, 'PINCODE', 7)`,
      [U.FA],
    );
    const scope = await resolveScope({ role: 'FIELD_AGENT', userId: U.FA });
    expect(scope.expand).toEqual({ PINCODE: [7] });
    // the KYC user has no assignments → no expand at all
    expect((await resolveScope({ role: 'KYC_VERIFIER', userId: U.KYC })).expand).toBeUndefined();
  });

  it('KYC_VERIFIER is desk/document-scoped — a pincode/area assignment is inert (ADR-0061, A2026-0623-04 KYC half)', async () => {
    // KYC verifies DOCUMENTS at a desk (OFFICE pool, territory-less per ADR-0024); it must not gain
    // case-PII visibility by geography. After mig 0089 the role no longer wires PINCODE/AREA, so any
    // such assignment is inert (intersected away) → KYC sees only its own assigned/created cases.
    await db!.pool.query(
      `INSERT INTO user_scope_assignments (user_id, dimension_code, entity_id)
       VALUES ($1, 'PINCODE', 7), ($1, 'AREA', 9)`,
      [U.KYC],
    );
    const scope = await resolveScope({ role: 'KYC_VERIFIER', userId: U.KYC });
    expect(scope.expand).toBeUndefined(); // no territory broadening
    expect(scope.restrict).toBeUndefined();
    expect(scope.userIds).toEqual([U.KYC]); // assignment/hierarchy (SELF) visibility only
    // FIELD_AGENT keeps pincode/area — address verification IS territorial, by design (mig 0031)
    await db!.pool.query(
      `INSERT INTO user_scope_assignments (user_id, dimension_code, entity_id) VALUES ($1, 'PINCODE', 7)`,
      [U.FA],
    );
    expect((await resolveScope({ role: 'FIELD_AGENT', userId: U.FA })).expand).toEqual({ PINCODE: [7] });
  });

  it('BACKEND_USER portfolio: CLIENT EXPAND grants the client, PRODUCT RESTRICT caps it (mig 0049)', async () => {
    // The portfolio fix: client GRANTS visibility (a backend reviewer owns no cases, so a cap would
    // show nothing) and product CAPS it — so an assigned product narrows the client's cases instead of
    // pulling in every OTHER client that has that product.
    await db!.pool.query(
      `INSERT INTO user_scope_assignments (user_id, dimension_code, entity_id)
       VALUES ($1, 'CLIENT', 5), ($1, 'PRODUCT', 9)`,
      [U.BE],
    );
    const scope = await resolveScope({ role: 'BACKEND_USER', userId: U.BE });
    expect(scope.expand).toEqual({ CLIENT: [5] }); // additive — grants the client's cases
    expect(scope.restrict).toEqual({ PRODUCT: [9] }); // a cap (was EXPAND → leaked across clients)
    // composed: (own work OR client=5) AND product=9 — the product leg is ANDed, so a DIFFERENT
    // client's product-9 case fails the OR and is excluded (no cross-client leak).
    const params: unknown[] = [];
    const pred = composeScopePredicate(params, scope, hierarchyLeg);
    expect(pred).toContain(' AND ');
  });

  it('composeScopePredicate: (hierarchy OR expand) AND restrict; RESTRICT-empty fail-closed; ALL → ""', async () => {
    // ALL, no wiring → no predicate
    const p0: unknown[] = [];
    expect(
      composeScopePredicate(p0, await resolveScope({ role: 'SUPER_ADMIN', userId: U.MGR }), hierarchyLeg),
    ).toBe('');
    expect(p0).toEqual([]);

    // SELF + one EXPAND dimension → (hierarchy OR pincode-leg)
    await db!.pool.query(
      `INSERT INTO user_scope_assignments (user_id, dimension_code, entity_id) VALUES ($1, 'PINCODE', 7)`,
      [U.FA],
    );
    const p1: unknown[] = [];
    const pred = composeScopePredicate(
      p1,
      await resolveScope({ role: 'FIELD_AGENT', userId: U.FA }),
      hierarchyLeg,
    );
    expect(pred).toBe('((ct.assigned_to = ANY($1::uuid[]) OR cs.pincode_id = ANY($2::int[])))');
    expect(p1).toEqual([[U.FA], [7]]);

    // RESTRICT wiring with ZERO assignments → the AND leg is emitted with [] (matches nothing)
    const restrictScope = { userIds: [U.BE], restrict: { CLIENT: [] as number[] } };
    const p2: unknown[] = [];
    const pred2 = composeScopePredicate(p2, restrictScope, hierarchyLeg);
    expect(pred2).toBe('((ct.assigned_to = ANY($1::uuid[])) AND cs.client_id = ANY($2::int[]))');
    expect(p2).toEqual([[U.BE], []]);

    // a RESTRICT dimension UNKNOWN to the code registry (deploy-order skew) fails CLOSED — FALSE,
    // never a silently dropped cap
    const skewScope = {
      userIds: [U.BE],
      restrict: { GHOST: [1] } as unknown as NonNullable<
        Awaited<ReturnType<typeof resolveScope>>['restrict']
      >,
    };
    const p3: unknown[] = [];
    const pred3 = composeScopePredicate(p3, skewScope, hierarchyLeg);
    expect(pred3).toBe('((ct.assigned_to = ANY($1::uuid[])) AND FALSE)');
  });

  it('TASK level falls back to the case leg for a dimension without a task leg (PINCODE)', () => {
    // No dimension declares a taskPredicate anymore (VERIFICATION_TYPE removed, ADR-0072), so every
    // dimension uses its casePredicate at TASK grain — through the joined cs.
    const pF: unknown[] = [];
    const predF = composeScopePredicate(
      pF,
      { userIds: [U.FA], expand: { PINCODE: [7] } },
      hierarchyLeg,
      'TASK',
    );
    expect(predF).toBe('((ct.assigned_to = ANY($1::uuid[]) OR cs.pincode_id = ANY($2::int[])))');
  });

  it('the code registry and the ACTIVE scope_dimensions catalog stay in lockstep', async () => {
    const rows = await db!.pool.query<{ code: string; entity_kind: string }>(
      `SELECT code, entity_kind FROM scope_dimensions WHERE is_active ORDER BY code`,
    );
    const dbDims = rows.rows.map((r) => `${r.code}:${r.entity_kind}`).sort();
    const codeDims = Object.values(DIMENSIONS)
      .map((d) => `${d.code}:${d.entityKind}`)
      .sort();
    expect(dbDims).toEqual(codeDims);
  });

  it('STATE / CITY / VERIFICATION_TYPE are removed from the scope catalog (ADR-0072)', async () => {
    // user-access scope is CLIENT + PRODUCT (+ PINCODE/AREA territory); the 3 unwired dims are gone.
    expect(Object.keys(DIMENSIONS).sort()).toEqual(['AREA', 'CLIENT', 'PINCODE', 'PRODUCT']);
    for (const gone of ['STATE', 'CITY', 'VERIFICATION_TYPE']) {
      expect(DIMENSIONS).not.toHaveProperty(gone);
    }
    // and deactivated in the DB catalog (mig 0099) — every reader filters is_active.
    const active = await db!.pool.query<{ code: string }>(
      `SELECT code FROM scope_dimensions WHERE is_active ORDER BY code`,
    );
    expect(active.rows.map((r) => r.code)).toEqual(['AREA', 'CLIENT', 'PINCODE', 'PRODUCT']);
  });
});
