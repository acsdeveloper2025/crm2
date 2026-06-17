/**
 * CRM2 — architectural boundary enforcement (FROZEN). Machine-enforced in CI.
 * Parts 9/25/27/28. Run: pnpm boundaries.
 */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      comment: 'Circular imports are forbidden (Part 25).',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'controller-not-to-repository',
      comment: 'Controllers must call services, never repositories directly (Part 28).',
      severity: 'error',
      from: { path: 'apps/api/src/modules/[^/]+/controller\\.ts$' },
      to: { path: '(repository\\.ts$|/repositories/)' },
    },
    {
      name: 'db-access-only-in-repositories',
      comment: 'Raw DB access (pg / platform/db) is allowed ONLY in repositories + platform/db (Part 9).',
      severity: 'error',
      from: {
        pathNot: '(repository\\.ts$|/repositories/|platform/db\\.ts$|\\.test\\.ts$|/__tests__/|/test-utils/)',
      },
      to: { path: '(^|/)node_modules/pg(/|$)|platform/db\\.ts$' },
    },
    {
      name: 'no-cross-feature-internals',
      comment: 'A feature may not import another feature’s internals — use its public index (Part 27).',
      severity: 'error',
      from: { path: 'apps/web/src/features/([^/]+)/' },
      to: {
        path: 'apps/web/src/features/([^/]+)/',
        pathNot: ['apps/web/src/features/$1/', 'apps/web/src/features/[^/]+/index\\.(ts|tsx)$'],
      },
    },
    {
      name: 'no-orphans',
      comment: 'Unused (orphan) modules — dead code (Part 26).',
      severity: 'warn',
      from: {
        orphan: true,
        // Tooling entry points are orphans by design (run by a tool, never imported):
        // type decls, tests, feature/package index barrels, app mains, *.config.*, and e2e specs/setup.
        pathNot: [
          '\\.d\\.ts$',
          '\\.test\\.ts$',
          '(^|/)index\\.(ts|tsx)$',
          'main\\.ts$',
          'main\\.tsx$',
          '\\.config\\.(ts|js|cjs|mjs)$',
          '(^|/)e2e/',
        ],
      },
      to: {},
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsConfig: { fileName: 'tsconfig.base.json' },
    tsPreCompilationDeps: true,
    exclude: { path: '(node_modules|dist|coverage|\\.turbo|/db/)' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default'],
    },
  },
};
