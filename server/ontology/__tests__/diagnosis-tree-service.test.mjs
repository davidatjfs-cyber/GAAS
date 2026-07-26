import test from 'node:test';
import assert from 'node:assert/strict';
import { runDailyDiagnosis, listIssues } from '../diagnosis-tree-service.js';

function makePool(queryFn) {
  return { query: queryFn || (async () => ({ rows: [] })) };
}

test('runDailyDiagnosis returns insufficient_data without storeId', async () => {
  const pool = makePool();
  const r = await runDailyDiagnosis(pool, { tenantId: 'default' });
  assert.equal(r.ontologyStatus, 'insufficient_data');
  assert.deepEqual(r.missingFields, ['store_id']);
  assert.deepEqual(r.issues, []);
});

test('runDailyDiagnosis orchestrates helpers and returns ok', async () => {
  let insertCount = 0;
  let orderCalls = 0;
  const pool = makePool(async (sql) => {
    if (/INSERT INTO growth_ontology_issues/i.test(sql)) {
      insertCount += 1;
      return {
        rows: [{
          issue_id: 'issue_test',
          issue_type: 'revenue_decline',
          evidence_json: {},
          confidence_score: 0.8,
          severity: 'P2',
        }],
      };
    }
    if (/growth_ontology_orders/i.test(sql) && /sum\(actual_paid\)/i.test(sql)) {
      orderCalls += 1;
      const revenue = orderCalls === 1 ? 8000 : 10000;
      return { rows: [{ revenue, orders: 10, customers: 8 }] };
    }
    if (/growth_ontology_customers/i.test(sql) && /repeat_customers/i.test(sql)) {
      return { rows: [{ repeat_customers: 5, customers: 10, risk_customers: 0 }] };
    }
    if (/growth_ontology_touches/i.test(sql)) {
      return { rows: [{ touched: 0, returned: 0 }] };
    }
    if (/growth_ontology_employees/i.test(sql)) {
      return { rows: [{ avg_score: 80, low_count: 0 }] };
    }
    if (/dormant_count/i.test(sql)) {
      return { rows: [{ dormant_count: 0, priority_customer_count: 0, max_visit_count: 0, max_total_spend: 0, avg_total_spend: 0, min_last_visit_days: 90 }] };
    }
    if (/first_visit AS/i.test(sql)) {
      return { rows: [{ candidates: 0, no_second_visit: 0, signature_dish_customers: 0, avg_first_spend: 0 }] };
    }
    if (/UPDATE growth_ontology/i.test(sql)) return { rowCount: 0 };
    return { rows: [] };
  });

  const r = await runDailyDiagnosis(pool, { tenantId: 'default', storeId: 's1', date: '2026-07-26' });
  assert.equal(r.ontologyStatus, 'ok');
  assert.ok(r.issues.length >= 1);
  assert.ok(insertCount >= 1);
  assert.equal(r.marketingStats.evaluated, false);
});

test('listIssues maps boss_language_summary', async () => {
  const pool = makePool(async () => ({
    rows: [{
      issue_id: 'issue_1',
      issue_type: 'repeat_decline',
      issue_title: '复购偏弱',
      status: 'open',
    }],
  }));
  const items = await listIssues(pool, { tenantId: 'default', storeId: 's1' });
  assert.equal(items.length, 1);
  assert.ok(typeof items[0].boss_language_summary === 'string');
  assert.match(items[0].boss_language_summary, /老客/);
});
