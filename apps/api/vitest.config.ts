import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Tiny scrypt work factor for tests ONLY (prod stays 16384 via the config default): production
    // scrypt (~2s/hash) saturates the libuv threadpool across the auth tests and, under CI CPU
    // contention, delays in-process responses enough to reset supertest sockets ("socket hang up").
    // A power-of-2 ≪ prod keeps hashing correct (verification reads N from the stored hash) but fast.
    env: { PASSWORD_SCRYPT_N: '16' },
    // Per-file DB isolation: globalSetup migrates ONE template database; each test file's
    // createTestDb() clones a private DB from it (testDb.ts), so no file shares rows or role-config
    // with another. vitest.setup clears the in-process role-attribute cache after each file. Together
    // they give every file the clean slate it has when run alone — the cure for the order-dependent
    // cross-file flakes (a different test failed each run; every file passed in isolation).
    globalSetup: ['./vitest.globalSetup.ts'],
    setupFiles: ['./vitest.setup.ts'],
    // singleFork kept: clone DDL (CREATE/DROP DATABASE) runs cheapest serially and sidesteps any
    // createdb contention. With per-file DBs there is no longer a shared schema for files to race on.
    fileParallelism: false,
    poolOptions: { forks: { singleFork: true } },
    // migrate() now just clones the pre-built template (a fast file copy, not a ~50-migration
    // replay), but keep a generous hook ceiling so a cold first clone never flakes the gate.
    hookTimeout: 30000,
    // Auth tests pay REAL scrypt (~2s per login/password-set); under concurrent lint/build CPU
    // load several in one test legitimately exceed the 5s default (the long-standing "random
    // :5433 flake" root cause). Slow-but-correct must never flake the gate.
    testTimeout: 30000,
    // Integration tests do real supertest round-trips; under heavy concurrent CPU load a
    // socket can transiently reset ("socket hang up") and a different file flakes each run
    // (each passes in isolation). Retry the rare transient so the gate stays deterministic.
    retry: 2,
    coverage: {
      // Always-on so the gate actually runs in `pnpm test` / CI (was configured but
      // never executed — no --coverage flag + provider missing). Thresholds are the
      // honest current floor; ratchet up toward 90/85 as tests are added (TECH_DEBT_POLICY).
      enabled: true,
      provider: 'v8',
      include: ['src/modules/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/__tests__/**'],
      thresholds: { lines: 85, functions: 90, branches: 58, statements: 85 },
    },
  },
});
