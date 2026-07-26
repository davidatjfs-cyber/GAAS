/**
 * P2.1：单函数体积闸门。
 * - 声明式 function（含 export/async）超过 maxLines → 必须在 allowlist
 * - allowlist 只降不升（禁止新增超大函数后把名单做大）
 * - 外提纪律配套：createXxx 工厂闭包不得整块搬 >200 行而不切分
 *
 * Walk skip audit (2026-07-26): basename-only 'reports' blinded domains/reports/ — fixed via walk-server-js.mjs.
 * Same pattern fixed in console-log-ratchet.test.mjs and shared-table-writers-gate.test.mjs.
 * coverage-exempt.json uses path globs + forbiddenPrefixes (no basename collision).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { walkServerJs } from './walk-server-js.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(__dirname, '..');

const FN_RE =
  /^(?<indent>\s*)(?:export\s+)?(?:async\s+)?function\s+(?<name>\w+)\s*\(/;

function scanOversizedFunctions(absPath, maxLines) {
  const lines = fs.readFileSync(absPath, 'utf8').split('\n');
  const found = [];
  let i = 0;
  while (i < lines.length) {
    const m = lines[i].match(FN_RE);
    if (!m) {
      i += 1;
      continue;
    }
    const name = m.groups.name;
    let j = i;
    let depth = 0;
    let started = false;
    while (j < lines.length) {
      const line = lines[j];
      depth += (line.match(/\{/g) || []).length;
      depth -= (line.match(/\}/g) || []).length;
      if (line.includes('{')) started = true;
      if (started && depth <= 0) {
        const span = j - i + 1;
        if (span > maxLines) {
          found.push({ name, start: i + 1, end: j + 1, lines: span });
        }
        break;
      }
      j += 1;
    }
    i = started ? j + 1 : i + 1;
  }
  return found;
}

function loadRatchet() {
  return JSON.parse(
    fs.readFileSync(path.join(serverRoot, 'function-size-ratchet.json'), 'utf8')
  );
}

test('function-size-ratchet.json 只降不升（maxLines≤200，allowlist 不膨胀）', () => {
  const r = loadRatchet();
  assert.equal(typeof r.maxLines, 'number');
  assert.ok(r.maxLines <= 200, `maxLines=${r.maxLines} 禁止放宽超过 200`);
  assert.ok(r.maxLines >= 100, `maxLines=${r.maxLines} 异常过低`);
  assert.ok(Array.isArray(r.allowlist));
  assert.equal(typeof r.maxAllowlistSize, 'number');
  assert.ok(
    r.allowlist.length <= r.maxAllowlistSize,
    `allowlist=${r.allowlist.length} > maxAllowlistSize=${r.maxAllowlistSize}（禁止膨胀）`
  );
});

test('server 运行时单函数 >maxLines 必须在 allowlist；allowlist 无幽灵条目', () => {
  const r = loadRatchet();
  const maxLines = r.maxLines;
  const allow = new Set(r.allowlist);
  const offenders = [];
  const present = new Set();

  for (const abs of walkServerJs(serverRoot)) {
    const rel = path.relative(serverRoot, abs).replace(/\\/g, '/');
    const keyPrefix = `server/${rel}`;
    for (const fn of scanOversizedFunctions(abs, maxLines)) {
      const key = `${keyPrefix}::${fn.name}`;
      present.add(key);
      if (!allow.has(key)) {
        offenders.push(`${key} (${fn.lines} lines @L${fn.start}-L${fn.end})`);
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `新增/扩大超大函数（>${maxLines} 行）未进 allowlist，且禁止扩大名单——请同批切分：\n${offenders.join('\n')}`
  );

  const stale = r.allowlist.filter((k) => !present.has(k));
  assert.deepEqual(
    stale,
    [],
    `allowlist 含已消失的条目（请删除以只降不升）：\n${stale.join('\n')}`
  );
});
