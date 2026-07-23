/**
 * P3 闸门：ensureGrowthTables 不得再含 listen-time DDL（schema 走 migrations/153）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(__dirname, '..');

function extractEnsureGrowthTablesBody(src) {
  const start = src.search(/export\s+async\s+function\s+ensureGrowthTables\s*\(/);
  assert.ok(start >= 0, 'ensureGrowthTables not found');
  const fnStart = src.indexOf('{', start);
  let depth = 0;
  for (let i = fnStart; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(fnStart + 1, i);
    }
  }
  throw new Error('unbalanced braces in ensureGrowthTables');
}

test('ensureGrowthTables 不得含 CREATE TABLE', () => {
  const src = fs.readFileSync(path.join(serverRoot, 'growth-api.js'), 'utf8');
  const body = extractEnsureGrowthTablesBody(src);
  assert.doesNotMatch(body, /CREATE\s+TABLE/i, 'DDL 应迁移至 server/migrations/153_growth_tables_from_ensure.sql');
});

test('migration 153 存在且覆盖 growth 核心表', () => {
  const p = path.join(serverRoot, 'migrations/153_growth_tables_from_ensure.sql');
  assert.ok(fs.existsSync(p), '153_growth_tables_from_ensure.sql missing');
  const sql = fs.readFileSync(p, 'utf8');
  assert.match(sql, /growth_customers/i);
  assert.match(sql, /growth_events/i);
});
