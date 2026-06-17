import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createApp } from '../../http/app.js';
import { buildOpenApiDocument } from './document.js';
import { logger } from '@crm2/logger';

/**
 * `pnpm openapi` — regenerate the committed `apps/api/openapi.json` from the live app
 * (ADR-0031, B-11). CI re-runs this and `git diff --exit-code`s the file, so an API-surface change
 * that isn't reflected in the spec fails the build (the contract test enforces the same locally).
 * DB-free: route enumeration never touches the pool.
 */
const OUT = fileURLToPath(new URL('../../../openapi.json', import.meta.url));

const doc = buildOpenApiDocument(createApp());
writeFileSync(OUT, JSON.stringify(doc, null, 2) + '\n');
logger.info('openapi: wrote spec', { path: OUT, paths: Object.keys(doc.paths).length });
