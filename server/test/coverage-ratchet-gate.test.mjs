/**
 * Phase 0：覆盖率棘轮配置闸门（不跑全量覆盖，只校验配置不被静默削弱）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(__dirname, '..');

/** 历史地板：只升不降（随 Phase 上调整数档） */
const RATCHET_FLOOR = { lines: 42, branches: 59, functions: 45 };

test('coverage-ratchet.json 只升不降（不低于已冻结地板）', () => {
  const ratchet = JSON.parse(
    fs.readFileSync(path.join(serverRoot, 'coverage-ratchet.json'), 'utf8')
  );
  for (const key of ['lines', 'branches', 'functions']) {
    assert.equal(typeof ratchet[key], 'number', `${key} must be number`);
    assert.ok(
      ratchet[key] >= RATCHET_FLOOR[key],
      `${key}=${ratchet[key]} < floor ${RATCHET_FLOOR[key]}（棘轮禁止下调）`
    );
  }
});

test('coverage-exempt.json 不得豁免关键路径前缀', () => {
  const exempt = JSON.parse(
    fs.readFileSync(path.join(serverRoot, 'coverage-exempt.json'), 'utf8')
  );
  const forbidden = exempt.forbiddenPrefixes || [];
  assert.ok(forbidden.length >= 3, 'forbiddenPrefixes 必须存在');
  for (const p of exempt.patterns || []) {
    const g = String(p.glob || '');
    assert.ok(g, 'exempt glob 不能为空');
    assert.ok(String(p.reason || '').trim(), `豁免 ${g} 缺 reason`);
    const norm = g.replace(/^\.\//, '');
    for (const bad of forbidden) {
      assert.ok(
        !norm.startsWith(bad) && norm !== bad,
        `禁止豁免关键路径：${g} 命中 forbiddenPrefixes ${bad}`
      );
    }
  }
});

test('run-unit-coverage.mjs 与 package.json test:coverage 存在', () => {
  assert.ok(fs.existsSync(path.join(serverRoot, 'scripts/run-unit-coverage.mjs')));
  const pkg = JSON.parse(fs.readFileSync(path.join(serverRoot, 'package.json'), 'utf8'));
  assert.equal(typeof pkg.scripts?.['test:coverage'], 'string');
  assert.match(pkg.scripts['test:coverage'], /run-unit-coverage/);
});

test('run-merged-coverage.mjs 与 package.json test:coverage:merged 存在（Wave A 观测）', () => {
  assert.ok(fs.existsSync(path.join(serverRoot, 'scripts/run-merged-coverage.mjs')));
  const pkg = JSON.parse(fs.readFileSync(path.join(serverRoot, 'package.json'), 'utf8'));
  assert.equal(typeof pkg.scripts?.['test:coverage:merged'], 'string');
  assert.match(pkg.scripts['test:coverage:merged'], /run-merged-coverage/);
});

/** 合并口径地板：与单测棘轮并存，只升不降 */
const MERGED_RATCHET_FLOOR = { lines: 44, branches: 59, functions: 44, minIndexJsLines: 60 };

test('coverage-merged-ratchet.json 只升不降且要求 index.js', () => {
  const mr = JSON.parse(
    fs.readFileSync(path.join(serverRoot, 'coverage-merged-ratchet.json'), 'utf8')
  );
  for (const key of ['lines', 'branches', 'functions', 'minIndexJsLines']) {
    assert.equal(typeof mr[key], 'number', `${key} must be number`);
    assert.ok(
      mr[key] >= MERGED_RATCHET_FLOOR[key],
      `merged ${key}=${mr[key]} < floor ${MERGED_RATCHET_FLOOR[key]}`
    );
  }
  assert.equal(mr.requireIndexJs, true);
});

/** L1 分支攻坚地板：只升不降（与 l1-coverage-floor.json 同步） */
const L1_FILE_FLOOR = {
  'domains/approvals/handlers/leave.js': { branches: 79, lines: 95 },
  'domains/approvals/handlers/offboarding.js': { branches: 77, lines: 95 },
  'domains/approvals/handlers/points.js': { branches: 72, lines: 95 },
  'domains/approvals/handlers/onboarding.js': { branches: 72, lines: 95 },
  'domains/approvals/handlers/promotion.js': { branches: 74, lines: 95 },
  'domains/tenant-platform/routes-billing.js': { branches: 68, lines: 95 },
  'domains/tenant-platform/routes-auth.js': { branches: 83, lines: 90 },
};

test('l1-coverage-floor.json 只升不降且含全部 L1 目标文件', () => {
  const floor = JSON.parse(
    fs.readFileSync(path.join(serverRoot, 'l1-coverage-floor.json'), 'utf8')
  );
  assert.equal(typeof floor.targetBranches, 'number');
  assert.ok(floor.targetBranches >= 85);
  for (const [rel, mins] of Object.entries(L1_FILE_FLOOR)) {
    const entry = floor.files?.[rel];
    assert.ok(entry, `missing L1 file ${rel}`);
    for (const [metric, min] of Object.entries(mins)) {
      assert.ok(
        Number(entry[metric]) >= min,
        `${rel}.${metric}=${entry[metric]} < frozen ${min}`
      );
    }
  }
});

test('extracted-coverage-floor.json 新拆文件 ≥80 lines 捆绑', () => {
  const floor = JSON.parse(
    fs.readFileSync(path.join(serverRoot, 'extracted-coverage-floor.json'), 'utf8')
  );
  assert.ok(Number(floor.minLines) >= 80);
  assert.ok(Array.isArray(floor.files) && floor.files.length >= 3);
  for (const rel of floor.files) {
    assert.ok(fs.existsSync(path.join(serverRoot, rel)), `extracted file missing: ${rel}`);
  }
});
