import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ensureReady,
  listBindings,
  upsertBinding,
  deleteBinding,
} from '../service.js';

test('ensureReady：成功与失败均可吞', async () => {
  await ensureReady({
    query: async () => ({ rows: [] }),
  });
  // 二次调用应短路
  await ensureReady({
    query: async () => {
      throw new Error('should_not_run');
    },
  });
});

test('listBindings 返回行', async () => {
  const pool = {
    query: async () => ({ rows: [{ id: 1, username: 'mgr', store: '洪潮' }] }),
  };
  const rows = await listBindings(pool);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].username, 'mgr');
});

test('upsertBinding：缺参 / 主店清其它主店标记', async () => {
  await assert.rejects(
    () => upsertBinding({ query: async () => ({ rows: [] }) }, { username: '' }, 'default'),
    (e) => e.code === 'missing_username_or_store'
  );

  const sqls = [];
  const pool = {
    query: async (sql, params) => {
      sqls.push({ sql: String(sql), params });
      if (/RETURNING \*/i.test(String(sql))) {
        return { rows: [{ id: 9, username: params[0], store: params[1], is_primary_store: true }] };
      }
      return { rows: [] };
    },
  };
  const row = await upsertBinding(
    pool,
    {
      username: 'mgr',
      store: '洪潮',
      is_primary_store: true,
      can_approve_hrms: true,
      access_level: 'manager',
    },
    'default'
  );
  assert.equal(row.id, 9);
  assert.ok(sqls.some((c) => /INSERT INTO store_duty_bindings/i.test(c.sql)));
  assert.ok(sqls.some((c) => /SET is_primary_store = false/i.test(c.sql)));
});

test('deleteBinding：非法 id / 删除成功', async () => {
  await assert.rejects(
    () => deleteBinding({ query: async () => ({ rowCount: 0 }) }, 'x'),
    (e) => e.code === 'invalid_id'
  );
  const pool = {
    query: async (sql, params) => {
      assert.equal(params[0], 3);
      return { rowCount: 1 };
    },
  };
  assert.equal(await deleteBinding(pool, 3), true);
});
