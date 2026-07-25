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
const RATCHET_FLOOR = { lines: 42, branches: 59, functions: 44 };

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
