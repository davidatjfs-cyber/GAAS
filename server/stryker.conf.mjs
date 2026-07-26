/**
 * P5.5 — L1 mutation testing (command runner + node:test).
 *
 * Mutates only files listed in l1-coverage-floor.json.
 * Runs a focused unit-test subset that imports those modules (not full npm test).
 *
 * Usage:
 *   npm run test:mutation:l1              # full L1 mutation run
 *   npm run test:mutation:l1:dry          # validate setup (no mutants executed)
 *   MUTATION_MUTATE='domains/shared/time-number.js' npm run test:mutation:l1
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const l1Floor = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'l1-coverage-floor.json'), 'utf8')
);

/** @type {string[]} */
const L1_MUTATE = Object.keys(l1Floor.files).sort();

/**
 * Unit tests that directly import L1 modules (grep-verified 2026-07-26).
 * @type {string[]}
 */
const L1_TEST_FILES = [
  'test/account-gate-helpers.test.mjs',
  'test/agents-service-auth-helpers.test.mjs',
  'test/approval-normalize-helpers.test.mjs',
  'test/approvals-handlers-direct.test.mjs',
  'test/approvals-handlers-offboarding-promotion.test.mjs',
  'test/onboarding-payload.test.mjs',
  'test/store-access-context-helpers.test.mjs',
  'test/tenant-platform-auth-guards.test.mjs',
  'test/tenant-platform-routes-auth.test.mjs',
  'test/tenant-platform-routes-billing.test.mjs',
  'test/time-number-helpers.test.mjs',
  'domains/employees/__tests__/user-lookup.test.mjs',
];

const DEFAULT_TEST_CMD = `node --test --test-force-exit ${L1_TEST_FILES.join(' ')}`;

const mutateOverride = process.env.MUTATION_MUTATE?.trim();
const mutate = mutateOverride
  ? mutateOverride.split(/[,\s]+/).filter(Boolean)
  : L1_MUTATE;

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  packageManager: 'npm',
  testRunner: 'command',
  commandRunner: {
    command: process.env.MUTATION_TEST_CMD?.trim() || DEFAULT_TEST_CMD,
  },
  coverageAnalysis: 'off',
  mutate,
  ignorePatterns: [
    'coverage/**',
    'test/integration/**',
    'node_modules/**',
    '.stryker-tmp/**',
    'reports/**',
  ],
  thresholds: {
    high: 80,
    low: 60,
    break: null,
  },
  concurrency: process.env.MUTATION_CONCURRENCY
    ? Number(process.env.MUTATION_CONCURRENCY)
    : 2,
  timeoutMS: 120_000,
  timeoutFactor: 2,
  reporters: ['clear-text', 'progress'],
  tempDirName: '.stryker-tmp',
};
