import test from 'node:test';
import assert from 'node:assert/strict';
import { trackGrowthResults } from './result-tracking-service.js';

function makePool(handler) {
  return { query: handler || (async () => ({ rows: [] })) };
}

test('trackGrowthResults tracks new customer second visit metrics', async () => {
  const inserts = [];
  const pool = makePool(async (sql, params) => {
    if (/FROM growth_ontology_opportunities/i.test(sql)) {
      return { rows: [{ opportunity_type: 'new_customer_second_visit', evidence_json: {} }] };
    }
    if (/WITH touched AS/i.test(sql)) {
      return {
        rows: [{
          touched_count: 10,
          returned_count: 4,
          second_visit_revenue: 1200,
          offer_cost: 200,
        }],
      };
    }
    if (/INSERT INTO growth_ontology_business_results/i.test(sql)) {
      inserts.push(params);
      return { rows: [{ result_id: params[0], result_type: 'new_customer_second_visit' }] };
    }
    return { rows: [] };
  });
  const saved = await trackGrowthResults(pool, {
    tenantId: 'default',
    storeId: 's1',
    opportunityId: 'opp_1',
  });
  assert.equal(inserts.length, 1);
  assert.match(saved.result_id, /^result_/);
  assert.equal(inserts[0][4], 1200);
  assert.equal(inserts[0][5], 1000);
});

test('trackGrowthResults tracks generic before/after revenue delta', async () => {
  const inserts = [];
  const pool = makePool(async (sql) => {
    if (/FROM growth_ontology_opportunities/i.test(sql)) return { rows: [] };
    if (/before_revenue/i.test(sql)) {
      return { rows: [{ before_revenue: 5000, after_revenue: 6200 }] };
    }
    if (/INSERT INTO growth_ontology_business_results/i.test(sql)) {
      inserts.push(sql);
      return { rows: [{ result_id: 'result_x', result_type: 'growth_closed_loop' }] };
    }
    return { rows: [] };
  });
  const saved = await trackGrowthResults(pool, {
    tenantId: 'default',
    storeId: 's1',
    beforeDays: 7,
    afterDays: 7,
  });
  assert.equal(saved.result_type, 'growth_closed_loop');
  assert.equal(inserts.length, 1);
});
