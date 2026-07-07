import test from 'node:test';
import assert from 'node:assert/strict';
import {
  runOperationDiagnosisAgent,
  generateOperationDiagnosisTasks,
} from './operation-diagnosis-agent.js';

const sampleIssues = [
  {
    issue_id: 'issue_p1_revenue',
    tenant_id: 'default',
    store_id: 'store_001',
    issue_type: 'revenue_decline',
    issue_title: '营业额下滑',
    issue_description: '本期营业额低于可比周期',
    severity: 'P1',
    confidence_score: 0.84,
    evidence_json: { currentRevenue: 80000, previousRevenue: 100000, changeRate: -20, revenueGap: 20000 },
    root_cause_candidates_json: ['traffic_decline'],
    impact_amount_estimate: 20000,
  },
  {
    issue_id: 'issue_p2_repeat',
    tenant_id: 'default',
    store_id: 'store_001',
    issue_type: 'repeat_decline',
    issue_title: '复购偏弱',
    issue_description: '复购客户占比偏低',
    severity: 'P2',
    confidence_score: 0.76,
    evidence_json: { repeatRate: 0.25, customers: 120, riskCustomers: 10 },
    root_cause_candidates_json: ['new_customer_not_followed'],
    impact_amount_estimate: 0,
  },
  {
    issue_id: 'issue_p3_staff',
    tenant_id: 'default',
    store_id: 'store_001',
    issue_type: 'staff_execution_risk',
    issue_title: '员工执行风险',
    issue_description: '部分员工执行评分偏低',
    severity: 'P3',
    confidence_score: 0.72,
    evidence_json: { lowCount: 2 },
    root_cause_candidates_json: ['training_not_completed'],
    impact_amount_estimate: 0,
  },
];

const sampleOpportunities = [
  {
    opportunity_id: 'opp_001',
    tenant_id: 'default',
    store_id: 'store_001',
    issue_id: 'issue_p1_revenue',
    opportunity_type: 'lunch_revenue_recovery',
    title: '午市营业恢复',
    description: '拆解午市客群，设计午市套餐',
    priority: 'P1',
    estimated_revenue_uplift: 15000,
    evidence_json: { rule_id: 'revenue_decline' },
    recommended_actions_json: [
      { actionName: '拆解午市客群', step: 1, ownerRole: '店长', deadlineDays: 3, expectedResult: '识别出午市流失客群', trackingMetrics: ['午市客流'] },
      { actionName: '设计午市套餐', step: 2, ownerRole: '厨师长', deadlineDays: 7, expectedResult: '推出新套餐', trackingMetrics: ['套餐销量'] },
    ],
  },
  {
    opportunity_id: 'opp_002',
    tenant_id: 'default',
    store_id: 'store_001',
    issue_id: 'issue_p2_repeat',
    opportunity_type: 'dormant_customer_reactivation',
    title: '沉睡客户唤醒',
    description: '导出沉睡客户名单并触达',
    priority: 'P2',
    estimated_revenue_uplift: 8000,
    evidence_json: { rule_id: 'repeat_rate_low' },
    recommended_actions_json: [
      { actionName: '导出沉睡客户名单', step: 1, ownerRole: '营销负责人', deadlineDays: 3, expectedResult: '完成名单筛选', trackingMetrics: ['触达人数', '回店人数'] },
    ],
  },
];

function makeOntologyClient(data) {
  return async () => ({
    diagnosis: data.diagnosis || { ontologyStatus: 'ok', issues: data.issues || [], opportunities: data.opportunities || [] },
    issues: data.issues || [],
    opportunities: data.opportunities || [],
    closedLoopReport: data.closedLoopReport || { ontologyStatus: 'ok', issues: data.issues || [], opportunities: data.opportunities || [], tasks: [], results: [], attributionSummary: {} },
    taskDrafts: data.taskDrafts || [],
    evidence: data.evidence || [],
    raw: {},
    ontologyAvailable: data.ontologyAvailable !== false,
    calledApis: data.calledApis || ['diagnosis/daily', 'issues', 'opportunities', 'closed-loop-report'],
    issuesCount: (data.issues || []).length,
    opportunitiesCount: (data.opportunities || []).length,
    generatedAt: new Date().toISOString(),
  });
}

test('runOperationDiagnosisAgent returns structured output with sorted top issues', async () => {
  const pool = {};
  const result = await runOperationDiagnosisAgent(pool, {
    tenantId: 'default',
    storeId: 'store_001',
    storeName: '测试门店',
    date: '2026-07-07',
    ontologyClient: makeOntologyClient({ issues: sampleIssues, opportunities: sampleOpportunities }),
  });

  assert.equal(result.topIssues.length, 3, 'should return up to 3 top issues');
  assert.equal(result.topIssues[0].priority, 'P1', 'first issue should be P1');
  assert.equal(result.topIssues[1].priority, 'P2', 'second issue should be P2');
  assert.equal(result.topIssues[2].priority, 'P3', 'third issue should be P3');
  assert.equal(result.topIssues[0].ownerRole, '店长', 'P1 revenue issue owner should be 店长');
  assert.ok(result.recommendedActions.length > 0, 'should have recommended actions');
  assert.ok(result.taskDrafts.length > 0, 'should have task drafts');
  assert.ok(result.evidence.length > 0, 'should have evidence');
  assert.ok(result.naturalLanguageAnswer.length > 0, 'should have natural language answer');
  assert.equal(result.ontologyMeta.ontologyAvailable, true, 'ontology should be available');
  assert.ok(result.ontologyMeta.calledApis.length > 0, 'calledApis should not be empty');
  assert.equal(result.ontologyMeta.issuesCount, 3, 'issuesCount should be 3');
  assert.equal(result.ontologyMeta.opportunitiesCount, 2, 'opportunitiesCount should be 2');
});

test('runOperationDiagnosisAgent returns insufficient data when ontology is empty', async () => {
  const pool = {};
  const result = await runOperationDiagnosisAgent(pool, {
    tenantId: 'default',
    storeId: 'store_empty',
    date: '2026-07-07',
    ontologyClient: makeOntologyClient({ issues: [], opportunities: [] }),
  });

  assert.equal(result.bossSummary, '当前数据不足，无法形成可靠经营诊断。');
  assert.deepEqual(result.topIssues, []);
  assert.deepEqual(result.recommendedActions, []);
  assert.deepEqual(result.taskDrafts, []);
  assert.deepEqual(result.evidence, []);
  assert.ok(result.naturalLanguageAnswer.includes('当前数据不足'), 'natural language should mention insufficient data');
  assert.equal(result.ontologyMeta.issuesCount, 0);
  assert.equal(result.ontologyMeta.opportunitiesCount, 0);
});

test('runOperationDiagnosisAgent does not fabricate issues when ontology API fails', async () => {
  const pool = {};
  const result = await runOperationDiagnosisAgent(pool, {
    tenantId: 'default',
    storeId: 'store_error',
    date: '2026-07-07',
    ontologyClient: async () => {
      throw new Error('ontology service unavailable');
    },
  });

  assert.equal(result.ontologyMeta.ontologyAvailable, false, 'ontologyAvailable should be false');
  assert.deepEqual(result.topIssues, []);
  assert.deepEqual(result.recommendedActions, []);
  assert.deepEqual(result.taskDrafts, []);
  assert.ok(result.naturalLanguageAnswer.includes('当前数据不足'), 'should not fabricate');
});

test('generateOperationDiagnosisTasks prevents duplicate task creation', async () => {
  let existingChecked = false;
  const pool = {
    query: async (sql) => {
      if (sql.includes('SELECT * FROM growth_ontology_opportunities WHERE')) {
        return { rows: [sampleOpportunities[0]] };
      }
      if (sql.includes('SELECT task_id, status, source_data')) {
        existingChecked = true;
        return { rows: [{ task_id: 'EXISTING-001', status: 'pending_dispatch', source_data: { sourceOpportunityId: 'opp_001' } }] };
      }
      return { rows: [] };
    },
  };
  const result = await generateOperationDiagnosisTasks(pool, { tenantId: 'default', storeId: 'store_001', opportunityId: 'opp_001' });

  assert.equal(existingChecked, true, 'should check existing tasks');
  assert.equal(result.ok, true, 'should return ok');
  assert.equal(result.existing, true, 'should mark as existing');
  assert.equal(result.taskId, 'EXISTING-001', 'should return existing taskId');
});

test('generateOperationDiagnosisTasks writes required source_data fields', async () => {
  let insertedSourceData = null;
  const pool = {
    query: async (sql, params) => {
      if (sql.includes('SELECT * FROM growth_ontology_opportunities WHERE')) {
        return { rows: [sampleOpportunities[0]] };
      }
      if (sql.includes('SELECT task_id, status, source_data FROM master_tasks')) {
        return { rows: [] };
      }
      if (sql.includes('INSERT INTO master_tasks')) {
        insertedSourceData = JSON.parse(params[9]);
        return { rows: [{ task_id: params[0] || 'TASK-001', title: params[7], status: 'pending_dispatch', source_data: insertedSourceData }] };
      }
      if (sql.includes('INSERT INTO ontology_rule_hits')) {
        return { rows: [{ id: 1 }] };
      }
      if (sql.includes('UPDATE growth_ontology_opportunities')) return { rows: [] };
      return { rows: [] };
    },
  };
  const result = await generateOperationDiagnosisTasks(pool, { tenantId: 'default', storeId: 'store_001', opportunityId: 'opp_001' });

  assert.equal(result.ok, true);
  assert.equal(insertedSourceData.source, 'ontology_agent');
  assert.equal(insertedSourceData.sourceOpportunityId, 'opp_001');
  assert.equal(insertedSourceData.sourceReportType, 'operation_diagnosis_agent');
  assert.equal(insertedSourceData.generatedByAgent, 'operation_diagnosis_agent');
  assert.ok(Array.isArray(insertedSourceData.trackingMetrics), 'trackingMetrics should be array');
  assert.ok(insertedSourceData.expectedResult, 'expectedResult should be set');
});
