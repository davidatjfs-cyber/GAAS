/**
 * P5.5 — L1 mutation testing (command runner + node:test).
 *
 * Default mutate set: server/mutation-l1-mutate.json（实测 score≥70 的子集）。
 * Coverage floor 仍是 l1-coverage-floor.json；二者解耦——覆盖闸门与变异闸门分开。
 *
 * Usage:
 *   npm run test:mutation:l1              # default high-signal mutate set
 *   npm run test:mutation:l1:dry          # validate setup (no mutants executed)
 *   MUTATION_MUTATE='domains/shared/time-number.js' npm run test:mutation:l1
 *   MUTATION_MUTATE=all npm run test:mutation:l1   # full l1-coverage-floor (expect lower score)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const l1Floor = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'l1-coverage-floor.json'), 'utf8')
);
const mutateAllow = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'mutation-l1-mutate.json'), 'utf8')
);

/** @type {string[]} */
const L1_FLOOR_FILES = Object.keys(l1Floor.files).sort();
/** @type {string[]} */
const L1_MUTATE_DEFAULT = [...mutateAllow.files].sort();

/**
 * Unit tests that directly import L1 modules (grep-verified 2026-07-26).
 * @type {string[]}
 */
const L1_TEST_FILES = [
  'domains/employees/__tests__/account-gate-helpers.test.mjs',
  'domains/employees/__tests__/account-gate-log.test.mjs',
  'domains/shared/__tests__/agents-service-auth-helpers.test.mjs',
  'domains/approvals/__tests__/normalize-helpers.test.mjs',
  'domains/approvals/__tests__/approvals-handlers-direct.test.mjs',
  'domains/approvals/__tests__/approvals-handlers-offboarding-promotion.test.mjs',
  'domains/approvals/__tests__/onboarding-payload.test.mjs',
  'domains/store-duty-bindings/__tests__/store-access-context-helpers.test.mjs',
  'domains/tenant-platform/__tests__/tenant-platform-auth-guards.test.mjs',
  'domains/tenant-platform/__tests__/tenant-platform-routes-auth.test.mjs',
  'domains/tenant-platform/__tests__/tenant-platform-routes-billing.test.mjs',
  'domains/shared/__tests__/time-number.test.mjs',
  'domains/employees/__tests__/user-lookup.test.mjs',
];

const DEFAULT_TEST_CMD = `node --experimental-test-module-mocks --test --test-force-exit ${L1_TEST_FILES.join(' ')}`;

const mutateOverride = process.env.MUTATION_MUTATE?.trim();
let mutate;
if (!mutateOverride) {
  mutate = L1_MUTATE_DEFAULT;
} else if (mutateOverride === 'all') {
  mutate = L1_FLOOR_FILES;
} else {
  mutate = mutateOverride.split(/[,\s]+/).filter(Boolean);
}

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
    // Default mutate set is curated to clear this floor (2026-07-27 full run subset ≥70).
    // Full-floor `MUTATION_MUTATE=all` historically ~59% — use for observation, not gate.
    break: 70,
  },
  concurrency: process.env.MUTATION_CONCURRENCY
    ? Number(process.env.MUTATION_CONCURRENCY)
    : 2,
  timeoutMS: 120_000,
  timeoutFactor: 2,
  reporters: ['clear-text', 'progress'],
  tempDirName: '.stryker-tmp',
};
