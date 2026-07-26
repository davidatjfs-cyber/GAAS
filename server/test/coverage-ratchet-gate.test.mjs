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
const RATCHET_FLOOR = { lines: 59, branches: 66, functions: 62 };

/** 合并棘轮历史地板：追平 CI 实测后抬升 */
const MERGED_RATCHET_FLOOR = { lines: 57, branches: 68, functions: 53, minIndexJsLines: 48 };

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
  'domains/approvals/handlers/leave.js': { branches: 85, lines: 95 },
  'domains/approvals/handlers/offboarding.js': { branches: 85, lines: 95 },
  'domains/approvals/handlers/points.js': { branches: 85, lines: 95 },
  'domains/approvals/handlers/onboarding.js': { branches: 85, lines: 95 },
  'domains/approvals/handlers/promotion.js': { branches: 85, lines: 95 },
  'domains/tenant-platform/routes-billing.js': { branches: 85, lines: 95 },
  'domains/tenant-platform/routes-auth.js': { branches: 85, lines: 95 },
  'domains/approvals/handlers/monthly-confirm.js': { branches: 85, lines: 95 },
  'domains/approvals/handlers/reward-punishment.js': { branches: 85, lines: 95 },
  'domains/shared/time-number.js': { branches: 95, lines: 95 },
  'domains/approvals/onboarding-payload.js': { branches: 95, lines: 95 },
  'domains/approvals/normalize-helpers.js': { branches: 90, lines: 95 },
  'domains/tenant-platform/auth-guards.js': { branches: 85, lines: 95 },
  'domains/shared/agents-service-auth.js': { branches: 85, lines: 95 },
  'domains/employees/account-gate.js': { branches: 85, lines: 90 },
  'domains/employees/user-lookup.js': { branches: 85, lines: 95 },
  'domains/store-duty-bindings/store-access-context.js': { branches: 85, lines: 95 },
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

test('l2-coverage-floor.json 含 service*.js 且地板只升不降', () => {
  const floor = JSON.parse(
    fs.readFileSync(path.join(serverRoot, 'l2-coverage-floor.json'), 'utf8')
  );
  assert.ok(Number(floor.targetLines) >= 80);
  assert.ok(floor.files && typeof floor.files === 'object');
  const keys = Object.keys(floor.files);
  assert.ok(keys.length >= 40, `expected many L2 files, got ${keys.length}`);
  for (const [rel, entry] of Object.entries(floor.files)) {
    assert.ok(fs.existsSync(path.join(serverRoot, rel)), `L2 file missing: ${rel}`);
    assert.ok(Number(entry.lines) >= 1, `${rel} lines floor missing`);
  }
  assert.ok(Number(floor.files['domains/training/service.js']?.lines) >= 55);
  assert.ok(Number(floor.files['domains/checkin/service.js']?.lines) >= 55);
});
