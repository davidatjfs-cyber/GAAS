/**
 * B4 闸门：禁止在可执行 server JS 里再对已 DROP 的 sales_raw 发 SQL。
 * 允许：注释、metric_dictionary 类型标签、文档、migrations 历史、retired stub 文件名。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(__dirname, '..');

const ALLOW_FILES = new Set([
  // 历史脚本文件名保留；内容已改查 pos_sales_detail
  'scripts/verify-bi-sales-raw-totals.mjs',
]);

const SQL_HIT = /\b(FROM|INTO|UPDATE|JOIN|TABLE|DELETE\s+FROM)\s+sales_raw\b/i;

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    if (name === 'node_modules' || name === 'migrations' || name === 'uploads' || name === 'dist') continue;
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(js|mjs)$/.test(name)) out.push(p);
  }
  return out;
}

test('server 可执行代码不得再出现对 sales_raw 的 SQL', () => {
  const files = walk(serverRoot);
  const offenders = [];
  for (const abs of files) {
    const rel = path.relative(serverRoot, abs).replace(/\\/g, '/');
    if (ALLOW_FILES.has(rel)) continue;
    if (rel.endsWith('sales-raw-upload.js')) {
      // stub 内不得残留可执行 SQL（throw 之后的死代码已删）
      const src = fs.readFileSync(abs, 'utf8');
      if (SQL_HIT.test(src)) offenders.push(rel);
      continue;
    }
    const src = fs.readFileSync(abs, 'utf8');
    const lines = src.split('\n');
    lines.forEach((line, i) => {
      const trimmed = line.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return;
      if (SQL_HIT.test(line)) offenders.push(`${rel}:${i + 1}:${trimmed.slice(0, 120)}`);
    });
  }
  assert.deepEqual(offenders, [], `发现 sales_raw SQL：\n${offenders.join('\n')}`);
});
