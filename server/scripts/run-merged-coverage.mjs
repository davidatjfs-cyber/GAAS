#!/usr/bin/env node
/**
 * Wave A：单测 + 集成测试合并覆盖率（观测口径，不改棘轮）。
 *
 * 共享 NODE_V8_COVERAGE 目录，让 bootApp 子进程(index.js)的执行量也进报告。
 * 现有 test:coverage / coverage-ratchet.json 仍是权威闸门；本脚本只产出
 * coverage/merged-summary.json 供对照，失败仅因测试本身失败。
 *
 * 依赖：Postgres 测试库已 migrate + setup-test-role（与 CI test-integration 相同）。
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);

function walkUnitTests(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    if (name === 'node_modules' || name === 'coverage') continue;
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) {
      if (p.includes(`${path.sep}test${path.sep}integration`)) continue;
      walkUnitTests(p, out);
    } else if (name.endsWith('.test.mjs')) {
      out.push(p);
    }
  }
  return out;
}

function walkIntegrationTests() {
  const root = path.join(serverRoot, 'test', 'integration');
  const out = [];
  function walk(dir) {
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      const st = fs.statSync(p);
      if (st.isDirectory()) walk(p);
      else if (name.endsWith('.test.mjs')) out.push(p);
    }
  }
  walk(root);
  return out.sort();
}

function loadExcludes() {
  const exempt = JSON.parse(
    fs.readFileSync(path.join(serverRoot, 'coverage-exempt.json'), 'utf8')
  );
  return (exempt.patterns || [])
    .map((p) => String(p.glob || '').trim())
    .filter(Boolean)
    .map((g) => g.replace(/\\/g, '/'))
    // 合并口径要看见 integration 跑到的业务代码；测试文件本身仍排除
    .filter((g) => g !== 'test/integration/**');
}

const coverDir = path.join(serverRoot, 'coverage', 'v8-raw');
const outDir = path.join(serverRoot, 'coverage');
fs.rmSync(coverDir, { recursive: true, force: true });
fs.mkdirSync(coverDir, { recursive: true });

const unitTests = walkUnitTests(serverRoot).sort();
const integTests = walkIntegrationTests();
if (!unitTests.length || !integTests.length) {
  console.error('[merged-coverage] missing unit or integration tests');
  process.exit(2);
}

const env = {
  ...process.env,
  NODE_V8_COVERAGE: coverDir,
  GAAS_COVERAGE_GRACEFUL: '1',
};

console.log(`[merged-coverage] NODE_V8_COVERAGE=${coverDir}`);
console.log(`[merged-coverage] unit=${unitTests.length} integration=${integTests.length}`);

const unit = spawnSync(
  process.execPath,
  ['--test', '--test-force-exit', ...unitTests],
  { cwd: serverRoot, stdio: 'inherit', env }
);
if (unit.status !== 0) {
  console.error('[merged-coverage] unit tests failed');
  process.exit(unit.status == null ? 1 : unit.status);
}

const integ = spawnSync(
  process.execPath,
  ['--test', '--test-concurrency=2', '--test-force-exit', ...integTests],
  { cwd: serverRoot, stdio: 'inherit', env }
);
if (integ.status !== 0) {
  console.error('[merged-coverage] integration tests failed');
  process.exit(integ.status == null ? 1 : integ.status);
}

const excludes = loadExcludes();
let c8bin;
try {
  c8bin = require.resolve('c8/bin/c8.js');
} catch {
  console.error('[merged-coverage] c8 not installed; run npm ci in repo root');
  process.exit(2);
}

const reportArgs = [
  c8bin,
  'report',
  `--temp-directory=${coverDir}`,
  `--reports-dir=${path.join(outDir, 'merged')}`,
  '--reporter=text-summary',
  '--reporter=json-summary',
  // 与单测棘轮同一套 exclude 语义（去掉 integration 目录豁免）
];
for (const g of excludes) {
  reportArgs.push(`--exclude=${g}`);
}

const report = spawnSync(process.execPath, reportArgs, {
  cwd: serverRoot,
  stdio: 'inherit',
  env: process.env,
});
if (report.status !== 0) {
  console.error('[merged-coverage] c8 report failed');
  process.exit(report.status == null ? 1 : report.status);
}

const summaryPath = path.join(outDir, 'merged', 'coverage-summary.json');
const summaryOut = path.join(outDir, 'merged-summary.json');
if (!fs.existsSync(summaryPath)) {
  console.error('[merged-coverage] missing coverage-summary.json from c8');
  process.exit(2);
}
const raw = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
const total = raw.total || {};
const payload = {
  mode: 'merged-unit+integration',
  generatedAt: new Date().toISOString(),
  lines: Number(total.lines?.pct) || 0,
  branches: Number(total.branches?.pct) || 0,
  functions: Number(total.functions?.pct) || 0,
  statements: Number(total.statements?.pct) || 0,
  note: '观测口径，不驱动棘轮。Wave B 稳定后再把 coverage-ratchet 切到此口径。',
};
fs.writeFileSync(summaryOut, `${JSON.stringify(payload, null, 2)}\n`);
console.log('[merged-coverage] summary → coverage/merged-summary.json');
console.log(
  `[merged-coverage] lines=${payload.lines} branches=${payload.branches} functions=${payload.functions}`
);
process.exit(0);
