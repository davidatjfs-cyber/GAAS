/**
 * P2.2：console.log|warn|error 棘轮。
 * - domains/** 全禁（与 eslint no-console 双保险）
 * - 非巨石运行时 server/** 全禁（防止本轮清零后回潮）
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(__dirname, '..');
const domainsRoot = path.join(serverRoot, 'domains');

const SKIP_DIRS = new Set([
  'node_modules',
  'coverage',
  'dist',
  '.git',
  'tmp',
  '.stryker-tmp',
  'reports',
]);

function walkJs(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walkJs(p, out);
    else if (/\.(js|mjs)$/.test(name)) out.push(p);
  }
  return out;
}

function countConsoleCalls(src, methods = ['log', 'warn', 'error']) {
  const re = new RegExp(
    `(?:^|[^.\\w])console\\.(?:${methods.map((m) => m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\s*\\(`,
    'g'
  );
  let n = 0;
  for (const line of src.split('\n')) {
    const t = line.trim();
    if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) continue;
    const matches = line.match(re);
    if (matches) n += matches.length;
  }
  return n;
}

function loadRatchet() {
  return JSON.parse(
    fs.readFileSync(path.join(serverRoot, 'console-log-ratchet.json'), 'utf8')
  );
}

function isRuntimeExempt(rel, ratchet) {
  const exact = new Set(ratchet.runtimeExemptExact || []);
  if (exact.has(rel)) return true;
  for (const pref of ratchet.runtimeExemptPrefixes || []) {
    if (rel.startsWith(pref)) return true;
  }
  const base = path.posix.basename(rel);
  for (const pat of ratchet.runtimeExemptNamePatterns || []) {
    if (new RegExp(pat).test(base)) return true;
  }
  return false;
}

test('console-log-ratchet.json 只降不升（地板）', () => {
  const ratchet = loadRatchet();
  assert.equal(typeof ratchet.maxCount, 'number');
  assert.ok(ratchet.maxCount <= 0, `maxCount=${ratchet.maxCount} 禁止上调（已冻结 0）`);
  assert.ok((ratchet.domainsMaxCount ?? ratchet.maxCount) <= 0);
  assert.ok((ratchet.runtimeMaxCount ?? 0) <= 0);
  assert.ok(Array.isArray(ratchet.methods) && ratchet.methods.includes('log'));
});

test('domains/** console.log|warn|error 数量 ≤ 棘轮；新文件不得含', () => {
  const ratchet = loadRatchet();
  const methods = ratchet.methods || ['log', 'warn', 'error'];
  const max = Number.isFinite(ratchet.domainsMaxCount)
    ? ratchet.domainsMaxCount
    : ratchet.maxCount;
  const baselinePath = path.join(serverRoot, 'console-log-baseline.json');
  let baselineFiles = new Set();
  if (fs.existsSync(baselinePath)) {
    const bl = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
    baselineFiles = new Set(bl.files || []);
  }

  const files = walkJs(domainsRoot);
  let total = 0;
  const offendersNew = [];
  const byFile = [];
  for (const abs of files) {
    const rel = path.relative(serverRoot, abs).replace(/\\/g, '/');
    const src = fs.readFileSync(abs, 'utf8');
    const n = countConsoleCalls(src, methods);
    if (n > 0) {
      total += n;
      byFile.push(`${rel}:${n}`);
      if (baselineFiles.size && !baselineFiles.has(rel)) {
        offendersNew.push(`${rel} (+${n})`);
      }
    }
  }

  assert.ok(
    total <= max,
    `domains console(${methods.join('|')})=${total} > max=${max}\n${byFile.join('\n')}`
  );
  assert.deepEqual(
    offendersNew,
    [],
    `新 domains 文件禁止 console.*（请改用 utils/logger）：\n${offendersNew.join('\n')}`
  );
});

test('非巨石运行时 server/** console.log|warn|error = 0', () => {
  const ratchet = loadRatchet();
  const methods = ratchet.methods || ['log', 'warn', 'error'];
  const max = Number.isFinite(ratchet.runtimeMaxCount) ? ratchet.runtimeMaxCount : 0;
  const files = walkJs(serverRoot);
  let total = 0;
  const byFile = [];
  for (const abs of files) {
    const rel = path.relative(serverRoot, abs).replace(/\\/g, '/');
    if (isRuntimeExempt(rel, ratchet)) continue;
    // domains 已由上一测覆盖；此处仍计入，保持「运行时整体」口径
    const src = fs.readFileSync(abs, 'utf8');
    const n = countConsoleCalls(src, methods);
    if (n > 0) {
      total += n;
      byFile.push(`${rel}:${n}`);
    }
  }
  assert.ok(
    total <= max,
    `runtime console(${methods.join('|')})=${total} > max=${max}\n${byFile.join('\n')}`
  );
});
