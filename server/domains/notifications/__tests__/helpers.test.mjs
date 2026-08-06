import test from 'node:test';
import assert from 'node:assert/strict';
import { createNotificationsHelpers } from '../create-helpers.js';

function buildHelpers(overrides = {}) {
  const calls = {
    merge: [],
    query: [],
    lark: [],
    invalidate: [],
  };
  const helpers = createNotificationsHelpers({
    pool: {
      query: async (...args) => {
        calls.query.push(args);
        return overrides.poolQueryResult ?? { rows: [] };
      },
    },
    resolveTenantIdDefault: () => 'default',
    hrmsNowISO: () => '2026-07-24T12:00:00+08:00',
    sendLarkMessage: async (...args) => {
      calls.lark.push(args);
      return { ok: true };
    },
    lookupFeishuUserByUsername: async () => null,
    invalidateSharedStateCache: (...args) => {
      calls.invalidate.push(args);
    },
    ...overrides,
  });
  return { helpers, calls };
}

test('makeNotif returns id/title/targetUser/createdAt; type from extra', () => {
  const { helpers } = buildHelpers();
  const n = helpers.makeNotif('alice', 'Hello', 'body', { type: 'system_alert', meta: { a: 1 } });
  assert.ok(String(n.id).startsWith('NOTIF-'));
  assert.equal(n.title, 'Hello');
  assert.equal(n.targetUser, 'alice');
  assert.equal(n.createdAt, '2026-07-24T12:00:00+08:00');
  assert.equal(n.type, 'system_alert');
  assert.deepEqual(n.meta, { a: 1 });
});

test('uniqUsernames dedupes case-insensitively, preserves first casing', () => {
  const { helpers } = buildHelpers();
  assert.deepEqual(helpers.uniqUsernames(['Alice', 'bob', 'ALICE', ' Bob ', '']), ['Alice', 'bob']);
});

test('addStateNotification appends without mutating original array reference incorrectly', () => {
  const { helpers } = buildHelpers();
  const originalList = [{ id: 'n1' }];
  const state = { notifications: originalList, other: 1 };
  const next = helpers.addStateNotification(state, { id: 'n2' });
  assert.equal(state.notifications, originalList);
  assert.equal(state.notifications.length, 1);
  assert.notEqual(next.notifications, originalList);
  assert.equal(next.notifications.length, 2);
  assert.equal(next.other, 1);
  assert.equal(next.notifications[1].id, 'n2');
});

test('systemAlertTitle takes first line, truncates', () => {
  const { helpers } = buildHelpers();
  assert.equal(helpers.systemAlertTitle('  line1\nline2  '), 'line1');
  const long = 'x'.repeat(200);
  assert.equal(helpers.systemAlertTitle(long).length, 120);
  assert.equal(helpers.systemAlertTitle(''), 'HRMS 系统告警');
});

test('appendNotifications([]) no-op (insert not called)', async () => {
  const { helpers, calls } = buildHelpers();
  await helpers.appendNotifications([]);
  assert.equal(calls.query.length, 0);
  await helpers.appendNotifications(null);
  assert.equal(calls.query.length, 0);
});

// 2026-08-03：原来这里断言"先发一条 SELECT 查重、再发一条 INSERT"共2条语句——那正是导致
// 并发下重复插入的两步写法（TOCTOU）。现在合并成单条原子 INSERT ... WHERE NOT EXISTS。
test('appendNotifications with one notif inserts via single atomic dedup-INSERT', async () => {
  const { helpers, calls } = buildHelpers();
  await helpers.appendNotifications([
    {
      targetUser: 'bob',
      title: 'Hi',
      message: 'body',
      type: 'system_notice',
    },
  ]);
  assert.equal(calls.query.length, 1, '判重和插入必须合成一条语句，不能退回两步写法');
  const sql = String(calls.query[0][0]);
  assert.match(sql, /INSERT INTO hrms_user_notifications/);
  assert.match(sql, /WHERE NOT EXISTS/);
  assert.equal(calls.merge.length, 0);
});

// 2026-07-30：实测发现同一批通知(排班/培训/离职等多种类型)在同一秒内被插入了十几万条重复行，
// 拖垮数据库最终拖垮整机——根因是这个共用的落库入口完全没有去重，上层调用方一旦被并发/重复
// 触发多次，这里就无脑各插一遍。
// 2026-07-31：上一版去重锁限定"最近10分钟内"，只能挡突发短时重复——生产实测points_request/
// schedule_notice等类型存在"隔十几分钟到几十分钟重新触发一次"的慢速重复bug，旧的一超过10
// 分钟就不再算重复，堆积到6万+条。改成不限时间，只要同用户+同类型+同文案还有未读通知存在
// 就跳过插入。
// 2026-08-03：判重下沉进 SQL（INSERT ... WHERE NOT EXISTS）后，"跳过插入"由数据库判定，
// 不再是 JS 里 SELECT 完 early-return，所以这里改成断言判重条件本身仍然完整保留在语句里
// （同用户 + 同类型 + 同文案 + 未读/4小时内已读窗口），而不是数一共发了几条语句。
test('appendNotifications：判重条件必须覆盖同用户+同类型+同文案+未读窗口', async () => {
  const { helpers, calls } = buildHelpers();
  await helpers.appendNotifications([
    { targetUser: 'bob', title: 'Hi', message: 'body', type: 'system_notice' },
  ]);
  assert.equal(calls.query.length, 1);
  const sql = String(calls.query[0][0]);
  assert.match(sql, /WHERE NOT EXISTS/);
  // 2026-08-06（migration 184）：target_username 已是 citext，比较天生忽略大小写，
  // 所以判重条件写裸比较。**不能**改回 lower(target_username) = lower($1)：$1 同时是
  // citext 列的插入值，套上 lower() 会让 Postgres 报 42P08（text versus citext）、
  // 整条语句失败，等于所有通知写不进去。闸门见 test/citext-param-conflict-gate.test.mjs。
  assert.match(sql, /WHERE target_username = \$1/);
  assert.doesNotMatch(sql, /lower\(\s*\$1\s*\)/);
  assert.match(sql, /type = \$4/);
  assert.match(sql, /message = \$3/);
  assert.match(sql, /read_at IS NULL OR read_at > NOW\(\) - INTERVAL '4 hours'/);
});

test('notifyAdminsDualWriteFailure with mocked pool returning one open_id calls sendLarkMessage once', async () => {
  const { helpers, calls } = buildHelpers({
    poolQueryResult: { rows: [{ open_id: 'ou_admin_1' }] },
  });
  await helpers.notifyAdminsDualWriteFailure('test-scope', new Error('boom'));
  assert.equal(calls.lark.length, 1);
  assert.equal(calls.lark[0][0], 'ou_admin_1');
  assert.match(String(calls.lark[0][1]), /test-scope/);
  assert.deepEqual(calls.lark[0][2], { skipDedup: true });
});

test('sendAdminSystemAlert(\"\") returns empty recipients', async () => {
  const { helpers, calls } = buildHelpers();
  const r = await helpers.sendAdminSystemAlert('');
  assert.deepEqual(r, { recipients: [], feishuSent: 0, feishuFailed: 0 });
  assert.equal(calls.query.length, 0);
  assert.equal(calls.lark.length, 0);
});

// 2026-08-03：判重+插入合并成单条原子 SQL（INSERT ... SELECT ... WHERE NOT EXISTS）。
// 原来是"先 SELECT 查重、再 INSERT"两条语句，中间的 TOCTOU 竞态会让并发调用各插一条
// 重复通知——这是用户长期反馈"弹窗点了又来"的其中一环。锁定：必须是一条 SQL，且判重
// 条件内联在同一条语句里，不能退回两步写法。
test('insertHrmsUserNotifications 判重与插入必须在同一条原子SQL里完成', async () => {
  const { helpers, calls } = buildHelpers();
  await helpers.insertHrmsUserNotifications([
    {
      targetUser: 'alice',
      title: 't',
      message: 'm',
      type: 'system_notice',
      meta: { k: 1 },
      createdAt: '2026-07-24T12:00:00+08:00',
    },
  ]);
  assert.equal(calls.query.length, 1, '不能再是"先查重再插入"两条语句，否则并发下去重锁形同虚设');
  const sql = String(calls.query[0][0]);
  assert.match(sql, /INSERT INTO hrms_user_notifications/);
  assert.match(sql, /WHERE NOT EXISTS/, '判重条件必须内联在同一条 INSERT 语句里');
  assert.equal(calls.query[0][1][0], 'alice');
  assert.equal(calls.query[0][1][6], 'default');
});
