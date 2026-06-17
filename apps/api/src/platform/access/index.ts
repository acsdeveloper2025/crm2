import { loadRoleAttributes, type RoleAttributes } from './repository.js';

export type { RoleAttributes, HierarchyMode } from './repository.js';

/**
 * Cached role-attribute resolution (ADR-0022). authorize() decisions read these attributes off
 * req.auth on every request, so resolution is cached in-process with a short TTL; any role/permission
 * edit calls `invalidateRoleCache()` for best-effort-instant effect (the TTL bounds staleness for
 * other processes; cross-worker invalidation is a GA concern — single process today).
 */
const ROLE_CACHE_TTL_MS = 5_000;

interface CacheEntry {
  value: RoleAttributes | null;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

export async function getRoleAttributes(roleCode: string): Promise<RoleAttributes | null> {
  const hit = cache.get(roleCode);
  if (hit && hit.expiresAt > Date.now()) return hit.value;
  const value = await loadRoleAttributes(roleCode);
  cache.set(roleCode, { value, expiresAt: Date.now() + ROLE_CACHE_TTL_MS });
  return value;
}

/** Drop every cached role — called by the roles service after any config write. */
export function invalidateRoleCache(): void {
  cache.clear();
}
