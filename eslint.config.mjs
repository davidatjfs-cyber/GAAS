/** Week1 卫生：存量 warn+棘轮；新文件 no-unused-vars 升为 error。 */
export default [
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'restaurant-ai-growth-video/**',
      '**/coverage/**',
      '**/*.min.js',
    ],
  },
  {
    files: ['server/**/*.js', 'server/**/*.mjs', 'scripts/**/*.js', 'scripts/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        console: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        setTimeout: 'readonly',
        setInterval: 'readonly',
        clearTimeout: 'readonly',
        clearInterval: 'readonly',
        setImmediate: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        fetch: 'readonly',
        FormData: 'readonly',
        AbortController: 'readonly',
        structuredClone: 'readonly',
      },
    },
    rules: {
      'no-empty': ['warn', { allowEmptyCatch: false }],
      'no-unused-vars': [
        'warn',
        {
          args: 'after-used',
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrors: 'none',
        },
      ],
    },
  },
  // 新域 / 新脚本：未使用变量直接 error，避免继续堆 warn 天花板
  {
    files: [
      'server/domains/**/*.js',
      'server/domains/**/*.mjs',
      'server/test/shared-table-writers-gate.test.mjs',
      'server/test/employees-mirror-tx.test.mjs',
      'scripts/eslint-c9-*.mjs',
    ],
    rules: {
      'no-unused-vars': [
        'error',
        {
          args: 'after-used',
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrors: 'none',
        },
      ],
    },
  },
];
