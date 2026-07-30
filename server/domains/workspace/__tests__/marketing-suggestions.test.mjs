import test from 'node:test';
import assert from 'node:assert/strict';
import { getMarketingSuggestions } from '../marketing-suggestions.js';

// 2026-07-30：门店营销活动建议点"执行"分配责任人时几乎每次提示"本店未配置店长/前厅
// 主管"——查证生产库growth_actions.store_id没有统一格式(POS原始长名/增长侧数字ID/
// 员工表用的官方简称混杂)，前端拿到的store字段跟employees.store不是同一个字符串。
// 锁定：返回给前端的store字段必须是归一化后的官方简称。

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

test('getMarketingSuggestions：返回的store字段必须是归一化后的官方简称，不是原始store_id', async () => {
  const pool = makePool([
    { action_key: 'AK1', action_type: 'promo_task', store_id: '洪潮传统潮汕菜【大宁久光中心店】', title: 't', detail: 'd', created_at: '2026-07-30' },
  ]);
  const items = await getMarketingSuggestions(pool, 'default', []);
  assert.equal(items[0].store, '洪潮大宁久光店', '应该是员工表用的官方简称，不是POS原始长名');
});

test('getMarketingSuggestions：storeFilter非空时展开别名后用ANY匹配，不是原样传入storeFilter', async () => {
  const pool = makePool([]);
  await getMarketingSuggestions(pool, 'default', ['洪潮大宁久光店']);
  const call = pool.calls[0];
  assert.match(call.sql, /store_id = ANY/);
  assert.ok(call.params[1].includes('洪潮久光店'), '应该展开出飞书缩写别名，不能只有传入的官方简称');
});
