import test from 'node:test';
import assert from 'node:assert/strict';
import { getMarketingSuggestions } from '../marketing-suggestions.js';

// 2026-07-31：用户明确要求"这个工作要的是质量，不是数量"——之前查growth_actions
// (campaign_autopilot生成)的通用模板文案质量差、且被历史堆积挤没真正有价值的内容。
// 已停用该来源，只保留strategy_experiments/strategy_variants（结合门店真实差评/流失
// 等异常信号生成的A/B方案+逐日执行步骤），锁定：①只查这张表；②按门店轮流抽取，每店
// 最多limit条，不被某个门店的历史堆积独占；③storeFilter展开别名后用ANY匹配。

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

test('getMarketingSuggestions：只查strategy_experiments，不再查growth_actions', async () => {
  const pool = makePool([]);
  await getMarketingSuggestions(pool, 'default', []);
  assert.equal(pool.calls.length, 1);
  assert.match(pool.calls[0].sql, /FROM strategy_experiments/);
  assert.doesNotMatch(pool.calls[0].sql, /FROM growth_actions/);
});

test('getMarketingSuggestions：storeFilter非空时展开别名后用ANY匹配', async () => {
  const pool = makePool([]);
  await getMarketingSuggestions(pool, 'default', ['洪潮大宁久光店']);
  const call = pool.calls[0];
  assert.match(call.sql, /v\.store = ANY/);
  assert.ok(call.params[1].includes('洪潮久光店'), '应该展开出飞书缩写别名，不能只有传入的官方简称');
});

test('getMarketingSuggestions：返回带完整variants数组(A/B双方案+逐日执行指引)', async () => {
  const pool = makePool([
    {
      experiment_code: 'EXP-1', title: '差评反馈优化vs新品试吃活动', goal: '降低差评', anomaly_type: 'bad_review_product', created_at: '2026-07-31T16:30',
      variants: [
        { variantCode: 'A', label: '差评反馈优化', action: '逐条复制差评到台账...', executionGuide: '第1-2天...', store: '马己仙上海音乐广场店' },
        { variantCode: 'B', label: '新品试吃活动', action: '推出新品试吃...', executionGuide: '第1天...', store: '马己仙上海音乐广场店' },
      ],
    },
  ]);
  const items = await getMarketingSuggestions(pool, 'default', []);
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, 'pllm_experiment');
  assert.equal(items[0].actionKey, 'EXP-1');
  assert.equal(items[0].variants.length, 2, '应该带完整的A/B两个方案');
  assert.equal(items[0].anomalyType, 'bad_review_product');
});

test('getMarketingSuggestions：按门店轮流抽取，历史堆积多的门店不能独占展示名额', async () => {
  const rows = [];
  // 门店A：10个不同实验，全部比门店B更新
  for (let i = 0; i < 10; i++) {
    rows.push({
      experiment_code: 'A' + i, title: 't' + i, goal: 'g', anomaly_type: 'x', created_at: '2026-07-31T10:0' + i,
      variants: [{ variantCode: 'A', label: 'l', action: 'a', executionGuide: 'e', store: '门店A' }],
    });
  }
  // 门店B：2个实验，创建时间更早
  rows.push({ experiment_code: 'B0', title: 'b0', goal: 'g', anomaly_type: 'x', created_at: '2026-07-29T10:00', variants: [{ variantCode: 'A', label: 'l', action: 'a', executionGuide: 'e', store: '门店B' }] });
  rows.push({ experiment_code: 'B1', title: 'b1', goal: 'g', anomaly_type: 'x', created_at: '2026-07-29T10:01', variants: [{ variantCode: 'A', label: 'l', action: 'a', executionGuide: 'e', store: '门店B' }] });
  const pool = makePool(rows);
  const items = await getMarketingSuggestions(pool, 'default', [], 2);
  const storeCounts = {};
  items.forEach((it) => { storeCounts[it.store] = (storeCounts[it.store] || 0) + 1; });
  assert.equal(Object.keys(storeCounts).length, 2, '两个门店都应该有展示，不能被门店A的历史堆积独占');
  assert.ok(storeCounts['门店A'] <= 2 && storeCounts['门店B'] <= 2, '每店展示数不能超过limit');
});
