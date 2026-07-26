import test from 'node:test';
import assert from 'node:assert/strict';
import { buildClosedLoopReport } from './closed-loop-report-service.js';

function makePool(rowsByPattern) {
  return {
    query: async (sql) => {
      for (const [pattern, rows] of rowsByPattern) {
        if (pattern.test(sql)) return { rows };
      }
      return { rows: [] };
    },
  };
}

test('buildClosedLoopReport returns insufficient_data when no ontology rows', async () => {
  const pool = makePool([]);
  const report = await buildClosedLoopReport(pool, { tenantId: 'default', storeId: 's1' });
  assert.equal(report.ok, true);
  assert.equal(report.ontologyStatus, 'insufficient_data');
  assert.match(report.boss_summary, /没有足够问题数据/);
});

test('buildClosedLoopReport summarizes issue and opportunity counts', async () => {
  const pool = makePool([
    [/growth_ontology_issues/i, [{ issue_id: 'i1', issue_type: 'repeat_decline', issue_title: '复购偏弱', severity: 'P2', evidence_json: {} }]],
    [/growth_ontology_opportunities/i, [{ opportunity_id: 'o1', opportunity_type: 'vip_retention', title: '高价值客户维护', estimated_revenue_uplift: 800, evidence_json: {} }]],
    [/master_tasks/i, [{ task_id: 't1', status: 'open', title: '跟进' }]],
    [/growth_ontology_business_results/i, []],
    [/growth_ontology_attributions/i, []],
  ]);
  const report = await buildClosedLoopReport(pool, { tenantId: 'default', storeId: 's1' });
  assert.equal(report.ontologyStatus, 'ok');
  assert.match(report.boss_summary, /1 个增长机会/);
  assert.equal(report.tasks.length, 1);
  assert.equal(report.attributionSummary.attributedRevenue, 0);
});

test('buildClosedLoopReport prefers dormant customer reactivation scenario', async () => {
  const pool = makePool([
    [/growth_ontology_issues/i, []],
    [/growth_ontology_opportunities/i, [{
      opportunity_id: 'o-dormant',
      opportunity_type: 'dormant_customer_reactivation',
      title: '沉睡客户唤醒',
      evidence_json: {},
    }]],
    [/master_tasks/i, []],
    [/growth_ontology_business_results/i, []],
    [/growth_ontology_attributions/i, [{
      opportunity_id: 'o-dormant',
      customer_id: 'c1',
      actual_value: 300,
      related_order_id: 'ord1',
      attribution_method: 'touch',
      evidence_json: {},
    }, {
      opportunity_id: 'o-dormant',
      customer_id: 'c2',
      actual_value: 200,
      related_order_id: 'ord2',
      attribution_method: 'touch',
      evidence_json: {},
    }]],
  ]);
  const report = await buildClosedLoopReport(pool, {
    tenantId: 'default',
    storeId: 's1',
    preferredScenario: 'dormant_customer_reactivation',
  });
  assert.match(report.boss_summary, /500 元/);
  assert.match(report.boss_summary, /2 位客户回店/);
  assert.equal(report.attributionSummary.attributedRevenue, 500);
});

test('buildClosedLoopReport highlights new customer second visit summary', async () => {
  const pool = makePool([
    [/growth_ontology_issues/i, [{
      issue_id: 'i-nc',
      issue_type: 'new_customer_no_second_visit',
      issue_title: '新客未复购',
      severity: 'P2',
      evidence_json: { noSecondVisit: 5, signatureDishCustomers: 2 },
    }]],
    [/growth_ontology_opportunities/i, []],
    [/master_tasks/i, []],
    [/growth_ontology_business_results/i, [{
      result_type: 'new_customer_second_visit',
      evidence_json: { newCustomerTouchedCount: 4, secondVisitCustomerCount: 2, secondVisitRevenue: 600 },
    }]],
    [/growth_ontology_attributions/i, []],
  ]);
  const report = await buildClosedLoopReport(pool, { tenantId: 'default', storeId: 's1' });
  assert.match(report.boss_summary, /5 位新客/);
  assert.match(report.actual_business_impact, /二次回店 2 位/);
});
