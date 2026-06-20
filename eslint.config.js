import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', '*.config.ts', '*.config.js', 'demo/**', 'scripts/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { chrome: 'readonly' } },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/explicit-function-return-type': ['warn', { allowExpressions: true }],
      'no-console': ['warn', { allow: ['warn', 'error', 'debug'] }],
    },
  },
);
