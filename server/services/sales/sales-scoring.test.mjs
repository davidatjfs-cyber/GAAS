import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreLead, computeWinProbability, persistScore } from './sales-scoring.js';

test('scoreLead awards positive rules and clamps 0-100', () => {
  const high = scoreLead({
    extracted: {
      store_count: 12,
      phone_data_ready: true,
      has_member_system: true,
      budget_range: 'high',
      pain_point: '复购低且营业额下降',
      decision_role: '老板',
      expected_close_hint: '下个月',
    },
    eventTypes: ['ASK_PRICE', 'REQUEST_DEMO', 'REQUEST_TRIAL', 'BUYING_INTENT'],
  });
  assert.ok(high.intent_score >= 70);
  assert.equal(high.intent_level, 'high');
  assert.ok(high.items.some((i) => i.rule_key === 'stores_10plus'));
  assert.ok(high.items.some((i) => i.rule_key === 'request_demo'));
});

test('scoreLead applies negative rules for unfit signals', () => {
  const low = scoreLead({
    extracted: {
      store_count: 1,
      phone_data_ready: false,
      decision_role: '职能',
      pain_point: '只要免费试用，还要定制开发和自研POS',
    },
    eventTypes: ['LOW_INTEREST'],
  });
  assert.equal(low.intent_level, 'low');
  assert.ok(low.intent_score <= 40);
  assert.ok(low.items.some((i) => i.rule_key === 'single_store'));
  assert.ok(low.items.some((i) => i.rule_key === 'heavy_customization'));
});

test('computeWinProbability handles terminal stages and mid-funnel boosts', () => {
  assert.equal(computeWinProbability({ stage: 'won' }), 100);
  assert.equal(computeWinProbability({ stage: 'lost' }), 0);
  assert.equal(computeWinProbability({ stage: 'unfit' }), 0);
  const mid = computeWinProbability({
    stage: 'proposal',
    intent_score: 66,
    demo_count: 1,
    meeting_count: 1,
  });
  assert.ok(mid > 35 && mid <= 95);
  const trial = computeWinProbability({
    stage: 'trial',
    intent_score: 50,
    trial_status: 'in_progress',
  });
  assert.ok(trial >= 60);
});

test('persistScore writes score items then updates lead', async () => {
  const calls = [];
  const pool = {
    query: async (sql, params) => {
      calls.push({ sql: String(sql), params });
      return { rows: [] };
    },
  };
  await persistScore(pool, 9, {
    intent_score: 55,
    intent_level: 'medium',
    items: [{ rule_key: 'boss', points: 10, evidence: '老板本人参与' }],
  });
  assert.ok(calls.some((c) => c.sql.includes('DELETE FROM sales_score_items')));
  assert.ok(calls.some((c) => c.sql.includes('INSERT INTO sales_score_items')));
  assert.ok(calls.some((c) => c.sql.includes('UPDATE sales_leads')));
});
