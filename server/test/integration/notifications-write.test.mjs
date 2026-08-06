/**
 * Wave 4n：通知 DELETE / batch（domains/notifications/routes.js）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { bootApp } from './helpers/boot-app.mjs';
import { testDb, uniqueId, ensureDefaultTenant } from './helpers/db.mjs';

let app;

async function createUser(username, role, tenantId = 'default') {
  const db = testDb();
  const hash = await bcrypt.hash('Pass12345', 10);
  await db.query(
    `insert into users (username, password_hash, real_name, role, is_active, tenant_id)
     values ($1, $2, '测试', $3, true, $4)
     on conflict (username) do update set password_hash = excluded.password_hash, role = excluded.role, is_active = true`,
    [username, hash, role, tenantId]
  );
}

async function login(username) {
  const res = await fetch(app.baseUrl + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: 'Pass12345' }),
  });
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  return body.token;
}

test.before(async () => {
  await ensureDefaultTenant();
  app = await bootApp();
});

test.after(async () => {
  await app.stop();
});

test('DELETE /api/notifications/:id：store_employee → 403', async () => {
  const username = uniqueId('notif_del_emp');
  await createUser(username, 'store_employee');
  const token = await login(username);
  const res = await fetch(app.baseUrl + '/api/notifications/n1', {
    method: 'DELETE',
    headers: { Authorization: 'Bearer ' + token },
  });
  const body = await res.json();
  assert.equal(res.status, 403, JSON.stringify(body));
  assert.equal(body.error, 'forbidden');
});

test('POST /api/notifications/batch：无 token → 401', async () => {
  const res = await fetch(app.baseUrl + '/api/notifications/batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ notifications: [{ targetUser: 'u', title: 't' }] }),
  });
  assert.equal(res.status, 401);
});

test('POST /api/notifications/batch：空列表 → 400 empty', async () => {
  const username = uniqueId('notif_batch_any');
  await createUser(username, 'store_employee');
  const token = await login(username);
  const res = await fetch(app.baseUrl + '/api/notifications/batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ notifications: [] }),
  });
  const body = await res.json();
  assert.equal(res.status, 400, JSON.stringify(body));
  assert.equal(body.error, 'empty');
});

// 2026-08-06：通知重复插入的并发回归测试。
// append.js 的 `INSERT ... SELECT ... WHERE NOT EXISTS` 在 READ COMMITTED 下挡不住并发——
// 两个事务互相看不到对方未提交的行，双方都会插入成功。生产实证：admin 在 15:08:36
// 收到两条 id/内容完全相同的心跳告警。真正的保证来自 migration 183 的部分唯一索引
// uniq_hrms_notif_unread_msg。这条测试并发插同一条通知，断言库里最终只有一份。
test('hrms_user_notifications：同一条未读通知并发插入只落地一份（migration 183 部分唯一索引）', async () => {
  const db = testDb();
  const target = uniqueId('notif_dup_race');
  const message = '🚨 [HRMS] 定时任务心跳异常\n涉及任务：test_task（在跑但失败）';
  const insertOnce = () =>
    db.query(
      `INSERT INTO hrms_user_notifications (target_username, title, message, type, meta, created_at, tenant_id)
       SELECT $1,$2,$3,$4,$5,NOW(),'default'
        WHERE NOT EXISTS (
          SELECT 1 FROM hrms_user_notifications
           WHERE lower(target_username) = lower($1) AND type = $4 AND message = $3
             AND (read_at IS NULL OR read_at > NOW() - INTERVAL '4 hours')
        )
       ON CONFLICT DO NOTHING`,
      [target, '定时任务心跳异常', message, 'system_alert', '{}']
    );

  await Promise.all([insertOnce(), insertOnce(), insertOnce(), insertOnce(), insertOnce()]);

  const r = await db.query(
    `SELECT count(*)::int AS n FROM hrms_user_notifications
      WHERE lower(target_username) = lower($1) AND read_at IS NULL`,
    [target]
  );
  assert.equal(r.rows[0].n, 1, '并发插入同一条未读通知后，库里应只剩一份');

  // ack 之后同样文案应能再次插入（部分唯一索引只约束未读行，不能退化成永久屏蔽）
  await db.query(
    `UPDATE hrms_user_notifications SET read_at = NOW() - INTERVAL '5 hours'
      WHERE lower(target_username) = lower($1)`,
    [target]
  );
  await insertOnce();
  const after = await db.query(
    `SELECT count(*)::int AS n FROM hrms_user_notifications
      WHERE lower(target_username) = lower($1) AND read_at IS NULL`,
    [target]
  );
  assert.equal(after.rows[0].n, 1, '已读超过冷却期后，同样文案应能重新提醒');

  await db.query(`DELETE FROM hrms_user_notifications WHERE lower(target_username) = lower($1)`, [target]);
});
