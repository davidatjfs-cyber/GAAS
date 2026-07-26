import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyAllStores,
  computeAllBenchmarks,
  getBenchmarkForStore,
  getKpiWeightsForBusinessType,
} from './benchmark-service.js';

function makePool(handler) {
  return { query: handler || (async () => ({ rows: [] })) };
}

test('classifyAllStores updates each active store segment fields', async () => {
  const sqls = [];
  const pool = makePool(async (sql, params) => {
    sqls.push(sql);
    if (/SELECT store_id, tenant_id/i.test(sql)) {
      return {
        rows: [
          { store_id: 's1', tenant_id: 'default', raw_business_type: '火锅' },
        ],
      };
    }
    if (/AVG\(actual_revenue\)/i.test(sql)) {
      return { rows: [{ avg_daily_revenue: 12000, avg_ticket: 88 }] };
    }
    if (/UPDATE growth_ontology_stores/i.test(sql)) {
      assert.equal(params[1], 'hotpot');
      assert.equal(params[2], 'M');
      assert.equal(params[3], 'value');
      return { rowCount: 1 };
    }
    return { rows: [] };
  });
  const r = await classifyAllStores(pool);
  assert.equal(r.ok, true);
  assert.equal(r.updated, 1);
  assert.ok(sqls.some((s) => /UPDATE growth_ontology_stores/i.test(s)));
});

test('computeAllBenchmarks writes platform rows when sample size sufficient', async () => {
  const inserts = [];
  const pool = makePool(async (sql) => {
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
    if (/PERCENTILE_CONT/i.test(sql)) {
      return {
        rows: [{
          business_type: 'hotpot',
          scale: 'M',
          price_band: 'value',
          p10: 1, p25: 2, p50: 3, p75: 4, p90: 5,
          mean: 3, std: 1, sample_stores: 25,
        }],
      };
    }
    if (/INSERT INTO growth_ontology_benchmarks/i.test(sql)) {
      inserts.push(sql);
      return { rows: [] };
    }
    return { rows: [] };
  });
  const r = await computeAllBenchmarks(pool);
  assert.equal(r.ok, true);
  assert.ok(r.written >= 1);
  assert.ok(inserts.length >= 1);
});

test('computeAllBenchmarks rolls back on error', async () => {
  const sqls = [];
  const pool = makePool(async (sql) => {
    sqls.push(sql);
    if (sql === 'BEGIN') return { rows: [] };
    if (/PERCENTILE_CONT/i.test(sql)) throw new Error('stats failed');
    return { rows: [] };
  });
  await assert.rejects(() => computeAllBenchmarks(pool), /stats failed/);
  assert.ok(sqls.includes('ROLLBACK'));
});

test('getBenchmarkForStore prefers platform benchmark over industry reference', async () => {
  const pool = makePool(async (sql) => {
    if (/FROM growth_ontology_stores WHERE store_id/i.test(sql)) {
      return { rows: [{ business_type: 'hotpot', scale: 'M', price_band: 'value' }] };
    }
    if (/source = 'platform'/i.test(sql)) {
      return { rows: [{ p50: 66, sample_size: 40, confidence_score: 0.8 }] };
    }
    return { rows: [] };
  });
  const bench = await getBenchmarkForStore(pool, 's1', 'avg_ticket_price');
  assert.equal(bench.source, 'platform');
  assert.equal(bench.p50, 66);
});

test('getBenchmarkForStore falls back to industry reference when platform missing', async () => {
  const pool = makePool(async (sql) => {
    if (/FROM growth_ontology_stores WHERE store_id/i.test(sql)) {
      return { rows: [{ business_type: 'cafe', scale: 'S', price_band: 'value' }] };
    }
    return { rows: [] };
  });
  const bench = await getBenchmarkForStore(pool, 's2', 'gross_margin_rate');
  assert.equal(bench.source, 'industry_reference');
  assert.equal(bench.p50, 0.68);
  assert.equal(bench.sample_size, 0);
});

test('getBenchmarkForStore returns null when store segment unknown', async () => {
  const pool = makePool(async () => ({ rows: [] }));
  assert.equal(await getBenchmarkForStore(pool, 'missing', 'avg_ticket_price'), null);
});

test('getKpiWeightsForBusinessType uses DB override when present', async () => {
  const pool = makePool(async () => ({
    rows: [{ weights: { avg_ticket_price: 9, repeat_rate_30d: 10 } }],
  }));
  const w = await getKpiWeightsForBusinessType(pool, 'hotpot');
  assert.equal(w.avg_ticket_price, 9);
});

test('getKpiWeightsForBusinessType falls back to defaults', async () => {
  const pool = makePool(async () => ({ rows: [] }));
  const w = await getKpiWeightsForBusinessType(pool, 'hotpot');
  assert.equal(w.table_turnover_rate, 10);
});
