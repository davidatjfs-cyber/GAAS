import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateAbTask, maybeWriteAbLearning, promoteAbWinner } from '../ab-evaluation-service.js';

test('maybeWriteAbLearning: no-op unless winner is A or B', async () => {
  let called = false;
  const pool = { async query() { called = true; return { rows: [] }; } };
  await maybeWriteAbLearning(pool, {}, {}, 'tie', 0);
  await maybeWriteAbLearning(pool, {}, {}, '', 0);
  assert.equal(called, false);
});

test('maybeWriteAbLearning: writes growth_learnings for a channel-mode B winner', async () => {
  let params;
  const pool = { async query(sql, values) { params = values; assert.match(sql, /INSERT INTO growth_learnings/); return { rows: [] }; } };
  const taskRow = {
    id: 3, store_code: '51866138', mode: 'channel', test_type: '文案版本', channel: 'sms',
    variant_a: { content: 'A版本文案' }, variant_b: { content: 'B版本文案' },
  };
  const outcome = { byVariant: { A: { sample: 120 }, B: { sample: 130 } } };
  await maybeWriteAbLearning(pool, taskRow, outcome, 'B', 12.5);
  assert.equal(params[0], '3');
  assert.equal(params[2], 'sms');
  assert.equal(params[5], '文案版本');
  assert.equal(params[6], 'B版本文案');
  assert.equal(params[7], 'A版本文案');
  assert.equal(params[8], '核销率+12.50%');
  assert.equal(params[9], 130);
  assert.equal(params[10], 'high');
});

test('maybeWriteAbLearning: sms_copy mode uses 文案风格 and medium confidence under 100 samples', async () => {
  let params;
  const pool = { async query(_sql, values) { params = values; return { rows: [] }; } };
  await maybeWriteAbLearning(pool, {
    id: 9, store_code: 'S', mode: 'sms', test_type: 'sms_copy',
    variant_a: { label: 'A' }, variant_b: { label: 'B' },
    metrics_schema: { primary: { label: '点击率' } },
  }, { byVariant: { A: { sample: 40 }, B: { sample: 50 } } }, 'A', 8);
  assert.equal(params[5], '文案风格');
  assert.equal(params[6], 'A');
  assert.equal(params[8], '点击率+8.00%');
  assert.equal(params[10], 'medium');
});

test('evaluateAbTask: returns finalized=false when sample size below threshold', async () => {
  const pool = {
    async query(sql) {
      if (sql.includes('FROM growth_delivery_logs')) return { rows: [] };
      if (sql.includes('FROM ab_test_results')) {
        return { rows: [{ result_date: '2026-07-10', variant: 'A', sent: 5, redemptions: 1, revenue: 10 }] };
      }
      return { rows: [] };
    },
  };
  const result = await evaluateAbTask(pool, { id: 1, min_sample_size: 30, target_rule_key: '' }, 'tenant-a');
  assert.equal(result.finalized, false);
  assert.ok(result.outcome);
});

test('evaluateAbTask: schema.primary path returns finalized=false when sample thin', async () => {
  const pool = {
    async query(sql) {
      if (sql.includes('FROM growth_delivery_logs')) return { rows: [] };
      if (sql.includes('FROM ab_test_results')) {
        return {
          rows: [
            { result_date: '2026-07-10', variant: 'A', sent: 5, redemptions: 1, revenue: 10 },
            { result_date: '2026-07-10', variant: 'B', sent: 5, redemptions: 2, revenue: 20 },
          ],
        };
      }
      return { rows: [] };
    },
  };
  const result = await evaluateAbTask(pool, {
    id: 2, min_sample_size: 50,
    metrics_schema: { primary: { key: 'primary', format: 'pct', label: '核销率' } },
  }, 't');
  assert.equal(result.finalized, false);
});

test('evaluateAbTask: returns null when outcome cannot be computed', async () => {
  const pool = {
    async query() {
      throw new Error('db unavailable');
    },
  };
  // computeAbTestOutcome may throw or return empty; tolerate either via catch at call site
  let result = null;
  try {
    result = await evaluateAbTask(pool, { id: 99, min_sample_size: 30 }, 't');
  } catch (e) {
    assert.match(String(e.message || e), /db unavailable/);
    return;
  }
  assert.equal(result, null);
});
test('promoteAbWinner: rejects tasks without a determined winner', async () => {
  const result = await promoteAbWinner({ async query() { throw new Error('should not query'); } }, { winner: null }, 'op');
  assert.equal(result.ok, false);
  assert.equal(result.error, 'no_winner_yet');
});

test('promoteAbWinner: A(current) winner keeps the bound rule unchanged', async () => {
  const calls = [];
  const pool = { async query(sql) { calls.push(sql); return { rows: [{ id: 1 }] }; } };
  const result = await promoteAbWinner(pool, {
    id: 10, winner: 'A', target_kind: 'touch_rule', target_rule_key: 'rk_1', store_code: 'S1', test_name: 'T',
  }, 'op', 'tenant-a');
  assert.equal(result.ok, true);
  assert.equal(result.kept_current, true);
  assert.ok(calls.some((sql) => sql.includes('UPDATE ab_test_tasks SET promoted_rule_key')));
  assert.ok(calls.some((sql) => sql.includes('INSERT INTO decision_log')));
});

test('promoteAbWinner: B winner updates touch_rule action_payload', async () => {
  const calls = [];
  const pool = {
    async query(sql) {
      calls.push(sql);
      if (sql.includes('FROM growth_touch_rules')) {
        return { rows: [{ rule_key: 'rk_touch', action_payload: { content_template: 'old' } }] };
      }
      if (sql.includes('UPDATE growth_touch_rules')) {
        return { rows: [{ rule_key: 'rk_touch', action_payload: { content_template: 'new B' } }] };
      }
      return { rows: [{ id: 1 }] };
    },
  };
  const result = await promoteAbWinner(pool, {
    id: 20, winner: 'B', winner_lift: 15, target_kind: 'touch_rule', target_rule_key: 'rk_touch',
    store_code: 'S1', test_name: '触达AB',
    variant_b: { content: 'new B', coupon_value: 8 },
  }, 'ops', 'tenant-a');
  assert.equal(result.ok, true);
  assert.equal(result.kind, 'touch_rule');
  assert.equal(result.winner, 'B');
  assert.ok(calls.some((sql) => sql.includes('UPDATE growth_touch_rules')));
});

test('promoteAbWinner: touch_rule missing returns target_rule_not_found', async () => {
  const pool = {
    async query(sql) {
      if (sql.includes('FROM growth_touch_rules')) return { rows: [] };
      return { rows: [] };
    },
  };
  const result = await promoteAbWinner(pool, {
    id: 21, winner: 'B', target_kind: 'touch_rule', target_rule_key: 'missing',
    store_code: 'S', test_name: 'T', variant_b: { content: 'x' },
  }, 'op');
  assert.equal(result.ok, false);
  assert.equal(result.error, 'target_rule_not_found');
});

test('promoteAbWinner: B winner updates payment_rule fields', async () => {
  const pool = {
    async query(sql) {
      if (sql.includes('FROM marketing_payment_rules')) {
        return { rows: [{ rule_key: 'pay_1', member_template_id: 'old' }] };
      }
      if (sql.includes('UPDATE marketing_payment_rules')) {
        return { rows: [{ rule_key: 'pay_1', member_template_id: 'tpl_b' }] };
      }
      return { rows: [{ id: 1 }] };
    },
  };
  const result = await promoteAbWinner(pool, {
    id: 22, winner: 'B', target_kind: 'payment_rule', target_rule_key: 'pay_1',
    store_code: 'S', test_name: '支付AB',
    variant_b: { template_id: 'tpl_b', trigger_value: '100' },
  }, 'op');
  assert.equal(result.ok, true);
  assert.equal(result.kind, 'payment_rule');
  assert.equal(result.rule_key, 'pay_1');
});

test('promoteAbWinner: channel mode learns from the winner without a bound rule', async () => {
  const calls = [];
  const pool = {
    async query(sql) {
      calls.push(sql);
      if (sql.includes('FROM ab_test_results')) return { rows: [] };
      return { rows: [{ id: 1 }] };
    },
  };
  const result = await promoteAbWinner(pool, {
    id: 11, winner: 'B', mode: 'channel', channel: '小红书', store_code: 'S1', test_name: 'T', winner_lift: 20,
    variant_a: { content: 'A' }, variant_b: { content: 'B' },
  }, 'op', 'tenant-a');
  assert.equal(result.ok, true);
  assert.equal(result.learned, true);
  assert.ok(calls.some((sql) => sql.includes('INSERT INTO growth_learnings')));
});

test('promoteAbWinner: not promotable when neither bound nor channel mode', async () => {
  const result = await promoteAbWinner({ async query() { return { rows: [] }; } }, { id: 12, winner: 'B' }, 'op');
  assert.equal(result.ok, false);
  assert.equal(result.error, 'not_promotable');
});
