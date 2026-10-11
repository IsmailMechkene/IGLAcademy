// ESLint flat config. Type-checking itself is `npm run typecheck` (tsc,
// strict); this catches what tsc does not: hook rules, unused/dead code
// patterns, accidental `any`, and suspicious constructs.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: ['dist/**', 'dist-electron/**', 'release/**', 'node_modules/**', 'data/**', 'scripts/.seed-bundle.cjs'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    files: ['electron/**/*.ts', 'tests/**/*.ts', 'scripts/**/*.{js,mjs,cjs}', '*.config.{ts,mjs}'],
    languageOptions: { globals: globals.node },
  },
  {
    // The CDP scripts evaluate code inside the page, so browser globals are
    // legitimately referenced from Node files.
    files: ['scripts/**/*.{js,mjs}'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
);
