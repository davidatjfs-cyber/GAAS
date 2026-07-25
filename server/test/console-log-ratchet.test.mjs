/**
 * P2.2：domains 内 console.log 棘轮 + 新文件禁令。
 * ESLint 对 domains 的 console.log 为 error；本闸门防「改 eslint 绕过」与数量回升。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(__dirname, '..');
const domainsRoot = path.join(serverRoot, 'domains');

function walkJs(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walkJs(p, out);
    else if (/\.(js|mjs)$/.test(name)) out.push(p);
  }
  return out;
}

function countConsoleLog(src) {
  let n = 0;
  for (const line of src.split('\n')) {
    const t = line.trim();
    if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) continue;
    // 匹配 console.log( …；忽略字符串里的字面讨论
    if (/(?:^|[^.\w])console\.log\s*\(/.test(line)) n += 1;
  }
  return n;
}

test('console-log-ratchet.json 只降不升（地板）', () => {
  const ratchet = JSON.parse(
    fs.readFileSync(path.join(serverRoot, 'console-log-ratchet.json'), 'utf8')
  );
  assert.equal(typeof ratchet.maxCount, 'number');
  assert.ok(ratchet.maxCount <= 35, `maxCount=${ratchet.maxCount} 禁止上调超过已冻结 35`);
  assert.ok(ratchet.maxCount >= 0);
});

test('domains/** console.log 数量 ≤ 棘轮；新文件不得含 console.log', () => {
  const ratchet = JSON.parse(
    fs.readFileSync(path.join(serverRoot, 'console-log-ratchet.json'), 'utf8')
  );
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
    const n = countConsoleLog(src);
    if (n > 0) {
      total += n;
      byFile.push(`${rel}:${n}`);
      if (baselineFiles.size && !baselineFiles.has(rel)) {
        offendersNew.push(`${rel} (+${n})`);
      }
    }
  }

  assert.ok(
    total <= ratchet.maxCount,
    `domains console.log=${total} > maxCount=${ratchet.maxCount}\n${byFile.join('\n')}`
  );
  assert.deepEqual(
    offendersNew,
    [],
    `新 domains 文件禁止 console.log（请改用 utils/logger）：\n${offendersNew.join('\n')}`
  );
});
