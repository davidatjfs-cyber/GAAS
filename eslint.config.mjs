/** Week1 卫生：存量 warn+棘轮；新 server 文件 no-unused-vars 默认 error（legacy 除外）。 */
const unusedVarsRule = {
  args: 'after-used',
  argsIgnorePattern: '^_',
  varsIgnorePattern: '^_',
  caughtErrors: 'none',
};

/** 存量巨石 / 仍有 unused-vars 的文件：保持 warn，避免 CI 硬失败。只增不减前请先清 warn。 */
const LEGACY_SERVER_UNUSED_VARS_WARN = [
  'server/index.js',
  'server/agents.js',
  'server/growth-api.js',
  'server/training.js',
  'server/customer-ops.js',
  'server/agents/operation-diagnosis-agent.js',
  'server/ai-quality-learning-routes.js',
  'server/bi-weekly-report.js',
  'server/chief-evaluator-config.js',
  'server/data-executor.js',
  'server/file-auto-backup.js',
  'server/file-manager.js',
  'server/file-routes.js',
  'server/growth-solutions.js',
  'server/hq-planner-agent.js',
  'server/hrms-payroll-routes.js',
  'server/hrms-permission-routes.js',
  'server/llm-config-enhanced.js',
  'server/master-agent.js',
  'server/new-scoring-model.js',
  'server/performance-invalidation-api.js',
  'server/performance-jobs.js',
  'server/sales-ai-routes.js',
  'server/sales-raw-folder-importer.js',
  'server/scripts/debug-calculate-store-rating.mjs',
  'server/services/sales/sales-ops.js',
  'server/services/sales/sales-proposal.js',
  'server/services/tenant-operation-inspection-service.js',
  'server/store-diagnosis.js',
];

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
      'no-unused-vars': ['warn', unusedVarsRule],
    },
  },
  // 新 server 文件（含 domains/）：未使用变量直接 error
  {
    files: ['server/**/*.js', 'server/**/*.mjs'],
    rules: {
      'no-unused-vars': ['error', unusedVarsRule],
    },
  },
  // legacy 巨石：override 回 warn（exclude-style 白名单）
  {
    files: LEGACY_SERVER_UNUSED_VARS_WARN,
    rules: {
      'no-unused-vars': ['warn', unusedVarsRule],
    },
  },
];
