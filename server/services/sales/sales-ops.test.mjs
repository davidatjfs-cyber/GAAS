import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildNextAction,
  buildSalesAdvice,
  buildFunnelStats,
  buildRiskCustomers,
  buildTomorrowActions,
  buildSalesTodoList,
  recomputeFromLeadRow,
  buildTopHighLeads,
} from './sales-ops.js';

const baseScore = { intent_score: 55, intent_level: 'medium' };

test('buildNextAction prioritizes high intent takeover', () => {
  const action = buildNextAction({ controller: 'ai', store_count: 3 }, { intent_level: 'high', intent_score: 80 });
  assert.match(action.next_action, /人工接管/);
  assert.equal(action.priority, 'high');
});

test('buildNextAction asks for store count when missing', () => {
  const action = buildNextAction({ pain_points: ['客流少'] }, baseScore);
  assert.match(action.next_action, /门店数量/);
});

test('buildNextAction suggests demo for medium intent without demo', () => {
  const action = buildNextAction({
    store_count: 2,
    pain_points: ['复购低'],
    demo_count: 0,
    phone_data_ready: true,
  }, baseScore);
  assert.match(action.next_action, /演示/);
});

test('buildNextAction tracks trial in progress', () => {
  const action = buildNextAction({
    store_count: 1,
    pain_points: ['x'],
    phone_data_ready: true,
    trial_status: 'in_progress',
  }, baseScore);
  assert.match(action.next_action, /试跑/);
});

test('buildSalesAdvice includes pain, risks and case theme', () => {
  const advice = buildSalesAdvice(
    { extracted: { pain_point: '会员流失' }, pain_points: [], decision_role: '店长', phone_data_ready: false, store_count: 2 },
    { intent_score: 75, intent_level: 'high' }
  );
  assert.match(advice, /会员流失/);
  assert.match(advice, /禁止承诺/);
  assert.match(advice, /数据基础弱/);
  assert.match(advice, /风险：未确认最终决策人/);
});

test('buildFunnelStats aggregates stage counts', () => {
  const stats = buildFunnelStats([
    { stage: 'new' },
    { stage: 'ai_greeting' },
    { stage: 'need_identified' },
    { stage: 'won' },
  ]);
  assert.equal(stats.find((s) => s.key === 'new').count, 2);
  assert.equal(stats.find((s) => s.key === 'won').count, 1);
});

test('buildRiskCustomers flags stale high-intent and pricing stalls', () => {
  const stale = new Date(Date.now() - 4 * 86400000).toISOString();
  const risks = buildRiskCustomers([
    {
      id: 1,
      lead_key: 'L1',
      stage: 'need_identified',
      intent_level: 'high',
      controller: 'ai',
      last_human_at: stale,
      events: [{ event_type: 'ASK_PRICE' }],
      extracted: { budget_range: 'low' },
    },
    { id: 2, lead_key: 'L2', stage: 'won' },
  ]);
  assert.equal(risks.length, 1);
  assert.ok(risks[0].risks.some((r) => r.includes('未跟进')));
  assert.ok(risks[0].risks.some((r) => r.includes('高意向')));
});

test('buildTomorrowActions surfaces due and high-intent leads', () => {
  const actions = buildTomorrowActions([
    {
      id: 3,
      lead_key: 'L3',
      stage: 'need_identified',
      intent_level: 'high',
      controller: 'ai',
      company: '甲公司',
    },
    {
      id: 4,
      lead_key: 'L4',
      stage: 'proposal',
      intent_level: 'medium',
      controller: 'human',
      next_action_due: new Date(Date.now() + 3600000).toISOString(),
      next_action: '发送方案',
      company: '乙公司',
    },
  ]);
  assert.ok(actions.some((a) => a.lead_key === 'L3'));
  assert.ok(actions.some((a) => a.lead_key === 'L4'));
});

test('buildSalesTodoList returns prioritized todos from recommendNextSteps', () => {
  const todos = buildSalesTodoList([
    { id: 5, lead_key: 'L5', stage: 'new', intent_level: 'high', company: '丙公司', extracted: {} },
  ]);
  assert.ok(todos.length >= 1);
  assert.equal(todos[0].lead_key, 'L5');
});

test('recomputeFromLeadRow merges row fields into extracted slots', () => {
  const score = recomputeFromLeadRow({
    store_count: 4,
    city: '深圳',
    extracted: { pain_point: '翻台慢' },
    pain_points: ['翻台慢'],
    intent_score: 0,
    intent_level: 'low',
  }, ['REQUEST_DEMO']);
  assert.ok(score.intent_score >= 0);
  assert.ok(['low', 'medium', 'high'].includes(score.intent_level));
});

test('buildTopHighLeads sorts by intent and adds reasons', () => {
  const top = buildTopHighLeads([
    { id: 6, lead_key: 'L6', stage: 'proposal', intent_score: 90, intent_level: 'high', controller: 'ai', company: '丁公司' },
    { id: 7, lead_key: 'L7', stage: 'lost', intent_score: 99, intent_level: 'high', controller: 'human', company: '戊公司' },
  ]);
  assert.equal(top.length, 1);
  assert.equal(top[0].lead_key, 'L6');
  assert.ok(top[0].reasons.length >= 1);
});
