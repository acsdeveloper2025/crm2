// CRM2 — machine-enforced lint policy (FROZEN). See docs/CI_CD_STANDARDS.md.
// Parts 2/3/6/8/11/12/28: ban any, ts-* suppressions, eslint-disable, console,
// TODO/FIXME/HACK/TEMP, magic numbers (business layer), direct fetch/axios in FE,
// controller→repository imports.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/.turbo/**',
      'db/**',
      'scripts/**',
      '**/*.cjs',
      '**/*.mjs',
      '**/*.config.js',
      '**/tailwind-preset.js',
      '**/postcss.config.js',
      'eslint.config.js',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    files: ['**/*.{ts,tsx}'],
    // Part 3: inline eslint-disable comments are INERT (cannot bypass); an unused/extra
    // directive is itself an error. scripts/check-suppressions.mjs also fails CI on their text.
    linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: 'error' },
    rules: {
      'no-undef': 'off', // TS resolves identifiers
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/ban-ts-comment': [
        'error',
        { 'ts-ignore': true, 'ts-nocheck': true, 'ts-expect-error': true, 'ts-check': false },
      ],
      'no-console': 'error',
      'no-warning-comments': [
        'error',
        { terms: ['todo', 'fixme', 'hack', 'temp', 'xxx'], location: 'anywhere' },
      ],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // Triple-slash `path` references are the canonical way to pull an ambient
      // global augmentation (.d.ts) into a library's public types; allow path, prefer import for types.
      '@typescript-eslint/triple-slash-reference': [
        'error',
        { path: 'always', types: 'prefer-import', lib: 'always' },
      ],
    },
  },
  // Part 8: no magic numbers in BUSINESS LOGIC + DATA ACCESS (where they hide intent).
  // Definitional/schema/config/guard files name their constants in situ — exempt by default.
  {
    files: [
      'apps/api/src/modules/**/service.ts',
      'apps/api/src/modules/**/controller.ts',
      'apps/api/src/modules/**/repository.ts',
      'apps/api/src/modules/**/*-report.repository.ts',
      'apps/api/src/modules/**/*-view.repository.ts',
    ],
    rules: {
      '@typescript-eslint/no-magic-numbers': [
        'error',
        {
          ignore: [-1, 0, 1, 2],
          ignoreEnums: true,
          ignoreReadonlyClassProperties: true,
          ignoreArrayIndexes: true,
        },
      ],
    },
  },
  // Frontend (Part 12): components/features use @crm2/sdk — never raw fetch/axios.
  {
    files: ['apps/web/src/features/**/*.{ts,tsx}', 'apps/web/src/components/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'fetch', message: 'Frontend uses @crm2/sdk, not fetch() (Part 12).' },
      ],
      'no-restricted-imports': [
        'error',
        { paths: [{ name: 'axios', message: 'Frontend uses @crm2/sdk, not axios (Part 12).' }] },
      ],
    },
  },
  // Part 28: controllers call services, never repositories directly.
  {
    files: ['apps/api/src/modules/**/controller.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/repository', '**/repository.js', '**/repositories/*', '**/*.repository*'],
              message: 'Controllers → services → repositories (Part 28).',
            },
          ],
        },
      ],
    },
  },
  { files: ['**/*.test.ts', '**/__tests__/**'], rules: { 'no-console': 'off' } },
  { files: ['**/*.d.ts'], rules: { '@typescript-eslint/no-namespace': 'off' } },
);
