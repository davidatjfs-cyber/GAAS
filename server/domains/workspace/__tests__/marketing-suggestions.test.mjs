import test from 'node:test';
import assert from 'node:assert/strict';
import { getMarketingSuggestions, getMarketingReviewQueue, anomalyLabel, marketingSourceLabel } from '../marketing-suggestions.js';

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

test('anomalyLabel：slot_decline 等英文码输出中文', () => {
  assert.equal(anomalyLabel('slot_decline'), '时段营收下滑');
  assert.equal(anomalyLabel('rising_category_opportunity'), '上升品类机会');
  assert.equal(anomalyLabel('whatever'), 'whatever');
});

test('getMarketingReviewQueue：策略实验 + growth_actions(proposed) 聚合到一个队列', async () => {
  const calls = [];
  const pool = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (/FROM strategy_experiments/.test(sql)) {
        return { rows: [{
          experiment_code: 'EXP-1', title: '推出午市双人套餐', goal: 'g', anomaly_type: 'slot_decline',
          created_at: '2026-08-07T01:00', created_by: 'marketing_job',
          variants: [{ variantCode: 'A', label: 'l', action: 'a', executionGuide: 'e', store: '门店A' }],
        }] };
      }
      if (/FROM growth_actions/.test(sql)) {
        const rows = [
          {
            action_key: 'rule:1', action_type: 'send_voucher', status: 'proposed', store_id: '51866138',
            title: '沉睡客户召回', detail: 'd', payload: { channel: 'wecom', rule_key: 'dormant_vip_winback' },
            created_by: 'rule_engine', created_at: '2026-08-07T02:00',
          },
          {
            action_key: 'rule:1-old', action_type: 'send_voucher', status: 'proposed', store_id: '51866138',
            title: '沉睡客户召回（旧周期残留）', detail: 'd', payload: { channel: 'wecom', rule_key: 'dormant_vip_winback' },
            created_by: 'rule_engine', created_at: '2026-08-06T02:00',
          },
          {
            action_key: 'rule:single-phone', action_type: 'send_voucher', status: 'proposed', store_id: '51866138',
            title: '单客户短信建议', detail: 'd', payload: { channel: 'sms', rule_key: 'dormant_vip_winback', customer_id: '836' },
            created_by: 'rule_engine', created_at: '2026-08-07T03:00',
          },
          {
            action_key: 'auto:precise-broadcast', action_type: 'send_message', status: 'proposed', store_id: '51866138',
            title: '精准人群配公域渠道', detail: 'd',
            payload: { channel: 'xiaohongshu', target_audience: '21-45天未到访、消费≥5次的客户' },
            created_by: 'agent_v2', created_at: '2026-08-08T00:30',
          },
        ];
        // 与 SQL 过滤语义一致：单客户级动作不进审核队列
        // 2026-08-08：精准人群 + 广播渠道（小红书/企微/点评）也不进审核队列
        return { rows: rows.filter((r) => {
          if (r.payload && r.payload.customer_id) return false;
          return true;
        }) };
      }
      return { rows: [] };
    },
  };
  const items = await getMarketingReviewQueue(pool, 'default', []);
  const actionsCall = calls.find((c) => /FROM growth_actions/.test(c.sql));
  assert.ok(actionsCall, '应查询 growth_actions');
  assert.match(actionsCall.sql, /30 days/, '待审动作只取近30天，历史僵尸建议不回流');
  assert.match(actionsCall.sql, /customer_id/, '单客户级动作（每方案只针对一个手机号）不应进审核队列');
  // 代码级过滤：精准人群+公域渠道（xiaohongshu）由真实 filter 逻辑排除
  assert.equal(items.length, 2, '同规则同客户的旧周期残留应被去重，只剩最新一条');
  assert.ok(!items.some((it) => it.actionKey === 'auto:precise-broadcast'), '精准人群+公域渠道不应进审核队列');
  const exp = items.find((x) => x.kind === 'strategy_experiment');
  const action = items.find((x) => x.kind === 'growth_action');
  assert.ok(exp);
  assert.equal(exp.sourceLabel, '每日营销建议');
  assert.equal(exp.anomalyLabel, '时段营收下滑');
  assert.ok(action);
  assert.equal(action.sourceLabel, '自动营销规则');
  assert.equal(action.payload.channel, 'wecom');
  assert.equal(action.channelLabel, '企业微信', '渠道码应显示中文');
  assert.equal(action.actionKey, 'rule:1');
  assert.equal(marketingSourceLabel('agent_v2'), 'AI运营建议');
  // 队列按创建时间倒序：growth_action 更新，排前面
  assert.equal(items[0].kind, 'growth_action');
});
