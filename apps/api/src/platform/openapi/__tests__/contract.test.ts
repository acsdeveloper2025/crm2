import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createApp } from '../../../http/app.js';
import { buildOpenApiDocument, listApiRoutes } from '../document.js';

/**
 * API contract gate (B-11 / B-12, ADR-0031). DB-free — pure route introspection.
 *
 *  1. The committed `openapi.json` MUST equal the doc built from the live app → an API-surface change
 *     that wasn't re-generated (`pnpm openapi`) fails here, not just in CI. This is the drift gate.
 *  2. Every path the hand-written `@crm2/sdk` client references MUST be a real mounted route → the SDK
 *     can never point at a renamed/removed endpoint (the high-signal SDK-drift direction; the reverse
 *     is intentionally NOT asserted — the web app calls import/bulk/export/dashboard/photo endpoints
 *     via the `api()` helper, not the typed client, so those routes legitimately have no SDK method).
 */

const SPEC = fileURLToPath(new URL('../../../../openapi.json', import.meta.url));
const CLIENT_TS = fileURLToPath(new URL('../../../../../../packages/sdk/src/client.ts', import.meta.url));

const normRoute = (p: string): string => p.replace(/:[A-Za-z0-9_]+/g, ':p');
const normSdk = (p: string): string =>
  p
    .replace(/\$\{[^}]+\}/g, ':p') // ${id} → :p
    .replace(/[$?`'"\s].*$/, '') // cut a dangling ${qs / query string / quote / space
    .replace(/\/+$/, '') || '/';

describe('API contract (ADR-0031)', () => {
  const app = createApp();

  it('the committed openapi.json is up to date (run `pnpm openapi` if this fails)', () => {
    const committed = JSON.parse(readFileSync(SPEC, 'utf8')) as unknown;
    expect(committed).toEqual(buildOpenApiDocument(app));
  });

  it('enumerates the API surface (guards against a silently-empty walk)', () => {
    expect(listApiRoutes(app).length).toBeGreaterThan(100);
  });

  it('every @crm2/sdk path resolves to a real mounted route', () => {
    const routes = new Set(listApiRoutes(app).map((r) => normRoute(r.path)));
    const src = readFileSync(CLIENT_TS, 'utf8');
    const sdkPaths = new Set<string>();
    for (const m of src.matchAll(/['"`](\/api\/v2\/[^'"`]*)/g)) sdkPaths.add(normSdk(m[1] ?? ''));
    // reqBlob('<resource>', …) → GET /api/v2/<resource>/export
    for (const m of src.matchAll(/reqBlob\(\s*['"]([^'"]+)['"]/g))
      sdkPaths.add(`/api/v2/${m[1] ?? ''}/export`);

    const dead = [...sdkPaths].filter((p) => !routes.has(p)).sort();
    expect(dead, `SDK references endpoints that don't exist:\n${dead.join('\n')}`).toEqual([]);
  });
});
