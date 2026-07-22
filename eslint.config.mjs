/** Week1 卫生：只拦空 catch / 未使用变量；用 max-warnings 卡存量禁新增。 */
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
      // 存量用 warn + max-warnings 卡住；新增空 catch / 未使用变量会推高计数导致 CI 失败
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
];
