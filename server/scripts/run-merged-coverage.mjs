#!/usr/bin/env node
/**
 * Wave A：单测 + 集成测试合并覆盖率（观测口径，不改棘轮）。
 *
 * 用 c8 包住两次 node --test，共享 temp-directory，确保 bootApp 子进程
 * （index.js）继承 NODE_V8_COVERAGE 并写入同一目录。
 *
 * 验收：报告中必须出现 server/index.js；否则视为采集失败（exit 2）。
 * 现有 test:coverage / coverage-ratchet.json 仍是权威闸门。
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
    .filter((g) => g !== 'test/integration/**');
}

let c8bin;
try {
  c8bin = require.resolve('c8/bin/c8.js');
} catch {
  console.error('[merged-coverage] c8 not installed; run npm ci in repo root');
  process.exit(2);
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

const excludes = loadExcludes();
const env = {
  ...process.env,
  NODE_V8_COVERAGE: coverDir,
  GAAS_COVERAGE_GRACEFUL: '1',
};

/** 直接 node --test + NODE_V8_COVERAGE（比 c8 包住整次单测快；integ 靠 boot-app wrapper 落盘） */
function runTests(label, nodeArgs) {
  console.log(
    `[merged-coverage] ${label}: node ${nodeArgs.slice(0, 3).join(' ')} ... (${Math.max(0, nodeArgs.length - 2)} files)`
  );
  const r = spawnSync(process.execPath, nodeArgs, {
    cwd: serverRoot,
    stdio: 'inherit',
    env,
  });
  if (r.status !== 0) {
    console.error(`[merged-coverage] ${label} failed`);
    process.exit(r.status == null ? 1 : r.status);
  }
}

console.log(`[merged-coverage] temp=${coverDir}`);
console.log(`[merged-coverage] unit=${unitTests.length} integration=${integTests.length}`);

runTests('unit', ['--test', '--test-force-exit', ...unitTests]);
runTests('integration', [
  '--test',
  '--test-concurrency=2',
  '--test-force-exit',
  ...integTests,
]);

const reportArgs = [
  c8bin,
  'report',
  `--temp-directory=${coverDir}`,
  `--reports-dir=${path.join(outDir, 'merged')}`,
  '--reporter=text-summary',
  '--reporter=json-summary',
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

const indexKey = Object.keys(raw).find((k) =>
  /(^|\/)index\.js$/.test(k.replace(/\\/g, '/')) && !k.includes('node_modules')
);
if (!indexKey) {
  console.error(
    '[merged-coverage] FAIL: server/index.js 未出现在合并报告中——子进程覆盖未采到。'
    + ' 检查 boot-app 优雅退出 / NODE_V8_COVERAGE 继承。'
  );
  process.exit(2);
}
const indexLines = raw[indexKey]?.lines || {};
console.log(
  `[merged-coverage] index.js lines=${indexLines.pct}% (${indexLines.covered}/${indexLines.total})`
);

const payload = {
  mode: 'merged-unit+integration',
  generatedAt: new Date().toISOString(),
  lines: Number(total.lines?.pct) || 0,
  branches: Number(total.branches?.pct) || 0,
  functions: Number(total.functions?.pct) || 0,
  statements: Number(total.statements?.pct) || 0,
  indexJsLinesPct: Number(indexLines.pct) || 0,
  indexJsKey: indexKey,
  note: '双棘轮：本脚本校验 coverage-merged-ratchet.json；单测棘轮仍由 test:coverage 负责。',
};
fs.writeFileSync(summaryOut, `${JSON.stringify(payload, null, 2)}\n`);
console.log('[merged-coverage] summary → coverage/merged-summary.json');
console.log(
  `[merged-coverage] lines=${payload.lines} branches=${payload.branches} functions=${payload.functions}`
);

const mergedRatchetPath = path.join(serverRoot, 'coverage-merged-ratchet.json');
if (fs.existsSync(mergedRatchetPath)) {
  const mr = JSON.parse(fs.readFileSync(mergedRatchetPath, 'utf8'));
  // 合并覆盖对子进程落盘敏感，允许小幅波动（默认 0.5pp）
  const tol = Number.isFinite(Number(mr.tolerancePct)) ? Number(mr.tolerancePct) : 0.5;
  const checks = [
    ['lines', payload.lines, Number(mr.lines)],
    ['branches', payload.branches, Number(mr.branches)],
    ['functions', payload.functions, Number(mr.functions)],
  ];
  let failed = false;
  for (const [name, actual, floor] of checks) {
    if (!Number.isFinite(floor)) continue;
    if (actual + tol + 1e-9 < floor) {
      console.error(`[merged-coverage] ratchet FAIL ${name}=${actual} < ${floor} (tol=${tol})`);
      failed = true;
    } else {
      console.log(`[merged-coverage] ratchet ok ${name}=${actual} >= ${floor} (tol=${tol})`);
    }
  }
  const minIdx = Number(mr.minIndexJsLines);
  if (Number.isFinite(minIdx) && payload.indexJsLinesPct + tol + 1e-9 < minIdx) {
    console.error(
      `[merged-coverage] ratchet FAIL index.js lines=${payload.indexJsLinesPct} < ${minIdx} (tol=${tol})`
    );
    failed = true;
  }
  if (failed) process.exit(1);
}

process.exit(0);
