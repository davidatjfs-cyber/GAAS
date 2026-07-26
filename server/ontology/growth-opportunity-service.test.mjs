import test from 'node:test';
import assert from 'node:assert/strict';
import {
  opportunityTypesForIssue,
  buildOpportunityFromIssue,
  createOpportunitiesForIssue,
  listOpportunities,
} from './growth-opportunity-service.js';

function makePool(handler) {
  return { query: handler || (async () => ({ rows: [] })) };
}

const baseIssue = {
  tenant_id: 'default',
  store_id: 's1',
  issue_id: 'issue_1',
  issue_type: 'repeat_decline',
  issue_title: '复购偏弱',
  severity: 'P2',
  evidence_json: { revenueGap: 1200, rule_id: 'r1', rule_version: 1 },
};

test('opportunityTypesForIssue maps issue types to opportunity templates', () => {
  assert.deepEqual(opportunityTypesForIssue('repeat_decline'), ['new_customer_second_visit', 'dormant_customer_reactivation']);
  assert.deepEqual(opportunityTypesForIssue('unknown_issue'), []);
});

test('buildOpportunityFromIssue builds customer segment opportunity with ROI', () => {
  const opp = buildOpportunityFromIssue(baseIssue, 'vip_retention');
  assert.match(opp.opportunity_id, /^opp_/);
  assert.equal(opp.opportunity_type, 'vip_retention');
  assert.equal(opp.title, '高价值客户维护');
  assert.equal(opp.estimated_revenue_uplift, 1200);
  assert.equal(opp.estimated_cost, 300);
  assert.equal(opp.expected_roi, 4);
  assert.ok(Array.isArray(opp.recommended_actions_json));
  assert.equal(opp.recommended_actions_json[0].step, 1);
});

test('buildOpportunityFromIssue uses new customer copy when type matches', () => {
  const issue = {
    ...baseIssue,
    issue_type: 'new_customer_no_second_visit',
    evidence_json: { noSecondVisit: 6, candidates: 8 },
  };
  const opp = buildOpportunityFromIssue(issue, 'new_customer_second_visit');
  assert.match(opp.description, /6 位新客/);
});

test('createOpportunitiesForIssue inserts configured opportunity types', async () => {
  const inserts = [];
  const pool = makePool(async (sql, params) => {
    if (/INSERT INTO growth_ontology_opportunities/i.test(sql)) {
      inserts.push(params);
      return {
        rows: [{
          opportunity_id: params[0],
          tenant_id: params[1],
          store_id: params[2],
          issue_id: params[3],
          opportunity_type: params[4],
          description: 'saved',
          evidence_json: { rule_id: 'r1', rule_version: 1 },
          priority: 'P2',
        }],
      };
    }
    if (/ontology_rule_hits/i.test(sql)) return { rows: [] };
    return { rows: [] };
  });
  const issue = {
    ...baseIssue,
    evidence_json: {
      ...baseIssue.evidence_json,
      rule_action: { generate_opportunity: 'vip_retention', recommended_action: '店长回访' },
    },
  };
  const created = await createOpportunitiesForIssue(pool, issue);
  assert.equal(inserts.length, 1);
  assert.equal(created.length, 1);
  assert.equal(created[0].opportunity_type, 'vip_retention');
});

test('listOpportunities filters by tenant and optional store', async () => {
  const pool = makePool(async (sql, params) => {
    assert.equal(params[0], 'default');
    assert.equal(params[1], 's1');
    return { rows: [{ opportunity_id: 'opp_x', status: 'open' }] };
  });
  const rows = await listOpportunities(pool, { tenantId: 'default', storeId: 's1' });
  assert.equal(rows.length, 1);
});
