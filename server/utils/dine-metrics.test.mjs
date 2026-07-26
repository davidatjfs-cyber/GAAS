import test from 'node:test';
import assert from 'node:assert/strict';
import {
  storeNameToId,
  resolveStoreCanonicalName,
  fetchDineMetrics,
  fetchDineMetricsForDays,
} from './dine-metrics.js';

function makePool(handler) {
  return { query: handler || (async () => ({ rows: [{}] })) };
}

test('storeNameToId maps known store names', () => {
  assert.equal(storeNameToId('马己仙上海音乐广场店'), '51866138');
  assert.equal(storeNameToId('洪潮大宁久光店'), '64822111');
  assert.equal(storeNameToId('其他门店'), '');
  assert.equal(storeNameToId(''), '');
});

test('resolveStoreCanonicalName maps ids and keywords', () => {
  assert.equal(resolveStoreCanonicalName('51866138'), '马己仙上海音乐广场店');
  assert.equal(resolveStoreCanonicalName('64822111'), '洪潮大宁久光店');
  assert.equal(resolveStoreCanonicalName('洪潮'), '洪潮大宁久光店');
  assert.equal(resolveStoreCanonicalName('  '), '');
  assert.equal(resolveStoreCanonicalName('某新店'), '某新店');
});

test('fetchDineMetrics prefers POS when revenue present', async () => {
  const pool = makePool(async (sql) => {
    if (/pos_orders/i.test(sql)) {
      return {
        rows: [{
          dine_orders: 10,
          dine_traffic: 25,
          dine_before_revenue: 5000,
        }],
      };
    }
    return {
      rows: [{
        report_days: 7,
        dr_orders: 8,
        dr_traffic: 20,
        dr_dine_before_revenue: 4000,
      }],
    };
  });
  const r = await fetchDineMetrics(pool, '马己仙上海音乐广场店', '2026-07-01', '2026-07-07');
  assert.equal(r.data_source, 'pos_orders');
  assert.equal(r.dine_orders, 10);
  assert.equal(r.dine_traffic, 25);
  assert.equal(r.dine_before_revenue, 5000);
  assert.equal(r.avg_table_spend, 500);
  assert.equal(r.avg_spend_per_person, 200);
});

test('fetchDineMetrics falls back to daily_reports when POS empty', async () => {
  const pool = makePool(async (sql) => {
    if (/pos_orders/i.test(sql)) return { rows: [{ dine_orders: 0, dine_traffic: 0, dine_before_revenue: 0 }] };
    return {
      rows: [{
        report_days: 5,
        dr_orders: 4,
        dr_traffic: 12,
        dr_dine_before_revenue: 2400,
      }],
    };
  });
  const r = await fetchDineMetrics(pool, '未知门店', '2026-07-01', '2026-07-07');
  assert.equal(r.data_source, 'daily_reports');
  assert.equal(r.dine_orders, 4);
  assert.equal(r.avg_table_spend, 600);
  assert.equal(r.avg_spend_per_person, 200);
});

test('fetchDineMetricsForDays delegates date window query', async () => {
  const sqls = [];
  const pool = makePool(async (sql) => {
    sqls.push(sql);
    if (/CURRENT_DATE/i.test(sql)) {
      return { rows: [{ start_date: '2026-07-19', end_date: '2026-07-26' }] };
    }
    if (/pos_orders/i.test(sql)) {
      return { rows: [{ dine_orders: 2, dine_traffic: 4, dine_before_revenue: 800 }] };
    }
    return { rows: [{ report_days: 0, dr_orders: 0, dr_traffic: 0, dr_dine_before_revenue: 0 }] };
  });
  const r = await fetchDineMetricsForDays(pool, '洪潮大宁久光店', 7);
  assert.equal(r.dine_orders, 2);
  assert.ok(sqls.some((s) => /CURRENT_DATE/i.test(s)));
});
