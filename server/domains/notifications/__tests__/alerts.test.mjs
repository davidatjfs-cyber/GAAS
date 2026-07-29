/**
 * domains/notifications/{ocr,system,dual-write}-alert.js 分支直测
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createNotifyAdminsOcrFailed } from '../ocr-alert.js';
import {
  systemAlertTitle,
  createSendAdminSystemAlert,
} from '../system-alert.js';
import { createNotifyAdminsDualWriteFailure } from '../dual-write-alert.js';
import { uniqUsernames, createMakeNotif } from '../make-notif.js';
import { createAppendHelpers } from '../append.js';

test('notifyAdminsOcrFailed：无 admin / 发送成功 / 部分失败 / pool 抛错不抛出', async () => {
  const lark = [];
  const notifyEmpty = createNotifyAdminsOcrFailed({
    pool: { query: async () => ({ rows: [] }) },
    sendLarkMessage: async (...a) => {
      lark.push(a);
      return { ok: true };
    },
  });
  await notifyEmpty('f', '图片', 'r');
  assert.equal(lark.length, 0);

  const notifyOk = createNotifyAdminsOcrFailed({
    pool: { query: async () => ({ rows: [{ open_id: 'ou1' }, { open_id: 'ou2' }] }) },
    sendLarkMessage: async (oid, msg) => {
      lark.push([oid, msg]);
      if (oid === 'ou2') throw new Error('lark_down');
      return { ok: true };
    },
  });
  await notifyOk('doc.pdf', 'PDF', 'timeout');
  assert.equal(lark.length, 2);
  assert.match(lark[0][1], /doc\.pdf/);
  assert.match(lark[0][1], /PDF/);

  const notifyBoom = createNotifyAdminsOcrFailed({
    pool: {
      query: async () => {
        throw new Error('db');
      },
    },
    sendLarkMessage: async () => ({ ok: true }),
  });
  await notifyBoom('x', 'y', 'z'); // must not throw
});

test('notifyAdminsDualWriteFailure：无接收人 / 部分失败 / 外层 catch', async () => {
  const lark = [];
  await createNotifyAdminsDualWriteFailure({
    pool: { query: async () => ({ rows: [] }) },
    sendLarkMessage: async (...a) => {
      lark.push(a);
      return {};
    },
  })('scope-a', 'err');
  assert.equal(lark.length, 0);

  await createNotifyAdminsDualWriteFailure({
    pool: { query: async () => ({ rows: [{ open_id: 'ou_a' }] }) },
    sendLarkMessage: async () => {
      throw new Error('feishu');
    },
  })('scope-b', new Error('pg'));

  await createNotifyAdminsDualWriteFailure({
    pool: {
      query: async () => {
        throw new Error('pool_fail');
      },
    },
    sendLarkMessage: async () => ({}),
  })('scope-c', 'x');
});

test('sendAdminSystemAlert：查 admin、显式用户、persist 失败、跳过 persist、角色兜底、全失败', async () => {
  const inserts = [];
  const lark = [];
  const nowIso = '2026-07-26T00:00:00.000Z';
  const makeNotif = createMakeNotif({ hrmsNowISO: () => nowIso });
  // appendNotifications 现在直接落 hrms_user_notifications 表（不再 mergeSharedStateFields
  // 回写 blob），这里就不用再 mock/断言 merge 了。
  const { appendNotifications, insertHrmsUserNotifications } = createAppendHelpers({
    pool: {
      query: async (...args) => {
        inserts.push(args);
        return { rows: [] };
      },
    },
    resolveTenantIdDefault: () => 'default',
    hrmsNowISO: () => nowIso,
  });

  // 无 admin → 空 recipients
  let send = createSendAdminSystemAlert({
    pool: { query: async () => ({ rows: [] }) },
    makeNotif,
    appendNotifications,
    insertHrmsUserNotifications,
    uniqUsernames,
    systemAlertTitle,
    lookupFeishuUserByUsername: async () => null,
    sendLarkMessage: async () => ({ ok: true }),
  });
  assert.deepEqual(await send('hello'), { recipients: [], feishuSent: 0, feishuFailed: 0 });

  // 查到 admin + lookup open_id + 发送成功
  send = createSendAdminSystemAlert({
    pool: {
      query: async (sql) => {
        if (/FROM users/i.test(sql)) return { rows: [{ username: 'admin1' }] };
        if (/FROM feishu_users/i.test(sql) && /lower\(username\)/i.test(sql)) {
          return { rows: [{ open_id: 'ou_admin1' }] };
        }
        if (/role IN/i.test(sql) && /feishu_users/i.test(sql)) {
          return { rows: [{ open_id: 'ou_role' }] };
        }
        return { rows: [] };
      },
    },
    makeNotif,
    appendNotifications,
    insertHrmsUserNotifications,
    uniqUsernames,
    systemAlertTitle,
    lookupFeishuUserByUsername: async () => null,
    sendLarkMessage: async (oid, text) => {
      lark.push([oid, text]);
      return { ok: true };
    },
  });
  let r = await send('line1\nline2', { meta: { k: 1 } });
  assert.deepEqual(r.recipients, ['admin1']);
  assert.equal(r.feishuSent, 2); // admin1 + role fallback
  assert.ok(inserts.length >= 1);

  // 显式 usernames：不做 role 兜底；lookup 命中；persist 抛错仍继续发飞书
  lark.length = 0;
  send = createSendAdminSystemAlert({
    pool: {
      query: async () => ({ rows: [] }),
    },
    makeNotif,
    appendNotifications: async () => {
      throw new Error('persist_boom');
    },
    insertHrmsUserNotifications: async () => {},
    uniqUsernames,
    systemAlertTitle,
    lookupFeishuUserByUsername: async (u) => (u === 'bob' ? { open_id: 'ou_bob' } : null),
    sendLarkMessage: async (oid) => {
      lark.push(oid);
      return { ok: false };
    },
  });
  r = await send('定向告警', { usernames: ['bob', 'bob'], title: 'T' });
  assert.deepEqual(r.recipients, ['bob']);
  assert.equal(lark.length, 1);
  assert.equal(r.feishuSent, 0);
  assert.equal(r.feishuFailed, 1);

  // persistToHrms=false；无 open_id → feishuFailed = recipients.length
  send = createSendAdminSystemAlert({
    pool: { query: async () => ({ rows: [] }) },
    makeNotif,
    appendNotifications: async () => {
      throw new Error('should_not');
    },
    insertHrmsUserNotifications: async () => {},
    uniqUsernames,
    systemAlertTitle,
    lookupFeishuUserByUsername: async () => null,
    sendLarkMessage: async () => ({ ok: true }),
  });
  r = await send('x', { usernames: ['carol'], persistToHrms: false });
  assert.equal(r.feishuSent, 0);
  assert.equal(r.feishuFailed, 1);

  // lookup 抛错忽略；角色兜底查询失败仍返回 recipients
  send = createSendAdminSystemAlert({
    pool: {
      query: async (sql) => {
        if (/FROM users/i.test(sql)) return { rows: [{ username: 'a1' }] };
        if (/DISTINCT open_id/i.test(sql)) throw new Error('role_q');
        return { rows: [] };
      },
    },
    makeNotif,
    appendNotifications: async () => {},
    insertHrmsUserNotifications: async () => {},
    uniqUsernames,
    systemAlertTitle,
    lookupFeishuUserByUsername: async () => {
      throw new Error('lookup');
    },
    sendLarkMessage: async () => ({ ok: true }),
  });
  r = await send('role-fallback-fail');
  assert.deepEqual(r.recipients, ['a1']);
  assert.equal(r.feishuSent, 0);
});
test('appendNotifications / insertHrmsUserNotifications 边角', async () => {
  const q = [];
  const { appendNotifications, insertHrmsUserNotifications } = createAppendHelpers({
    pool: {
      query: async (...a) => {
        q.push(a);
        return {};
      },
    },
    resolveTenantIdDefault: () => 't1',
    hrmsNowISO: () => 'iso',
  });
  // appendNotifications 现在就是 insertHrmsUserNotifications：没有 target 的记录被跳过，
  // 不再落回 hrms_state blob。
  await appendNotifications([{ id: 'n1' }, null]);
  assert.equal(q.length, 0);

  await appendNotifications([{ targetUsername: 'n1user', title: 'T', message: 'M' }]);
  assert.equal(q.length, 1);
  assert.equal(q[0][1][0], 'n1user');

  await insertHrmsUserNotifications([
    { title: 't' }, // no target → skip
    { targetUsername: 'u2', message: 'm', data: { d: 1 } },
  ]);
  assert.equal(q.length, 2);
  assert.equal(q[1][1][0], 'u2');
  assert.equal(q[1][1][6], 't1');
});
