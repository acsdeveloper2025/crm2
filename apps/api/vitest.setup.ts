import { beforeEach } from 'vitest';
import { invalidateRoleCache } from './src/platform/access/index.js';

/**
 * In-process isolation half (pairs with the per-file DB clone): the role-attribute cache
 * (platform/access) is a module-level Map with a 5s TTL, shared across every test in the singleFork
 * process. The data-scope tests mutate role config (hierarchy_mode / role_scope_dimensions) and rely
 * on `invalidateRoleCache()`, but a sibling test that merely READS a role caches it, so a later
 * test could resolve scope against a stale cached config — the residual intra-file flake (a
 * different data-scope/visibility test failed each run; every file still failed alone). Clearing the
 * cache before EVERY test makes each test resolve role config fresh from its own clone DB. Safe: no
 * test asserts cache staleness (the cache is a pure perf optimization — re-reading is always correct).
 */
beforeEach(() => {
  invalidateRoleCache();
});
