import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';
import { defineConfig, globalIgnores } from 'eslint/config';
// Disables ESLint stylistic rules that would conflict with Prettier.
// Keep this LAST so it wins over the rules above.
import prettier from 'eslint-config-prettier';

export default defineConfig([
  globalIgnores(['dist', 'node_modules', '.vercel']),

  // Frontend (browser) source.
  {
    files: ['src/**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
  },

  // Server-side code: Vercel serverless functions (/api) and shared
  // server-only libraries (/lib). These run on Node, not in the browser.
  {
    files: ['api/**/*.ts', 'lib/**/*.ts'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: {
      globals: globals.node,
    },
  },

  prettier,
]);
