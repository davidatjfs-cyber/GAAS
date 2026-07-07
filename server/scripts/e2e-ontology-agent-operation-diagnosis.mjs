#!/usr/bin/env node
import { Pool } from 'pg';
import { ensureGrowthOntologyCore } from '../ontology/growth-ontology-schema.js';

const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:3000';
const DATABASE_URL = process.env.E2E_DATABASE_URL || process.env.DATABASE_URL || 'postgres://hrms:Abc1234567!@127.0.0.1:5432/hrms';
const TENANT_ID = process.env.E2E_TENANT_ID || 'default';
const STORE_ID = process.env.E2E_STORE_ID || 'ontology_agent_store_001';
const TOKEN_FROM_ENV = process.env.E2E_TOKEN || '';

const pool = new Pool({ connectionString: DATABASE_URL });
const failures = [];

function todayLocal() {
  const now = new Date();
  const local = new Date(now.getTime() + 8 * 3600000);
  return local.toISOString().slice(0, 10);
}

function isoDaysAgo(days, hour = 12) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

function check(name, condition, detail = {}) {
  if (condition) {
    console.log(`PASS ${name}`);
  } else {
    failures.push({ name, detail });
    console.log(`FAIL ${name}`, JSON.stringify(detail).slice(0, 1200));
  }
}

async function api(path, options = {}, token) {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!res.ok) throw new Error(`${path} ${res.status}: ${JSON.stringify(json).slice(0, 1000)}`);
  return json;
}

async function getToken() {
  if (TOKEN_FROM_ENV) return TOKEN_FROM_ENV;
  const res = await fetch(`${BASE_URL}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123', tenant_id: TENANT_ID }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.token) {
    throw new Error('E2E_TOKEN is required. 本地开发环境可用 admin/admin123 登录；生产或无本地账号时请先调用 /api/login 获取 token 后设置 E2E_TOKEN。');
  }
  return json.token;
}

async function cleanup() {
  const queries = [
    [`DELETE FROM master_tasks WHERE tenant_id=$1 AND (store_id=$2 OR store=$2)`, [TENANT_ID, STORE_ID]],
    [`DELETE FROM growth_ontology_business_results WHERE tenant_id=$1 AND store_id=$2`, [TENANT_ID, STORE_ID]],
    [`DELETE FROM growth_ontology_opportunities WHERE tenant_id=$1 AND store_id=$2`, [TENANT_ID, STORE_ID]],
    [`DELETE FROM growth_ontology_issues WHERE tenant_id=$1 AND store_id=$2`, [TENANT_ID, STORE_ID]],
    [`DELETE FROM growth_ontology_orders WHERE tenant_id=$1 AND store_id=$2`, [TENANT_ID, STORE_ID]],
    [`DELETE FROM growth_ontology_customers WHERE tenant_id=$1 AND store_id=$2`, [TENANT_ID, STORE_ID]],
    [`DELETE FROM growth_ontology_employees WHERE tenant_id=$1 AND store_id=$2`, [TENANT_ID, STORE_ID]],
    [`DELETE FROM growth_ontology_stores WHERE tenant_id=$1 AND store_id=$2`, [TENANT_ID, STORE_ID]],
  ];
  for (const [sql, params] of queries) await pool.query(sql, params).catch(() => {});
}

async function seed() {
  const date = todayLocal();
  const prevDate = new Date(new Date(`${date}T00:00:00+08:00`).getTime() - 7 * 86400000).toISOString().slice(0, 10);

  await pool.query(
    `INSERT INTO growth_ontology_stores (store_id, tenant_id, name, city, business_type, status)
     VALUES ($1,$2,'E2E经营诊断门店','上海','restaurant','active')
     ON CONFLICT (store_id) DO UPDATE SET updated_at=now()`,
    [STORE_ID, TENANT_ID]
  );

  await pool.query(
    `INSERT INTO growth_ontology_employees (employee_id, tenant_id, store_id, name, role, status, skill_level, performance_score)
     VALUES ('emp_agent_001',$1,$2,'E2E店长','store_manager','active','mid',62)
     ON CONFLICT (employee_id) DO UPDATE SET updated_at=now()`,
    [TENANT_ID, STORE_ID]
  );

  const customers = [
    ['cust_agent_001', '13800000001', 3, 1200, 'active', 'high'],
    ['cust_agent_002', '13800000002', 1, 300, 'new', 'medium'],
    ['cust_agent_003', '13800000003', 4, 1800, 'dormant', 'high'],
  ];
  for (const c of customers) {
    await pool.query(
      `INSERT INTO growth_ontology_customers (
        customer_id, tenant_id, store_id, phone, first_visit_at, last_visit_at, visit_count,
        total_spend, avg_spend, lifecycle_stage, tags, risk_level, value_level
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'[]'::jsonb,$11,$12)
      ON CONFLICT (customer_id) DO UPDATE SET updated_at=now()`,
      [c[0], TENANT_ID, STORE_ID, c[1], isoDaysAgo(60), isoDaysAgo(20), c[2], c[3], c[3] / c[2], c[4], c[5], c[5]]
    );
  }

  const orders = [
    ['order_agent_prev_001', 'cust_agent_001', `${prevDate}T12:00:00+08:00`, 600],
    ['order_agent_prev_002', 'cust_agent_003', `${prevDate}T19:00:00+08:00`, 900],
    ['order_agent_cur_001', 'cust_agent_001', `${date}T12:00:00+08:00`, 400],
    ['order_agent_cur_002', 'cust_agent_002', `${date}T13:00:00+08:00`, 300],
  ];
  for (const o of orders) {
    await pool.query(
      `INSERT INTO growth_ontology_orders (order_id, tenant_id, store_id, customer_id, order_time, amount, discount_amount, actual_paid, pax, channel, source)
       VALUES ($1,$2,$3,$4,$5,$6,0,$6,2,'pos','e2e')
       ON CONFLICT (order_id) DO UPDATE SET updated_at=now()`,
      [o[0], TENANT_ID, STORE_ID, o[1], o[2], o[3]]
    );
  }

  await pool.query(
    `INSERT INTO growth_ontology_issues (
      issue_id, tenant_id, store_id, issue_type, issue_title, issue_description, severity,
      confidence_score, evidence_json, root_cause_candidates_json, impact_amount_estimate,
      status, first_detected_at, last_detected_at
    ) VALUES ($1,$2,$3,'revenue_decline','营业额下滑','本期营业额低于可比周期','P1',0.84,
      '{"currentRevenue": 700, "previousRevenue": 1500, "changeRate": -53.33, "revenueGap": 800}',
      '["traffic_decline","repeat_decline","lunch_decline"]', 800, 'open', now(), now())
    ON CONFLICT (issue_id) DO UPDATE SET updated_at=now()`,
    ['issue_agent_001', TENANT_ID, STORE_ID]
  );

  await pool.query(
    `INSERT INTO growth_ontology_opportunities (
      opportunity_id, tenant_id, store_id, issue_id, opportunity_type, title, description,
      target_entity_type, target_entity_ids_json, estimated_revenue_uplift, estimated_cost,
      expected_roi, priority, evidence_json, recommended_actions_json, status
    ) VALUES ($1,$2,$3,$4,'lunch_revenue_recovery','午市营业恢复','拆解午市客群，设计午市套餐',
      'customer_segment','[]', 800, 0, null, 'P1',
      '{"rule_id":"revenue_decline"}',
      '[{"actionName":"拆解午市客群","step":1,"ownerRole":"店长","deadlineDays":3,"expectedResult":"识别出午市流失客群","trackingMetrics":["午市客流"]},{"actionName":"设计午市套餐","step":2,"ownerRole":"厨师长","deadlineDays":7,"expectedResult":"推出新套餐","trackingMetrics":["套餐销量"]}]',
      'open')
    ON CONFLICT (opportunity_id) DO UPDATE SET updated_at=now()`,
    ['opp_agent_001', TENANT_ID, STORE_ID, 'issue_agent_001']
  );
}

async function run() {
  const token = await getToken();
  await ensureGrowthOntologyCore(pool);
  await cleanup();
  await seed();

  const date = todayLocal();

  const diagnosis = await api(`/api/ai/operation-diagnosis?tenant_id=${encodeURIComponent(TENANT_ID)}&store_id=${encodeURIComponent(STORE_ID)}&store_name=${encodeURIComponent('E2E经营诊断门店')}&date=${date}`, {}, token);

  check('Response has bossSummary', typeof diagnosis.bossSummary === 'string' && diagnosis.bossSummary.length > 0, { bossSummary: diagnosis.bossSummary });
  check('Response has topIssues', Array.isArray(diagnosis.topIssues), { topIssues: diagnosis.topIssues });
  check('Response has recommendedActions', Array.isArray(diagnosis.recommendedActions), { recommendedActions: diagnosis.recommendedActions });
  check('Response has taskDrafts', Array.isArray(diagnosis.taskDrafts), { taskDrafts: diagnosis.taskDrafts });
  check('Response has evidence', Array.isArray(diagnosis.evidence) && diagnosis.evidence.length > 0, { evidence: diagnosis.evidence });
  check('Response has naturalLanguageAnswer', typeof diagnosis.naturalLanguageAnswer === 'string' && diagnosis.naturalLanguageAnswer.length > 0, { naturalLanguageAnswer: diagnosis.naturalLanguageAnswer });
  check('Response has ontologyMeta', diagnosis.ontologyMeta && typeof diagnosis.ontologyMeta === 'object', { ontologyMeta: diagnosis.ontologyMeta });
  check('ontologyMeta.calledApis is not empty', Array.isArray(diagnosis.ontologyMeta?.calledApis) && diagnosis.ontologyMeta.calledApis.length > 0, { calledApis: diagnosis.ontologyMeta?.calledApis });
  check('topIssues contains P1 or P2', diagnosis.topIssues.some(i => ['P1', 'P2'].includes(i.priority)), { topIssues: diagnosis.topIssues });
  check('recommendedActions has ownerRole/deadlineDays/trackingMetrics/expectedResult', diagnosis.recommendedActions.every(a => a.ownerRole && a.deadlineDays && Array.isArray(a.trackingMetrics) && a.expectedResult), { recommendedActions: diagnosis.recommendedActions });
  check('naturalLanguageAnswer does not expose technical terms', !/\b(ontology|E2E|schema|entity|规则引擎)\b/i.test(diagnosis.naturalLanguageAnswer), { naturalLanguageAnswer: diagnosis.naturalLanguageAnswer });

  const draft = diagnosis.taskDrafts[0];
  check('At least one taskDraft exists', !!draft, { taskDrafts: diagnosis.taskDrafts });

  let taskId = null;
  if (draft) {
    const tasks = await api('/api/ai/operation-diagnosis/generate-tasks', {
      method: 'POST',
      body: JSON.stringify({ tenant_id: TENANT_ID, store_id: STORE_ID, opportunity_id: draft.sourceOpportunityId }),
    }, token);
    check('generate-tasks returns ok', tasks.ok === true, { tasks });
    taskId = tasks.tasks?.[0]?.task_id;
    check('generate-tasks returns taskId', typeof taskId === 'string' && taskId.length > 0, { tasks });
  }

  if (taskId) {
    const taskCheck = await pool.query(
      `SELECT task_id, source_data FROM master_tasks WHERE tenant_id=$1 AND task_id=$2`,
      [TENANT_ID, taskId]
    );
    const task = taskCheck.rows?.[0];
    check('Task exists in master_tasks', !!task, { taskId });
    if (task) {
      const sd = task.source_data || {};
      check('source_data.source is ontology_agent', sd.source === 'ontology_agent', { source_data: sd });
      check('source_data.sourceOpportunityId exists', !!sd.sourceOpportunityId, { source_data: sd });
      check('source_data.sourceDomain exists', !!sd.sourceDomain, { source_data: sd });
      check('source_data.sourceReportType is operation_diagnosis_agent', sd.sourceReportType === 'operation_diagnosis_agent', { source_data: sd });
      check('source_data.trackingMetrics is array', Array.isArray(sd.trackingMetrics), { source_data: sd });
      check('source_data.expectedResult exists', !!sd.expectedResult, { source_data: sd });
      check('source_data.generatedByAgent is operation_diagnosis_agent', sd.generatedByAgent === 'operation_diagnosis_agent', { source_data: sd });
    }
  }

  await cleanup();

  const emptyDiagnosis = await api(`/api/ai/operation-diagnosis?tenant_id=${encodeURIComponent(TENANT_ID)}&store_id=${encodeURIComponent(STORE_ID)}&date=${date}`, {}, token);
  check('Empty ontology returns insufficient data', emptyDiagnosis.bossSummary === '当前数据不足，无法形成可靠经营诊断。', { emptyDiagnosis });
  check('Empty topIssues is empty', Array.isArray(emptyDiagnosis.topIssues) && emptyDiagnosis.topIssues.length === 0, { topIssues: emptyDiagnosis.topIssues });
  check('Empty recommendedActions is empty', Array.isArray(emptyDiagnosis.recommendedActions) && emptyDiagnosis.recommendedActions.length === 0, { recommendedActions: emptyDiagnosis.recommendedActions });
  check('Empty taskDrafts is empty', Array.isArray(emptyDiagnosis.taskDrafts) && emptyDiagnosis.taskDrafts.length === 0, { taskDrafts: emptyDiagnosis.taskDrafts });
  check('Empty naturalLanguageAnswer mentions insufficient data', emptyDiagnosis.naturalLanguageAnswer.includes('当前数据不足'), { naturalLanguageAnswer: emptyDiagnosis.naturalLanguageAnswer });

  await cleanup();
  await pool.end().catch(() => {});

  if (failures.length) {
    console.error(JSON.stringify({ failures }, null, 2));
    process.exit(1);
  }
  console.log('E2E ontology-agent operation diagnosis PASSED');
}

run().catch(async (e) => {
  console.error(e?.stack || e);
  await cleanup().catch(() => {});
  await pool.end().catch(() => {});
  process.exit(1);
});
