import type { Express } from 'express';

/**
 * OpenAPI generation (B-11 / ADR-0031) — phase 1: the API SURFACE contract.
 *
 * The document is DERIVED from the live Express app (the single source of truth for what endpoints
 * exist) — never hand-maintained, so it cannot silently drift from the code. Phase 1 emits paths ·
 * methods · tags · security (Bearer-JWT by default, cleared for the public endpoints). Request/
 * response SCHEMAS are phase 2 (move responses into zod, then emit them via z.infer — the
 * zod-single-source target in ADR-0031); they are intentionally omitted here, not forgotten.
 *
 * Consumed by: `cli.ts` (writes the committed `openapi.json`, git-diff-gated in CI) and the contract
 * test (asserts the committed artifact is current + the SDK references only real routes).
 */

export interface ApiRoute {
  method: string;
  path: string;
}

// Express router layer internals (not in @types/express). Structurally typed + reached via an
// `unknown` cast — no `any` (banned). The root router stack is `_router` on Express 4, `router` on
// Express 5. A mounted sub-router's prefix is read from `__mountPrefix`, which `createApp`'s
// `mount()` helper stamps onto the router at registration: Express 5 (router v2 / path-to-regexp
// v8) compiles the mount path to an opaque matcher and no longer exposes a `regexp` to reconstruct
// it from, so the prefix is recorded explicitly rather than reverse-engineered.
interface RouteLayer {
  route?: { path: string; methods: Record<string, boolean> };
  name?: string;
  handle?: { stack?: RouteLayer[]; __mountPrefix?: string };
}
interface RouterLike {
  stack: RouteLayer[];
}

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

/** Endpoints reachable WITHOUT a JWT (mounted before the auth middleware, or auth-issuing). */
const PUBLIC_PATHS = new Set([
  '/api/v2/health',
  '/api/v2/time',
  '/api/v2/auth/login',
  '/api/v2/auth/refresh',
]);

/** Walk the router tree → every `{method, path}` under `/api/v2`. */
export function listApiRoutes(app: Express): ApiRoute[] {
  const root =
    (app as unknown as { _router?: RouterLike; router?: RouterLike })._router ??
    (app as unknown as { router?: RouterLike }).router;
  const out: ApiRoute[] = [];
  const walk = (stack: RouteLayer[], prefix: string): void => {
    for (const layer of stack) {
      if (layer.route) {
        const path = (prefix + layer.route.path).replace(/\/+$/, '') || '/';
        if (!path.startsWith('/api/v2')) continue;
        for (const m of HTTP_METHODS) if (layer.route.methods[m]) out.push({ method: m.toUpperCase(), path });
      } else if (layer.name === 'router' && layer.handle?.stack) {
        walk(layer.handle.stack, prefix + (layer.handle.__mountPrefix ?? ''));
      }
    }
  };
  if (root) walk(root.stack, '');
  // Deterministic order: path then method (stable git-diff + stable test snapshot).
  return out.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
}

/** First path segment after `/api/v2` → the OpenAPI tag (e.g. `/api/v2/saved-views/:id` → `saved-views`). */
function tagFor(path: string): string {
  return path.replace(/^\/api\/v2\/?/, '').split('/')[0] || 'root';
}

/** `:id` → OpenAPI `{id}` path-template form. */
function toTemplate(path: string): string {
  return path.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
}

interface OperationObject {
  tags: string[];
  operationId: string;
  summary: string;
  security?: { bearerAuth: [] }[];
  responses: Record<string, { description: string }>;
}

export interface OpenApiDocument {
  openapi: string;
  info: { title: string; version: string; description: string };
  components: { securitySchemes: { bearerAuth: { type: string; scheme: string; bearerFormat: string } } };
  security: { bearerAuth: [] }[];
  paths: Record<string, Record<string, OperationObject>>;
}

/**
 * Build the OpenAPI 3.1 document from the live app. Pure (app → doc), DB-free — safe to run at build
 * time and in the test suite. `version` defaults to the API contract major (`/api/v2` → `2.0.0`).
 */
export function buildOpenApiDocument(app: Express, version = '2.0.0'): OpenApiDocument {
  const paths: OpenApiDocument['paths'] = {};
  for (const { method, path } of listApiRoutes(app)) {
    const tmpl = toTemplate(path);
    const op: OperationObject = {
      tags: [tagFor(path)],
      operationId: `${method.toLowerCase()}_${path.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '')}`,
      summary: `${method} ${tmpl}`,
      responses: {
        default: { description: 'See @crm2/sdk for the typed shape (response schemas land in phase 2).' },
      },
    };
    // Default = Bearer JWT; clear it only for the known public endpoints.
    op.security = PUBLIC_PATHS.has(path) ? [] : [{ bearerAuth: [] }];
    (paths[tmpl] ??= {})[method.toLowerCase()] = op;
  }
  return {
    openapi: '3.1.0',
    info: {
      title: 'CRM2 API',
      version,
      description:
        'Generated from the live Express app (ADR-0031, B-11). Phase 1 = surface contract ' +
        '(paths/methods/tags/security). Request/response schemas land in phase 2 (zod single source). ' +
        'Do not edit by hand — run `pnpm openapi`.',
    },
    components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } } },
    security: [{ bearerAuth: [] }],
    paths,
  };
}
