import test from 'node:test';
import assert from 'node:assert/strict';
import { createNotificationsHelpers } from '../create-helpers.js';

function buildHelpers(overrides = {}) {
  const calls = {
    merge: [],
    query: [],
    lark: [],
  };
  const helpers = createNotificationsHelpers({
    pool: {
      query: async (...args) => {
        calls.query.push(args);
        return overrides.poolQueryResult ?? { rows: [] };
      },
    },
    mergeSharedStateFields: async (...args) => {
      calls.merge.push(args);
    },
    resolveTenantIdDefault: () => 'default',
    hrmsNowISO: () => '2026-07-24T12:00:00+08:00',
    sendLarkMessage: async (...args) => {
      calls.lark.push(args);
      return { ok: true };
    },
    lookupFeishuUserByUsername: async () => null,
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

test('appendNotifications([]) no-op (mergeSharedStateFields not called)', async () => {
  const { helpers, calls } = buildHelpers();
  await helpers.appendNotifications([]);
  assert.equal(calls.merge.length, 0);
  await helpers.appendNotifications(null);
  assert.equal(calls.merge.length, 0);
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

test('insertHrmsUserNotifications with one notif calls pool.query', async () => {
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
  assert.equal(calls.query.length, 1);
  assert.match(String(calls.query[0][0]), /INSERT INTO hrms_user_notifications/);
  assert.equal(calls.query[0][1][0], 'alice');
  assert.equal(calls.query[0][1][6], 'default');
});
