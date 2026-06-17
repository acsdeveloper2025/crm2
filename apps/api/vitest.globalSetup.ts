import { buildTemplateDb, dropTemplateAndClones } from '@crm2/test-utils';

/**
 * Vitest globalSetup — runs ONCE before the whole api suite. Builds the migrated template database
 * that every test file clones a private copy from (per-file DB isolation; see testDb.ts). No-op when
 * DATABASE_URL is unset (integration files self-skip). Teardown removes the template + any clones.
 */
export async function setup(): Promise<void> {
  await buildTemplateDb();
}

export async function teardown(): Promise<void> {
  await dropTemplateAndClones();
}
