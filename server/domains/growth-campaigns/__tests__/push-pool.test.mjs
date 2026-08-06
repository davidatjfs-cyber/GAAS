/**
 * 营销建议「采纳 → 推送池」：活动计划草稿生成（2026-08-06）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePlanCostFen, createCampaignPlanFromExperiment } from '../service.js';

function makePool() {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      return {
        rows: [{
          plan_id: params?.[0],
          store_id: params?.[1],
          campaign_id: params?.[2],
          title: params?.[3],
          channel: params?.[4],
          status: params?.[9],
          budget_fen: params?.[8],
        }],
      };
    },
  };
}

test('parsePlanCostFen：从「预估成本」文本取区间上限换算成分', () => {
  assert.equal(parsePlanCostFen('约800-1200元（含赠品成本）'), 120000);
  assert.equal(parsePlanCostFen('无需额外投入'), 0);
  assert.equal(parsePlanCostFen(''), 0);
});

test('createCampaignPlanFromExperiment：落成 draft 推送池草稿，带结构化字段', async () => {
  const pool = makePool();
  const plan = await createCampaignPlanFromExperiment(pool, 'default', {
    code: 'EXP-20260806-001',
    variantCode: 'A',
    store: '洪潮大宁久光店',
    title: '推出晚市双人套餐',
    approver: 'admin',
    planFields: {
      策略名称: '推出晚市双人套餐',
      投放渠道: '企微、抖音',
      对象: '晚市 2 人桌顾客',
      预估成本: '约800-1200元',
    },
  });
  assert.ok(plan);
  assert.equal(pool.calls.length, 1);
  const call = pool.calls[0];
  assert.match(call.sql, /INSERT INTO growth_campaign_plans/);
  assert.equal(call.params[0], 'exp:EXP-20260806-001:A');
  assert.equal(call.params[1], '64822111', '门店名应映射为 growth 门店编码，与增长看板筛选口径一致');
  assert.equal(call.params[2], 'EXP-20260806-001');
  assert.equal(call.params[3], '推出晚市双人套餐');
  assert.equal(call.params[4], '企微、抖音');
  assert.equal(call.params[7], 0, 'coupon_value_fen 未解析时保持 0');
  assert.equal(call.params[8], 120000, 'budget_fen 取预估成本上限');
  assert.equal(call.params[9], 'draft');
  assert.equal(call.params[12], 'admin');
});
