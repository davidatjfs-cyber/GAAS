/**
 * 2026-08-06：禁止在同一条 SQL 里把同一个参数「既当 citext 列的值、又用 lower() 包起来」。
 *
 * migration 184 把用户名列全部改成 citext 之后，这个写法会直接报错：
 *   42P08  inconsistent types deduced for parameter $1  (detail: text versus citext)
 * 因为 $1 作为插入值被推断为 citext，而 lower($1) 又要求它是 text，Postgres 无法调和，
 * **整条语句失败**。
 *
 * 这不是理论风险：改造当天 server/domains/notifications/append.js、training/shared.js、
 * sales-sim/notify.js 三处通知写入 SQL 全中，如果直接上生产，所有通知会静默写不进去。
 * 是集成测试先炸出来的（unit test 不连库，看不见）。
 *
 * citext 列的参数不需要也不能再套 lower()——比较本来就忽略大小写，直接 `col = $1`。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const serverRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const SKIP = ['node_modules', '.stryker-tmp', 'reports', 'migrations'];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP.includes(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (name.endsWith('.js') || name.endsWith('.mjs')) out.push(p);
  }
  return out;
}

/** 找出「同一参数既裸用又被 lower() 包」且语句是 INSERT/UPDATE 的 SQL 字面量。 */
function findConflicts(source) {
  const found = [];
  const literals = source.match(/`[^`]*`/g) || [];
  for (const lit of literals) {
    if (!/lower\(\s*\$\d+\s*\)/i.test(lit)) continue;
    if (!/INSERT\s+INTO|UPDATE\s+\w+\s+SET/i.test(lit)) continue;
    const lowered = new Set([...lit.matchAll(/lower\(\s*(\$\d+)\s*\)/gi)].map((m) => m[1]));
    for (const p of lowered) {
      const total = [...lit.matchAll(new RegExp('\\' + p + '(?![0-9])', 'g'))].length;
      const inLower = [...lit.matchAll(new RegExp('lower\\(\\s*\\' + p + '\\s*\\)', 'gi'))].length;
      if (total > inLower) found.push({ param: p, sql: lit.replace(/\s+/g, ' ').slice(0, 120) });
    }
  }
  return found;
}

test('禁止 citext 参数冲突：同一参数不能既作插入值又被 lower() 包裹', () => {
  const offenders = [];
  for (const file of walk(serverRoot)) {
    for (const c of findConflicts(readFileSync(file, 'utf8'))) {
      offenders.push(`${file.replace(serverRoot, 'server')}  ${c.param}\n      ${c.sql}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    '这些 SQL 会在 citext 列上报 42P08（text versus citext），整条语句失败。\n' +
      'citext 比较本来就忽略大小写，把 lower(col) = lower($n) 直接改成 col = $n 即可。\n  ' +
      offenders.join('\n  ')
  );
});

test('扫描器自身有效：能识别出典型冲突写法', () => {
  const bad =
    '`INSERT INTO t (username, msg) SELECT $1, $2 WHERE NOT EXISTS (' +
    'SELECT 1 FROM t WHERE lower(username) = lower($1))`';
  assert.equal(findConflicts(bad).length, 1, '扫描器应能识别这个典型冲突');

  const ok = "`SELECT 1 FROM t WHERE lower(username) = lower($1)`";
  assert.equal(findConflicts(ok).length, 0, '纯查询里的 lower($1) 不冲突，不该误报');
});
