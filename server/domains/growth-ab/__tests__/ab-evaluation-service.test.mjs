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
