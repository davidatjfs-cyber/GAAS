import test from 'node:test';
import assert from 'node:assert/strict';
import { getUnreadInboxCount } from '../service.js';

// 2026-07-30：管理员反馈工作台"通知"角标一直是0，跟"我的档案"看到的数字对不上——大小写
// 问题修过一轮后角标还是0，再查证发现是两边"未读数"的定义根本不一样："我的档案"
// (09-resignation.js#renderProfileNotifications)显示的是"今天创建了几条"(todayCount，
// 不看read_at)，这里之前是"read_at IS NULL的真未读数"——很多通知几分钟内就被自动
// ack过，导致这个口径几乎总是0。锁定：口径必须改成跟"我的档案"一致的"当天创建数量"，
// 不能再用read_at。

function makePool(rows) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows };
    },
  };
}

test('getUnreadInboxCount 按"当天创建"计数，不看read_at（跟"我的档案"口径一致）', async () => {
  const pool = makePool([{ n: 3 }]);
  const n = await getUnreadInboxCount(pool, 'default', 'admin');
  assert.equal(n, 3);
  assert.doesNotMatch(pool.calls[0].sql, /read_at IS NULL/, '不应该再按read_at过滤，那是"我的档案"完全不用的口径');
  assert.match(pool.calls[0].sql, /created_at AT TIME ZONE 'Asia\/Shanghai'/);
  assert.match(pool.calls[0].sql, /lower\(target_username\) = lower\(\$2\)/);
});

test('getUnreadInboxCount 大小写不敏感匹配用户名', async () => {
  const pool = makePool([{ n: 1 }]);
  await getUnreadInboxCount(pool, 'default', 'NNYXWSB39');
  assert.deepEqual(pool.calls[0].params, ['default', 'NNYXWSB39']);
});
