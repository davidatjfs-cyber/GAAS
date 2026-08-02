import test from 'node:test';
import assert from 'node:assert/strict';
import { getUnreadInboxCount } from '../service.js';

// 2026-08-02：用户反馈工作台"未读消息N条"/"通知N条"角标不管点多少次确认都不降——查证
// 发现2026-07-30那次改动把这个函数改成了"当天创建数量"，不看read_at，导致标签写着
// "未读"但实际统计的是"今天创建了多少条"，跟有没有点确认毫无关系。改回真正的未读数
// (read_at IS NULL)，让"未读"名副其实。"我的档案"页面自己的"今日N条"角标是前端独立
// 计算、标签本来就写的是"今日"不是"未读"，不需要跟这里保持同一口径。

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

test('getUnreadInboxCount 按read_at IS NULL计数（标签写的是"未读"就该是真未读）', async () => {
  const pool = makePool([{ n: 3 }]);
  const n = await getUnreadInboxCount(pool, 'default', 'admin');
  assert.equal(n, 3);
  assert.match(pool.calls[0].sql, /read_at IS NULL/, '标签是"未读"，就必须按read_at过滤，不能是"今天创建数量"');
  assert.match(pool.calls[0].sql, /lower\(target_username\) = lower\(\$2\)/);
});

test('getUnreadInboxCount 大小写不敏感匹配用户名', async () => {
  const pool = makePool([{ n: 1 }]);
  await getUnreadInboxCount(pool, 'default', 'NNYXWSB39');
  assert.deepEqual(pool.calls[0].params, ['default', 'NNYXWSB39']);
});
