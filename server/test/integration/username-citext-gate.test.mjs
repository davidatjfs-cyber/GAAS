/**
 * 2026-08-06：用户名列必须是 citext（大小写不敏感），新增的也不例外。
 *
 * 背景：同一个人在库里被拆成两个身份——真账号 NNYXYF26，通知却写成 nnyxyf26。
 * 后果是"已读的又变未读""指派给你的任务查不到"。根因不是某一处写错，而是
 * **不变量靠约定维护**：代码里 120 处记得写 lower(username)、94 处没写。
 * 逐个补 lower() 属于同类修法，补完这批下一批新 SQL 照样漏（见 CLAUDE.md
 * 「反复复发类问题」第 1 条）。
 *
 * migration 184 把大小写不敏感变成**列的类型属性**，那 94 处裸比较自动变正确。
 * 这条闸门保证以后新建的用户名列不会退回 text/varchar——否则漂移会从新表重新长出来，
 * 而加那张表的人根本不知道有这条约定要遵守。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { testDb } from './helpers/db.mjs';

const USERNAME_COLUMNS = ['username', 'target_username', 'assignee_username', 'created_by'];

test('所有用户名列必须是 citext，不能是 text/varchar', async () => {
  const db = testDb();
  const r = await db.query(
    `SELECT c.table_name, c.column_name, c.data_type
       FROM information_schema.columns c
       JOIN information_schema.tables tb
         ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name
      WHERE c.table_schema = 'public'
        AND tb.table_type = 'BASE TABLE'
        AND c.column_name = ANY($1)
        AND c.data_type IN ('text', 'character varying')
        AND c.table_name NOT LIKE '%_backup'
        AND c.table_name NOT LIKE '%_legacy%'
      ORDER BY c.table_name, c.column_name`,
    [USERNAME_COLUMNS]
  );
  const offenders = (r.rows || []).map((x) => `${x.table_name}.${x.column_name} (${x.data_type})`);
  assert.deepEqual(
    offenders,
    [],
    '这些用户名列还是大小写敏感的 text/varchar。新建表时请用 citext——' +
      '否则同一个人会因为写入方大小写不一致被拆成两个身份（已读状态/任务指派会错乱）。' +
      '参考 server/migrations/184_username_citext.sql。漏网列：\n  ' + offenders.join('\n  ')
  );
});

test('users.username 的唯一约束必须大小写不敏感（一个人一个账号）', async () => {
  const db = testDb();
  const r = await db.query(
    `SELECT udt_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name='users' AND column_name='username'`
  );
  assert.equal(
    r.rows?.[0]?.udt_name,
    'citext',
    'users.username 必须是 citext，否则可以建出 Foo / foo 两个独立账号'
  );
});
