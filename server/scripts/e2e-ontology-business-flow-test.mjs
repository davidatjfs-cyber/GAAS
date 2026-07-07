#!/usr/bin/env node
import {
  generateActionPlanFromInsights,
  generateBossSummary,
  inferIssuesFromMetrics,
} from '../ontology/business-ontology-engine.js';
import { createTaskDraftsFromOntologyInsights } from '../ontology/task-draft-adapter.js';
import { createOntologyTaskFromDraft } from '../ontology/ontology-task-adapter.js';
import { calculateCampaignAttributionFromRecords } from '../marketing/marketing-attribution-service.js';
import { Pool } from 'pg';

const BASE_URL = process.env.E2E_BASE_URL || '';
const TOKEN = process.env.E2E_TOKEN || '';
const DATABASE_URL = process.env.E2E_DATABASE_URL || process.env.DATABASE_URL || 'postgres://hrms:Abc1234567!@127.0.0.1:5432/hrms';
const TENANT_ID = process.env.E2E_TENANT_ID || 'default';
const TEST_STORE_ID = 'test_store_ontology_001';
const TEST_CAMPAIGN_ID = 'test_campaign_ontology_001';

const results = [];

function pass(name, detail = {}) {
  results.push({ ok: true, name, detail });
  console.log(`PASS ${name}`, Object.keys(detail).length ? JSON.stringify(detail) : '');
}

function fail(name, actual, expected, cause, file) {
  results.push({ ok: false, name, actual, expected, cause, file });
  console.log(`FAIL ${name}`);
  console.log('实际返回:', JSON.stringify(actual, null, 2).slice(0, 2000));
  console.log('预期结果:', JSON.stringify(expected, null, 2));
  console.log('可能原因:', cause);
  console.log('建议修复文件:', file);
}

function assertHasIssue(label, insights, issueId, title) {
  const found = insights.find(x => x.issueId === issueId && (!title || x.bossLanguageTitle === title));
  if (found) pass(`${label} 识别 ${issueId}`, { bossLanguageTitle: found.bossLanguageTitle });
  else fail(`${label} 识别 ${issueId}`, insights.map(x => ({ issueId: x.issueId, bossLanguageTitle: x.bossLanguageTitle })), { issueId, title }, 'ontology mapping 或 metricsInput adapter 未命中', 'server/ontology/metric-issue-mapping.js');
}

function inferScenario(label, metricsInput, expectedIssues, expectedActions = []) {
  const insights = inferIssuesFromMetrics(metricsInput);
  const bossSummary = generateBossSummary(insights);
  const actionPlan = generateActionPlanFromInsights(insights);
  const taskDrafts = createTaskDraftsFromOntologyInsights(insights);
  for (const [issueId, title] of expectedIssues) assertHasIssue(label, insights, issueId, title);
  if (bossSummary && !/ontology|metricId|指标ID/i.test(bossSummary)) pass(`${label} 生成老板语言 bossSummary`, { bossSummary });
  else fail(`${label} 生成老板语言 bossSummary`, bossSummary, '非空且不是技术字段描述', 'summary 生成逻辑异常', 'server/ontology/business-ontology-engine.js');
  for (const actionName of expectedActions) {
    if (actionPlan.some(x => x.actionName === actionName)) pass(`${label} actionPlan 包含 ${actionName}`);
    else fail(`${label} actionPlan 包含 ${actionName}`, actionPlan.map(x => x.actionName), actionName, 'issue-action mapping 缺少动作', 'server/ontology/issue-action-mapping.js');
  }
  if (taskDrafts.length) pass(`${label} 生成 taskDrafts`, { count: taskDrafts.length });
  else fail(`${label} 生成 taskDrafts`, taskDrafts, '非空', 'task draft adapter 未生成草稿', 'server/ontology/task-draft-adapter.js');
  return { insights, bossSummary, actionPlan, taskDrafts };
}

async function runLocalHarness() {
  const customer = inferScenario('客户资产报告', {
    repeat_purchase_rate: { current: 18, previous: 25, changeRate: -28 },
    vip_inactive_count: { current: 38, previous: 21, changeRate: 80 },
    new_customer_second_visit_rate: { current: 9, previous: 16, changeRate: -43.75 },
    stored_value_inactive_count: { current: 22, previous: 12, changeRate: 83.33 },
  }, [
    ['customer_retention_weak', '进得来，留不住'],
    ['vip_churn_risk', '高价值客户正在悄悄流失'],
    ['new_customer_activation_weak', '新客来了，但没有被接住'],
    ['stored_value_activation_weak', '钱收进来了，但消费没有拉动起来'],
  ], ['生成高价值客户维护名单', '生成新客 D4 / D8 触达任务', '生成储值余额提醒任务']);

  inferScenario('经营整改追踪', {
    revenue: { current: 85000, previous: 100000, changeRate: -15 },
    lunch_revenue: { current: 21000, previous: 30000, changeRate: -30 },
    service_complaint_rate: { current: 7, previous: 3, changeRate: 133.33 },
    dish_complaint_rate: { current: 5, previous: 2, changeRate: 150 },
    task_overdue_rate: { current: 18, previous: 8, changeRate: 125 },
  }, [
    ['revenue_decline', '生意结果开始掉头'],
    ['lunch_business_weak', '午市没有撑起来'],
    ['service_quality_issue', '客户感受没有被照顾好'],
    ['kitchen_quality_issue', '问题可能出在出品稳定性'],
    ['task_closure_weak', '问题发现了，但没有真正改完'],
  ]);

  inferScenario('人才盘点', {
    training_completion_rate: { current: 61, previous: 82, changeRate: -25.61 },
    certification_pass_rate: { current: 54, previous: 76, changeRate: -28.95 },
    promotion_candidate_count: { current: 3, previous: 8, changeRate: -62.5 },
  }, [
    ['training_execution_weak', '培训没有真正落到人'],
    ['skill_certification_weak', '员工会不会，系统要看得见'],
    ['talent_pipeline_weak', '后备干部不够，门店复制会受影响'],
  ], ['生成未完成培训人员清单', '生成补考和复训任务', '生成晋升候选人盘点']);

  const attribution = calculateCampaignAttributionFromRecords('test_campaign_ontology_001', [
    { touchId: 'touch_001', campaignId: 'test_campaign_ontology_001', customerId: 'customer_001', touchTime: '2026-07-01T10:00:00+08:00', couponId: 'coupon_001', channel: 'sms' },
    { touchId: 'touch_002', campaignId: 'test_campaign_ontology_001', customerId: 'customer_002', touchTime: '2026-07-01T11:00:00+08:00', couponId: null, channel: 'wecom' },
    { touchId: 'touch_003', campaignId: 'test_campaign_ontology_001', customerId: 'customer_003', touchTime: '2026-07-01T12:00:00+08:00', couponId: 'coupon_003', channel: 'sms' },
    { touchId: 'touch_004', campaignId: 'test_campaign_ontology_001', customerId: 'customer_004', touchTime: '2026-07-01T13:00:00+08:00', couponId: null, channel: 'sms' },
  ], [
    { orderId: 'order_001', customerId: 'customer_001', orderTime: '2026-07-03T18:00:00+08:00', orderAmount: 680, couponId: 'coupon_001' },
    { orderId: 'order_002', customerId: 'customer_002', orderTime: '2026-07-04T19:00:00+08:00', orderAmount: 520, couponId: null },
    { orderId: 'order_003', customerId: 'customer_003', orderTime: '2026-07-12T19:00:00+08:00', orderAmount: 880, couponId: 'coupon_003' },
    { orderId: 'order_004', customerId: '', orderTime: '2026-07-04T19:30:00+08:00', orderAmount: 300 },
  ], { attributionWindowDays: 7 });

  if (attribution.touchedCustomerCount === 4) pass('自动营销归因触达人数 = 4');
  else fail('自动营销归因触达人数 = 4', attribution.touchedCustomerCount, 4, '触达去重逻辑异常', 'server/marketing/marketing-attribution-service.js');
  if (attribution.attributedOrderCount === 2 && attribution.attributedRevenue === 1200) pass('自动营销归因金额 = 1200', { attributedOrderCount: attribution.attributedOrderCount });
  else fail('自动营销归因金额 = 1200', attribution, { attributedOrderCount: 2, attributedRevenue: 1200 }, '窗口或 customerId 归因规则异常', 'server/marketing/marketing-attribution-service.js');
  const ev1 = attribution.evidenceDetails.find(x => x.relatedOrderId === 'order_001');
  const ev2 = attribution.evidenceDetails.find(x => x.relatedOrderId === 'order_002');
  if (ev1?.attributionType === 'coupon') pass('evidenceDetails 包含 order_001 coupon 归因');
  else fail('evidenceDetails 包含 order_001 coupon 归因', attribution.evidenceDetails, { relatedOrderId: 'order_001', attributionType: 'coupon' }, 'coupon 优先级异常', 'server/marketing/marketing-attribution-service.js');
  if (ev2?.attributionType === 'assisted') pass('evidenceDetails 包含 order_002 assisted 归因');
  else fail('evidenceDetails 包含 order_002 assisted 归因', attribution.evidenceDetails, { relatedOrderId: 'order_002', attributionType: 'assisted' }, 'assisted 归因异常', 'server/marketing/marketing-attribution-service.js');
  if (!attribution.evidenceDetails.some(x => x.relatedOrderId === 'order_003')) pass('窗口外订单 order_003 未归因');
  else fail('窗口外订单 order_003 未归因', attribution.evidenceDetails, '不包含 order_003', '窗口过滤异常', 'server/marketing/marketing-attribution-service.js');
  if (!attribution.evidenceDetails.some(x => x.relatedOrderId === 'order_004')) pass('无 customerId 订单 order_004 未归因');
  else fail('无 customerId 订单 order_004 未归因', attribution.evidenceDetails, '不包含 order_004', 'customerId 保护失效', 'server/marketing/marketing-attribution-service.js');

  const fakePool = {
    query: async (_sql, params) => ({ rows: [{
      task_id: params[0],
      status: params[1],
      title: params[9],
      assignee_role: params[12],
      source_data: JSON.parse(params[11]),
    }] }),
  };
  const created = await createOntologyTaskFromDraft(fakePool, customer.taskDrafts[0], { reportType: 'customer_assets', storeId: 'test_store_ontology_001', tenantId: 'default' });
  if (created.createdTask?.source_data?.sourceIssueId && created.createdTask?.source_data?.sourceReportType === 'customer_assets') pass('taskDraft 成功转正式任务', { taskId: created.createdTask.task_id, sourceIssueId: created.createdTask.source_data.sourceIssueId });
  else fail('taskDraft 成功转正式任务', created, 'createdTask.source_data.sourceIssueId/sourceReportType', '任务适配器未保留来源字段', 'server/ontology/ontology-task-adapter.js');
}

async function api(path, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: res.status, json };
}

function dbPool() {
  return new Pool({ connectionString: DATABASE_URL });
}

async function tableExists(pool, table) {
  const r = await pool.query(`SELECT to_regclass($1) AS reg`, [`public.${table}`]);
  return !!r.rows?.[0]?.reg;
}

async function columnExists(pool, table, column) {
  const r = await pool.query(
    `SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 AND column_name=$2 LIMIT 1`,
    [table, column]
  );
  return !!r.rows?.length;
}

async function livePreflight(pool) {
  const requiredTables = [
    'master_tasks',
    'growth_delivery_logs',
    'marketing_campaigns',
    'marketing_campaign_results',
    'pos_orders',
    'customer_ops_source_records',
    'anomaly_triggers',
    'training_assignments',
    'training_sessions',
    'training_certifications',
    'agent_scores',
  ];
  const missing = [];
  for (const table of requiredTables) {
    if (!(await tableExists(pool, table))) missing.push(table);
  }
  const requiredColumns = [
    ['growth_delivery_logs', 'campaign_id'],
    ['growth_delivery_logs', 'coupon_id'],
    ['growth_delivery_logs', 'phone'],
    ['pos_orders', 'coupon_id'],
  ];
  const missingColumns = [];
  for (const [table, column] of requiredColumns) {
    if (missing.includes(table)) continue;
    if (!(await columnExists(pool, table, column))) missingColumns.push(`${table}.${column}`);
  }
  if (missing.length || missingColumns.length) {
    fail('真实数据库 preflight 表结构检查', { missingTables: missing, missingColumns }, '所有真实 HTTP E2E 依赖表和列存在', '空库 schema 未初始化。建议先启动修复后的服务，或运行 npm run migrate / migrations/099_ontology_e2e_acceptance_schema.sql', 'server/index.js / server/migrations/099_ontology_e2e_acceptance_schema.sql');
    return false;
  }
  pass('真实数据库 preflight 表结构检查', { tables: requiredTables.length, columns: requiredColumns.length });
  return true;
}

async function cleanupLiveSeed(pool) {
  const warnings = [];
  const queries = [
    [`DELETE FROM master_tasks WHERE tenant_id=$1 AND (store=$2 OR source_data->>'sourceReportType' IN ('customer_assets','ops_rectification','talent_growth')) AND source='ontology_business'`, [TENANT_ID, TEST_STORE_ID]],
    [`DELETE FROM customer_ops_source_records WHERE tenant_id=$1 AND record_key LIKE 'ontology_e2e:%'`, [TENANT_ID]],
    [`DELETE FROM growth_delivery_logs WHERE tenant_id=$1 AND (campaign_id=$2 OR rule_key=$2)`, [TENANT_ID, TEST_CAMPAIGN_ID]],
    [`DELETE FROM pos_orders WHERE tenant_id=$1 AND order_no IN ('order_001','order_002','order_003','order_004')`, [TENANT_ID]],
    [`DELETE FROM marketing_campaign_results WHERE tenant_id=$1 AND result_note='ontology_e2e'`, [TENANT_ID]],
    [`DELETE FROM marketing_campaigns WHERE tenant_id=$1 AND source='ontology_e2e'`, [TENANT_ID]],
    [`DELETE FROM anomaly_triggers WHERE tenant_id=$1 AND store=$2`, [TENANT_ID, TEST_STORE_ID]],
    [`DELETE FROM training_assignments WHERE tenant_id=$1 AND employee_username LIKE 'ontology_e2e_%'`, [TENANT_ID]],
    [`DELETE FROM training_sessions WHERE tenant_id=$1 AND employee_username LIKE 'ontology_e2e_%'`, [TENANT_ID]],
    [`DELETE FROM training_certifications WHERE tenant_id=$1 AND employee_username LIKE 'ontology_e2e_%'`, [TENANT_ID]],
    [`DELETE FROM agent_scores WHERE tenant_id=$1 AND username LIKE 'ontology_e2e_%'`, [TENANT_ID]],
  ];
  for (const [sql, params] of queries) {
    try { await pool.query(sql, params); } catch (e) { warnings.push(e.message); }
  }
  if (warnings.length) console.warn('WARNING cleanupLiveSeed:', warnings.join(' | '));
  else pass('真实数据库测试数据清理完成');
}

async function insertMetricFact(pool, reportType, period, metrics) {
  const key = `ontology_e2e:${reportType}:${period}`;
  await pool.query(
    `INSERT INTO customer_ops_source_records (tenant_id, diagnosis_id, source_filename, record_key, phone, member_no, record_kind, record_json)
     VALUES ($1, NULL, 'ontology-e2e', $2, '', '', 'report_metric_fact', $3::jsonb)
     ON CONFLICT (tenant_id, record_key) DO UPDATE SET record_json=EXCLUDED.record_json, created_at=NOW()`,
    [TENANT_ID, key, JSON.stringify({ reportType, period, storeId: TEST_STORE_ID, metrics })]
  );
}

async function seedLiveData(pool) {
  await cleanupLiveSeed(pool);

  await insertMetricFact(pool, 'customer_assets', 'current', {
    repeat_purchase_rate: 18,
    new_customer_second_visit_rate: 9,
    vip_inactive_count: 38,
    stored_value_inactive_count: 22,
  });
  await insertMetricFact(pool, 'customer_assets', 'previous', {
    repeat_purchase_rate: 25,
    new_customer_second_visit_rate: 16,
    vip_inactive_count: 21,
    stored_value_inactive_count: 12,
  });
  await insertMetricFact(pool, 'ops_rectification', 'current', {
    revenue: 85000,
    lunch_revenue: 21000,
    service_complaint_rate: 7,
    dish_complaint_rate: 5,
    task_overdue_rate: 18,
  });
  await insertMetricFact(pool, 'ops_rectification', 'previous', {
    revenue: 100000,
    lunch_revenue: 30000,
    service_complaint_rate: 3,
    dish_complaint_rate: 2,
    task_overdue_rate: 8,
  });
  await insertMetricFact(pool, 'talent_growth', 'current', {
    training_completion_rate: 61,
    certification_pass_rate: 54,
    promotion_candidate_count: 3,
  });
  await insertMetricFact(pool, 'talent_growth', 'previous', {
    training_completion_rate: 82,
    certification_pass_rate: 76,
    promotion_candidate_count: 8,
  });

  await pool.query(
    `INSERT INTO marketing_campaigns (tenant_id, title, channel, campaign_type, status, planned_date, planned_end_date, store_ids, target_audience, target_count, content, goal, source, created_by)
     VALUES ($1, 'ontology e2e campaign', 'sms', '客户维护', 'completed', '2026-07-01', '2026-07-08', $2::jsonb, 'ontology e2e', 4, 'ontology e2e', 'conversion', 'ontology_e2e', 'codex')
     RETURNING id`,
    [TENANT_ID, JSON.stringify([TEST_STORE_ID])]
  );
  await pool.query(
    `INSERT INTO marketing_campaign_results (tenant_id, campaign_id, store_id, store_name, actual_send_count, actual_reach_count, actual_conversion_count, actual_revenue, result_note)
     SELECT $1::varchar, id, $2::text, $2::text, 4, 4, 2, 1200, 'ontology_e2e'
       FROM marketing_campaigns WHERE tenant_id=$1::varchar AND source='ontology_e2e'
      ORDER BY id DESC LIMIT 1`,
    [TENANT_ID, TEST_STORE_ID]
  );
  const touches = [
    ['ontology_e2e_touch_001', 'customer_001', '10000000001', '2026-07-01T10:00:00+08:00', 'coupon_001', 'sms'],
    ['ontology_e2e_touch_002', 'customer_002', '10000000002', '2026-07-01T11:00:00+08:00', null, 'wecom'],
    ['ontology_e2e_touch_003', 'customer_003', '10000000003', '2026-07-01T12:00:00+08:00', 'coupon_003', 'sms'],
    ['ontology_e2e_touch_004', 'customer_004', '10000000004', '2026-07-01T13:00:00+08:00', null, 'sms'],
  ];
  for (const [deliveryKey, customerLabel, phone, touchTime, couponId, channel] of touches) {
    await pool.query(
      `INSERT INTO growth_delivery_logs (delivery_key, action_key, rule_key, campaign_id, customer_id, phone, store_id, channel, status, payload, coupon_id, created_at, updated_at, tenant_id)
       VALUES ($1,$2,$2,$2,NULL,$3,$4,$5,'sent',$6::jsonb,$7,$8::timestamptz,$8::timestamptz,$9)
       ON CONFLICT (delivery_key) DO UPDATE SET campaign_id=EXCLUDED.campaign_id, phone=EXCLUDED.phone, coupon_id=EXCLUDED.coupon_id, status='sent', created_at=EXCLUDED.created_at, updated_at=NOW()`,
      [deliveryKey, TEST_CAMPAIGN_ID, phone, TEST_STORE_ID, channel, JSON.stringify({ customerId: customerLabel, phone, coupon_id: couponId }), couponId, touchTime, TENANT_ID]
    );
  }
  const orders = [
    ['order_001', '10000000001', '2026-07-03', '2026-07-03T18:00:00+08:00', 680, 'coupon_001'],
    ['order_002', '10000000002', '2026-07-04', '2026-07-04T19:00:00+08:00', 520, null],
    ['order_003', '10000000003', '2026-07-12', '2026-07-12T19:00:00+08:00', 880, 'coupon_003'],
    ['order_004', '', '2026-07-04', '2026-07-04T19:30:00+08:00', 300, null],
  ];
  for (const [orderNo, phone, bizDate, orderTime, amount, couponId] of orders) {
    await pool.query(
      `INSERT INTO pos_orders (order_no, order_source, biz_date, order_time, order_status, amount_before_discount, total_discount, amount_after_discount, member_name, phone, store_id, store_name, coupon_id, tenant_id)
       VALUES ($1,'ontology_e2e',$2::date,$3::timestamptz,'已完成',$4,0,$4,'ontology e2e',$5,$6,$6,$7,$8)
       ON CONFLICT (order_no) DO UPDATE SET biz_date=EXCLUDED.biz_date, order_time=EXCLUDED.order_time, amount_after_discount=EXCLUDED.amount_after_discount, phone=EXCLUDED.phone, coupon_id=EXCLUDED.coupon_id, tenant_id=EXCLUDED.tenant_id`,
      [orderNo, bizDate, orderTime, amount, phone, TEST_STORE_ID, couponId, TENANT_ID]
    );
  }
  pass('真实数据库测试数据 seed 完成', { storeId: TEST_STORE_ID, campaignId: TEST_CAMPAIGN_ID });
}

function assertIssueIds(label, report, expected) {
  const actual = (report.ontologyInsights || []).map(x => x.issueId);
  const missing = expected.filter(x => !actual.includes(x));
  if (!missing.length && report.ontologyStatus === 'ok' && report.bossSummary && (report.taskDrafts || []).length) {
    pass(`${label} 真实报告生成非空 ontology 闭环`, { issues: actual, taskDrafts: report.taskDrafts.length });
  } else {
    fail(`${label} 真实报告生成非空 ontology 闭环`, { ontologyStatus: report.ontologyStatus, issues: actual, bossSummary: report.bossSummary, taskDrafts: report.taskDrafts?.length || 0 }, { expectedIssues: expected }, '真实报告 metricsInput 未命中预期问题或仍为 insufficient_data', 'server/customer-ops.js / server/ontology/report-metrics-adapters.js');
  }
}

async function runLiveApiSmoke() {
  const pool = dbPool();
  let seeded = false;
  try {
    if (!(await livePreflight(pool))) return;
    await seedLiveData(pool);
    seeded = true;

  const infer = await api('/api/ontology/business/infer', {
    method: 'POST',
    body: JSON.stringify({ metricsInput: { repeat_purchase_rate: { current: 18, previous: 25, changeRate: -28 }, vip_inactive_count: { current: 38, previous: 21, changeRate: 80 } } }),
  });
  if (infer.status < 300 && infer.json?.insights?.some(x => x.issueId === 'customer_retention_weak')) pass('真实 API ontology infer 返回 customer_retention_weak');
  else fail('真实 API ontology infer 返回 customer_retention_weak', infer, 'insights includes customer_retention_weak', '服务未启动、鉴权失败或路由异常', 'server/ontology/routes.js');

  const reports = [
    ['客户资产报告真实 API', `/api/customer-ops/reports/customer-assets?storeId=${TEST_STORE_ID}`, 'customer_assets', ['customer_retention_weak', 'vip_churn_risk', 'new_customer_activation_weak', 'stored_value_activation_weak']],
    ['经营整改追踪真实 API', `/api/customer-ops/reports/ops-rectification?storeId=${TEST_STORE_ID}`, 'ops_rectification', ['revenue_decline', 'lunch_business_weak', 'service_quality_issue', 'kitchen_quality_issue', 'task_closure_weak']],
    ['人才盘点真实 API', `/api/customer-ops/reports/talent-growth?storeId=${TEST_STORE_ID}`, 'talent_growth', ['training_execution_weak', 'skill_certification_weak', 'talent_pipeline_weak']],
  ];
  let firstTaskDraft = null;
  for (const [label, path, reportType, expectedIssues] of reports) {
    const r = await api(path);
    const report = r.json?.report || r.json;
    const hasOntologyFields = r.status < 300
      && Object.prototype.hasOwnProperty.call(report || {}, 'ontologyInsights')
      && Object.prototype.hasOwnProperty.call(report || {}, 'bossSummary')
      && Object.prototype.hasOwnProperty.call(report || {}, 'taskDrafts');
    if (hasOntologyFields) {
      pass(`${label} 返回 ontologyInsights/bossSummary/taskDrafts`, {
        ontologyStatus: report.ontologyStatus || 'missing_status',
        insights: Array.isArray(report.ontologyInsights) ? report.ontologyInsights.length : null,
        taskDrafts: Array.isArray(report.taskDrafts) ? report.taskDrafts.length : null,
      });
      if (!firstTaskDraft && Array.isArray(report.taskDrafts) && report.taskDrafts.length) {
        firstTaskDraft = { reportType, taskDraft: report.taskDrafts[0] };
      }
      assertIssueIds(label, report, expectedIssues);
    } else {
      fail(`${label} 返回 ontologyInsights/bossSummary/taskDrafts`, r, 'HTTP 2xx 且 report 包含 ontologyInsights、bossSummary、taskDrafts', '报告 API 未接入经营语义层或真实数据生成失败', 'server/customer-ops.js');
    }
  }

  if (!firstTaskDraft) {
    const draftSource = await api('/api/ontology/business/task-drafts', {
      method: 'POST',
      body: JSON.stringify({ insights: infer.json?.insights || [] }),
    });
    firstTaskDraft = {
      reportType: 'customer_assets',
      taskDraft: draftSource.json?.taskDrafts?.[0],
    };
  }

  if (firstTaskDraft?.taskDraft?.title) {
    const created = await api('/api/ontology/business/create-task-from-draft', {
      method: 'POST',
      body: JSON.stringify({
        taskDraft: firstTaskDraft.taskDraft,
        reportType: firstTaskDraft.reportType,
        storeId: TEST_STORE_ID,
        ownerUserId: 'admin',
      }),
    });
    const taskId = created.json?.createdTask?.task_id;
    const sourceData = created.json?.createdTask?.source_data || {};
    if (created.status < 300 && taskId && sourceData.sourceIssueId && Array.isArray(sourceData.trackingMetrics)) {
      pass('create-task-from-draft 创建正式任务并保留来源字段', { taskId, sourceIssueId: sourceData.sourceIssueId, trackingMetrics: sourceData.trackingMetrics.length });
      const detail = await api(`/api/master/tasks/${encodeURIComponent(taskId)}`);
      const detailSource = detail.json?.task?.source_data || {};
      if (detail.status < 300 && detail.json?.task?.task_id === taskId && detailSource.sourceIssueId === sourceData.sourceIssueId) {
        pass('master_tasks 可通过任务详情 API 读回新建 ontology 任务', { taskId, status: detail.json.task.status });
      } else {
        fail('master_tasks 可通过任务详情 API 读回新建 ontology 任务', detail, { task_id: taskId, sourceIssueId: sourceData.sourceIssueId }, '任务创建返回成功但任务系统读回失败，可能未真正写入 master_tasks 或租户不一致', 'server/ontology/ontology-task-adapter.js');
      }
    } else {
      fail('create-task-from-draft 创建正式任务并保留来源字段', created, 'HTTP 2xx 且 createdTask.task_id/source_data.sourceIssueId/trackingMetrics 存在', '任务创建 API 失败或来源字段未落库', 'server/ontology/routes.js');
    }
  } else {
    fail('create-task-from-draft 创建正式任务并保留来源字段', firstTaskDraft, '可用 taskDraft', '真实报告和 task-drafts API 都没有返回任务草稿', 'server/ontology/task-draft-adapter.js');
  }

  const attribution = await api(`/api/marketing/attribution/${TEST_CAMPAIGN_ID}?attributionWindowDays=7`);
  const summary = attribution.json?.attribution || {};
  const evidenceDetails = Array.isArray(summary.evidenceDetails) ? summary.evidenceDetails : [];
  const realRevenue = evidenceDetails
    .filter(x => x.relatedOrderId)
    .reduce((sum, x) => sum + Number(x.orderAmount || 0), 0);
  if (attribution.status < 300 && Array.isArray(summary.evidenceDetails)) {
    pass('marketing attribution 返回 evidenceDetails', { evidenceDetails: evidenceDetails.length, attributedRevenue: summary.attributedRevenue });
    const order001 = evidenceDetails.find(x => x.relatedOrderId === 'order_001');
    const order002 = evidenceDetails.find(x => x.relatedOrderId === 'order_002');
    const hasExcluded = evidenceDetails.some(x => x.relatedOrderId === 'order_003' || x.relatedOrderId === 'order_004');
    if (Number(summary.touchedCustomerCount) === 4
      && Number(summary.attributedOrderCount) === 2
      && Number(summary.attributedRevenue || 0) === 1200
      && realRevenue === 1200
      && order001?.attributionType === 'coupon'
      && order002?.attributionType === 'assisted'
      && !hasExcluded) {
      pass('marketing attributedRevenue 只来自真实 relatedOrderId', { attributedRevenue: summary.attributedRevenue, realEvidenceRevenue: realRevenue, order001: order001.attributionType, order002: order002.attributionType });
    } else {
      fail('marketing attributedRevenue 只来自真实 relatedOrderId', summary, { touchedCustomerCount: 4, attributedOrderCount: 2, attributedRevenue: 1200, order001: 'coupon', order002: 'assisted', excluded: ['order_003', 'order_004'] }, '营销归因结果与真实 seed 订单不一致', 'server/marketing/marketing-attribution-service.js');
    }
  } else {
    fail('marketing attribution 返回 evidenceDetails', attribution, 'HTTP 2xx 且 attribution.evidenceDetails 为数组', '营销归因 API 失败或未返回证据详情', 'server/marketing/marketing-attribution-routes.js');
  }
  } finally {
    if (seeded) await cleanupLiveSeed(pool);
    await pool.end().catch(() => {});
  }
}

if (BASE_URL) {
  console.log(`Running live API smoke against ${BASE_URL}`);
  await runLiveApiSmoke();
} else {
  console.log('Running local ontology business flow harness. Set E2E_BASE_URL and E2E_TOKEN to call a live server.');
  await runLocalHarness();
}

const failed = results.filter(r => !r.ok);
if (failed.length) {
  console.error(`\nE2E ontology business flow FAILED: ${failed.length}/${results.length}`);
  process.exit(1);
}
console.log(`\nE2E ontology business flow PASSED: ${results.length}/${results.length}`);
