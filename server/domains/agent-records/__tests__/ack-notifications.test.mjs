/**
 * 系统通知已读 ack：服务端 read_at 持久化。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { ackMyNotification, listMyNotifications } from '../service.js';

test('listMyNotifications: missing username → 400', async () => {
  const r = await listMyNotifications({ query: async () => ({ rows: [] }) }, '');
  assert.equal(r.ok, false);
  assert.equal(r.status, 400);
});

test('listMyNotifications: returns read_at', async () => {
  const pool = {
    query: async () => ({
      rows: [{ id: 7, title: 't', message: 'm', type: 'x', meta: {}, created_at: '2026-07-27', read_at: null }],
    }),
  };
  const r = await listMyNotifications(pool, 'alice');
  assert.equal(r.ok, true);
  assert.equal(r.items[0].id, 7);
  assert.equal(r.items[0].read_at, null);
});

test('listMyNotifications: unreadOnly adds read_at IS NULL filter', async () => {
  const sqls = [];
  const pool = {
    query: async (sql) => {
      sqls.push(sql);
      return { rows: [] };
    },
  };
  await listMyNotifications(pool, 'alice', 10, { unreadOnly: true });
  assert.match(sqls[0], /read_at IS NULL/);
});

test('ackMyNotification: marks single + same assignment_id siblings', async () => {
  const updates = [];
  const pool = {
    query: async (sql, params) => {
      if (/SELECT id, meta/i.test(sql)) {
        return { rows: [{ id: params[0], meta: { assignment_id: 'asg-1' } }] };
      }
      if (/UPDATE hrms_user_notifications/i.test(sql)) {
        updates.push({ sql, params });
        return { rows: [{ id: '10' }, { id: '11' }] };
      }
      return { rows: [] };
    },
  };
  const r = await ackMyNotification(pool, 'bob', 'db-10');
  assert.equal(r.ok, true);
  assert.deepEqual(r.acked_ids, ['10', '11']);
  assert.ok(updates[0].params.includes('asg-1'));
});

test('ackMyNotification: not found → 404', async () => {
  const pool = { query: async () => ({ rows: [] }) };
  const r = await ackMyNotification(pool, 'bob', '999');
  assert.equal(r.ok, false);
  assert.equal(r.status, 404);
});
