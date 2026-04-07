import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  {
    // Ignore patterns globais
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/build/**',
      '**/.turbo/**',
      '**/coverage/**',
      '**/migrations/**',
      'apps/web/.next/**',
      'apps/web/next-env.d.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: {
        ...globals.node,
        ...globals.es2024,
      },
    },
    rules: {
      // TypeScript
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],

      // Best practices
      eqeqeq: ['error', 'smart'],
      'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
      'prefer-const': 'error',
      'no-var': 'error',
      'object-shorthand': 'error',
    },
  },
  // React/Next overrides
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
    rules: {
      'no-console': 'off', // ok no client durante dev
    },
  },
  // Scripts e configs
  {
    files: ['**/*.{js,mjs,cjs}', '**/scripts/**'],
    rules: {
      '@typescript-eslint/no-var-requires': 'off',
      'no-console': 'off',
    },
  },
);
