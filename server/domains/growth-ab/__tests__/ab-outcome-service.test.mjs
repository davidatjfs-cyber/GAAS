import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeAbTestOutcome,
  refreshAbTestResults,
  upsertAbTaskMetrics,
  upsertAbTaskResult,
} from '../ab-outcome-service.js';

test('upsertAbTaskResult: clamps counters and rounds money/rate fields', async () => {
  let params;
  const pool = { async query(sql, values) { params = values; assert.match(sql, /INSERT INTO ab_test_results/); return { rows: [] }; } };
  await upsertAbTaskResult(pool, {
    test_id: '7', result_date: '2026-07-10', variant: 'a', sent: -3, impressions: 10.9,
    clicks: 2, orders: 1, redemptions: 1, revenue: 12.345, conversion_rate: 0.12345,
  }, 'tenant-a');
  assert.deepEqual(params, [7, '2026-07-10', 'a', 0, 10, 2, 1, 1, 12.35, 0.1235, 'tenant-a']);
});

test('upsertAbTaskMetrics: forces variant to A/B and falls back across metric keys', async () => {
  let params;
  const pool = { async query(sql, values) { params = values; assert.match(sql, /INSERT INTO ab_test_results/); return { rows: [] }; } };
  await upsertAbTaskMetrics(pool, 9, '2026-07-11', 'x', { issued: 50, interactions: 4, arrivals: 2, revenue: 88.888 }, 'tenant-a');
  assert.equal(params[2], 'A');
  assert.equal(params[3], 50); // sent falls back to issued
  assert.equal(params[4], 4); // clicks falls back to interactions
  assert.equal(params[5], 2); // redemptions falls back to arrivals
  assert.equal(params[6], 88.89);
  assert.deepEqual(JSON.parse(params[7]), { issued: 50, interactions: 4, arrivals: 2, revenue: 88.888 });

  let variantB;
  const poolB = { async query(_sql, values) { variantB = values[2]; return { rows: [] }; } };
  await upsertAbTaskMetrics(poolB, 9, '2026-07-11', 'B', {}, 'tenant-a');
  assert.equal(variantB, 'B');
});

test('computeAbTestOutcome: returns null without a task id', async () => {
  const pool = { async query() { throw new Error('should not query'); } };
  assert.equal(await computeAbTestOutcome(pool, {}), null);
});

test('computeAbTestOutcome: custom metrics_schema aggregates per-field metrics into byVariant', async () => {
  const pool = {
    async query() {
      return {
        rows: [
          { result_date: '2026-07-10', variant: 'A', metrics_json: { sent: 100, redemptions: 20, revenue: 500 } },
          { result_date: '2026-07-10', variant: 'B', metrics_json: { sent: 100, redemptions: 30, revenue: 600 } },
        ],
      };
    },
  };
  const taskRow = {
    id: 1,
    metrics_schema: {
      fields: [{ key: 'sent' }, { key: 'redemptions' }, { key: 'revenue' }],
      primary: { key: 'redemption_rate', label: '核销率', num: ['redemptions'], den: 'sent', format: 'pct' },
      extra: [],
    },
  };
  const outcome = await computeAbTestOutcome(pool, taskRow, 'tenant-a');
  assert.equal(outcome.byVariant.A.sample, 100);
  assert.equal(outcome.byVariant.A.primary, 0.2);
  assert.equal(outcome.byVariant.B.primary, 0.3);
  assert.equal(outcome.byVariant.A.redemptions, 20);
});

test('computeAbTestOutcome: unbound test aggregates sendCount from delivery logs', async () => {
  const pool = {
    async query(sql) {
      if (sql.includes('FROM growth_delivery_logs')) {
        return { rows: [{ customer_id: 1, variant: 'A' }, { customer_id: 2, variant: 'B' }, { customer_id: 3, variant: 'A' }] };
      }
      if (sql.includes('FROM ab_test_results')) {
        return { rows: [{ result_date: '2026-07-10', variant: 'A', sent: 0, impressions: 0, clicks: 1, orders: 1, redemptions: 1, revenue: 50, conversion_rate: 0.5 }] };
      }
      return { rows: [] };
    },
  };
  const outcome = await computeAbTestOutcome(pool, { id: 5, target_rule_key: '' }, 'tenant-a');
  assert.equal(outcome.sendCount.A, 2);
  assert.equal(outcome.sendCount.B, 1);
  assert.equal(outcome.byVariant.A.sent, 2);
  assert.equal(outcome.byVariant.A.redemptions, 1);
  assert.equal(outcome.byVariant.A.redemption_rate, 0.5);
});

test('refreshAbTestResults: returns null when task/dates are incomplete', async () => {
  const pool = { async query() { throw new Error('should not query'); } };
  assert.equal(await refreshAbTestResults(pool, {}), null);
});

test('refreshAbTestResults: assigns orders/revenue by variant and upserts one row per day/variant', async () => {
  const upserts = [];
  const pool = {
    async query(sql) {
      if (sql.includes('FROM growth_delivery_logs')) {
        return { rows: [{ customer_id: 1, variant: 'A' }, { customer_id: 2, variant: 'B' }] };
      }
      if (sql.includes('FROM pos_orders')) {
        return { rows: [{ biz_date: '2026-07-10', customer_id: 1, order_count: 2, revenue: '30.50' }] };
      }
      if (sql.includes('INSERT INTO ab_test_results')) {
        upserts.push(sql);
        return { rows: [] };
      }
      return { rows: [] };
    },
  };
  const result = await refreshAbTestResults(pool, {
    id: 8, store_code: '51866138', start_date: '2026-07-10', end_date: '2026-07-10',
  }, 'tenant-a');
  assert.equal(result.sendCount.A, 1);
  assert.equal(result.sendCount.B, 1);
  assert.equal(result.assignments, 2);
  assert.equal(upserts.length, 2); // one per variant for the single day
});
