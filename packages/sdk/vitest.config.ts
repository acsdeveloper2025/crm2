import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      // Always-on coverage gate. The SDK is the web+mobile contract — contracts (zod)
      // and the typed transport (client.ts) are unit-tested. Floors are the honest
      // current level; ratchet up as branch coverage improves (TECH_DEBT_POLICY).
      enabled: true,
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/index.ts'],
      thresholds: { lines: 90, functions: 90, branches: 65, statements: 90 },
    },
  },
});
