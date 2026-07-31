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

// 2026-07-30：用户反馈同一家店连续出现好几条几乎一样的建议——查证生产库确认
// campaign_autopilot每天都为同一批目标客群重新生成建议，旧的从不过期，之前只是简单
// LIMIT取最新N条，完全没有按门店+目标客群去重。锁定：同一store_id+target_audience
// 只保留最新一条，且返回的channelName要透出payload.channel（不是online/offline粗分类）。
test('getMarketingSuggestions：同一门店+同一目标客群的多条建议只保留最新一条', async () => {
  const pool = makePool([
    { action_key: 'AK3', action_type: 'promo_task', store_id: 'S1', title: 't3', detail: 'd3', created_at: '2026-07-30', payload: { target_audience: '新客未激活，共65人', channel: 'dianping' } },
    { action_key: 'AK2', action_type: 'send_message', store_id: 'S1', title: 't2', detail: 'd2', created_at: '2026-07-29', payload: { target_audience: '新客未激活，共65人', channel: 'wecom' } },
    { action_key: 'AK1', action_type: 'sms_recall', store_id: 'S1', title: 't1', detail: 'd1', created_at: '2026-07-28', payload: { target_audience: '流失预警客户', channel: 'sms' } },
  ]);
  const items = await getMarketingSuggestions(pool, 'default', []);
  assert.equal(items.length, 2, '同一目标客群的重复建议应该只保留最新一条');
  assert.equal(items[0].actionKey, 'AK3', '应该保留created_at最新的那条');
  assert.equal(items[0].channelName, 'dianping', '应该透出payload.channel原始渠道');
  assert.ok(items.some((i) => i.actionKey === 'AK1'), '不同目标客群的建议不应被去重掉');
});

// 2026-07-31：用户反馈内容"根本不能用"——查证生产库发现真正的根因：同一家店在
// growth_actions.store_id里同时存在数字增长引擎ID('51866138'=马己仙，累计1767条历史
// 堆积)和POS长名两种格式，之前按"归一化前的原始store_id"去重，两种格式互不认识彼此，
// 数字ID的海量历史堆积会在"按最新时间截断"里把真正该展示的内容挤没。锁定：①同一物理
// 门店的两种store_id格式必须先归一化再一起去重；②必须按门店轮流(round-robin)抽取，
// 不能让某个门店的历史堆积独占展示名额。
test('getMarketingSuggestions：同一物理门店的两种store_id格式(数字ID/POS长名)必须归一化后一起去重，不能各自为政', async () => {
  const pool = makePool([
    // 数字ID格式，海量历史堆积（模拟51866138的情况），同一客群
    { action_key: 'NUM3', action_type: 'promo_task', store_id: '51866138', title: 'n3', detail: 'd', created_at: '2026-07-31', payload: { target_audience: '新客未激活，共65人', channel: 'dianping' } },
    { action_key: 'NUM2', action_type: 'promo_task', store_id: '51866138', title: 'n2', detail: 'd', created_at: '2026-07-30', payload: { target_audience: '新客未激活，共65人', channel: 'dianping' } },
    // POS长名格式，同一物理门店、同一客群——应该跟上面的数字ID格式合并去重，只留最新一条
    { action_key: 'POS1', action_type: 'promo_task', store_id: '马己仙广东小馆·荔枝木烧鹅（大宁音乐广场店）', title: 'p1', detail: 'd', created_at: '2026-07-29', payload: { target_audience: '新客未激活，共65人', channel: 'wecom' } },
  ]);
  const items = await getMarketingSuggestions(pool, 'default', []);
  assert.equal(items.length, 1, '同一物理门店+同一客群的建议，不管store_id用哪种格式都应该合并去重成一条');
  assert.equal(items[0].actionKey, 'NUM3', '应该保留created_at最新的那一条');
});

test('getMarketingSuggestions：按门店轮流抽取，历史堆积多的门店不能独占展示名额', async () => {
  const rows = [];
  // 门店A(数字ID，模拟历史堆积严重的门店)：10条不同客群的建议，全部比门店B更新
  for (let i = 0; i < 10; i++) {
    rows.push({ action_key: 'A' + i, action_type: 'promo_task', store_id: '51866138', title: 'a' + i, detail: 'd', created_at: '2026-07-31T10:0' + i, payload: { target_audience: '客群' + i, channel: 'dianping' } });
  }
  // 门店B(数字ID，模拟历史堆积较少的门店)：2条不同客群的建议，创建时间更早
  rows.push({ action_key: 'B0', action_type: 'promo_task', store_id: '64822111', title: 'b0', detail: 'd', created_at: '2026-07-29T10:00', payload: { target_audience: '客群X', channel: 'wecom' } });
  rows.push({ action_key: 'B1', action_type: 'promo_task', store_id: '64822111', title: 'b1', detail: 'd', created_at: '2026-07-29T10:01', payload: { target_audience: '客群Y', channel: 'wecom' } });
  const pool = makePool(rows);
  const items = await getMarketingSuggestions(pool, 'default', [], 4);
  const storeCounts = {};
  items.forEach((it) => { storeCounts[it.store] = (storeCounts[it.store] || 0) + 1; });
  const counts = Object.values(storeCounts);
  assert.equal(items.length, 4);
  assert.equal(Object.keys(storeCounts).length, 2, '两个门店都应该有展示，不能被门店A的历史堆积独占');
  assert.ok(Math.max(...counts) - Math.min(...counts) <= 1, '两个门店的展示数量应该相对平均（相差不超过1条）');
});
