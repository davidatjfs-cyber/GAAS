import test from 'node:test';
import assert from 'node:assert/strict';
import { getBadReviewFeed } from '../bad-review-feed.js';

// 2026-07-30：马己仙出品经理反馈在差评展示里能看到所有门店的差评——之前只有前端传的
// store单店筛选，没有服务端强制的权限范围。锁定：storeFilter 非空时必须限制查询范围，
// 传入超出范围的store会被忽略而不是绕过限制。
//
// 2026-07-30 追加：单店范围内也查不到数据——根因是 agent_messages 里飞书写入的门店名
// 是缩写（"洪潮久光店"/"马己仙大宁店"），跟员工表传入的官方全称不是同一个字符串，精确
// 匹配必然落空。改用 expandAgentStoreLabels() 展开别名后一律用 ANY() 匹配，以下测试
// 断言参数数组里包含展开后的别名，而不再是原始传入的字符串本身。

function makePool() {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: [] };
    },
  };
}

test('storeFilter 非空且未传store：查询限制在storeFilter展开别名后的ANY数组', async () => {
  const pool = makePool();
  await getBadReviewFeed(pool, 'default', { storeFilter: ['马己仙上海音乐广场店'] });
  const platformCall = pool.calls[0];
  assert.match(platformCall.sql, /store' = ANY/);
  assert.ok(Array.isArray(platformCall.params[1]));
  assert.ok(platformCall.params[1].includes('马己仙上海音乐广场店'));
  assert.ok(platformCall.params[1].includes('马己仙大宁店'), '应展开出飞书缩写别名，否则单店范围内查询会永远空');
});

test('storeFilter 非空，传了范围外的store：被忽略，仍然限制在storeFilter展开别名范围内', async () => {
  const pool = makePool();
  await getBadReviewFeed(pool, 'default', { store: '洪潮大宁久光店', storeFilter: ['马己仙上海音乐广场店'] });
  const platformCall = pool.calls[0];
  assert.match(platformCall.sql, /store' = ANY/);
  assert.ok(platformCall.params[1].includes('马己仙大宁店'));
  assert.ok(!platformCall.params[1].includes('洪潮久光店'));
});

test('storeFilter 非空，传了范围内的store：按该店展开的别名ANY过滤（同样是ANY，不是精确等于）', async () => {
  const pool = makePool();
  await getBadReviewFeed(pool, 'default', { store: '马己仙上海音乐广场店', storeFilter: ['马己仙上海音乐广场店', '洪潮大宁久光店'] });
  const platformCall = pool.calls[0];
  assert.match(platformCall.sql, /store' = ANY/);
  assert.ok(platformCall.params[1].includes('马己仙大宁店'));
  assert.ok(!platformCall.params[1].includes('洪潮久光店'), '只传了马己仙这一店，不应该混进洪潮的别名');
});

test('storeFilter 为空数组（admin/老板视角）：不限制门店', async () => {
  const pool = makePool();
  await getBadReviewFeed(pool, 'default', { storeFilter: [] });
  const platformCall = pool.calls[0];
  // SELECT子句本身会带"agent_data->'fields'->>'store'"字样(取值列)，真正要断言的是
  // WHERE过滤条件没有额外拼接store限制，且没有多传任何store相关参数(只有tenantId一个)。
  assert.equal(platformCall.params.length, 1);
  assert.doesNotMatch(platformCall.sql, /WHERE[\s\S]*store'\s*=/);
});
