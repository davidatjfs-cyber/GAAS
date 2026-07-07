#!/usr/bin/env node
import { Pool } from 'pg';
import { ensureGrowthOntologyCore } from '../ontology/growth-ontology-schema.js';

const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:3000';
const DATABASE_URL = process.env.E2E_DATABASE_URL || process.env.DATABASE_URL || 'postgres://hrms:Abc1234567!@127.0.0.1:5432/hrms';
const TENANT_ID = process.env.E2E_TENANT_ID || 'default';
const STORE_ID = process.env.E2E_STORE_ID || 'ontology_growth_store_001';
const CAMPAIGN_ID = process.env.E2E_CAMPAIGN_ID || 'ontology_growth_campaign_001';
const TOKEN_FROM_ENV = process.env.E2E_TOKEN || '';

const pool = new Pool({ connectionString: DATABASE_URL });
const failures = [];

function todayLocal() {
  const now = new Date();
  const local = new Date(now.getTime() + 8 * 3600000);
  return local.toISOString().slice(0, 10);
}

function addDays(date, days) {
  const d = new Date(`${date}T00:00:00+08:00`);
  d.setDate(d.getDate() + days);
  const local = new Date(d.getTime() + 8 * 3600000);
  return local.toISOString().slice(0, 10);
}

function assertOk(name, condition, detail = {}) {
  if (!condition) {
    failures.push({ name, detail });
    console.log(`FAIL ${name}`, JSON.stringify(detail).slice(0, 1200));
    return;
  }
  console.log(name);
}

async function api(path, options = {}, token) {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!res.ok) {
    throw new Error(`${options.method || 'GET'} ${path} failed ${res.status}: ${JSON.stringify(json).slice(0, 1000)}`);
  }
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
    [`DELETE FROM growth_ontology_attributions WHERE tenant_id=$1 AND store_id=$2`, [TENANT_ID, STORE_ID]],
    [`DELETE FROM growth_ontology_business_results WHERE tenant_id=$1 AND store_id=$2`, [TENANT_ID, STORE_ID]],
    [`DELETE FROM master_tasks WHERE tenant_id=$1 AND (store_id=$2 OR store=$2 OR opportunity_id IN (SELECT opportunity_id FROM growth_ontology_opportunities WHERE tenant_id=$1 AND store_id=$2))`, [TENANT_ID, STORE_ID]],
    [`DELETE FROM growth_ontology_opportunities WHERE tenant_id=$1 AND store_id=$2`, [TENANT_ID, STORE_ID]],
    [`DELETE FROM growth_ontology_issues WHERE tenant_id=$1 AND store_id=$2`, [TENANT_ID, STORE_ID]],
    [`DELETE FROM growth_ontology_touches WHERE tenant_id=$1 AND store_id=$2`, [TENANT_ID, STORE_ID]],
    [`DELETE FROM growth_ontology_benefits WHERE tenant_id=$1 AND store_id=$2`, [TENANT_ID, STORE_ID]],
    [`DELETE FROM growth_ontology_campaigns WHERE tenant_id=$1 AND store_id=$2`, [TENANT_ID, STORE_ID]],
    [`DELETE FROM growth_ontology_orders WHERE tenant_id=$1 AND store_id=$2`, [TENANT_ID, STORE_ID]],
    [`DELETE FROM growth_ontology_customers WHERE tenant_id=$1 AND store_id=$2`, [TENANT_ID, STORE_ID]],
    [`DELETE FROM growth_ontology_employees WHERE tenant_id=$1 AND store_id=$2`, [TENANT_ID, STORE_ID]],
    [`DELETE FROM growth_ontology_stores WHERE tenant_id=$1 AND store_id=$2`, [TENANT_ID, STORE_ID]],
  ];
  for (const [sql, params] of queries) await pool.query(sql, params).catch(() => {});
}

async function seed() {
  const date = todayLocal();
  const prevDate = addDays(date, -7);
  await pool.query(
    `INSERT INTO growth_ontology_stores (store_id, tenant_id, name, city, business_type, status)
     VALUES ($1,$2,'E2E增长门店','上海','restaurant','active')
     ON CONFLICT (store_id) DO UPDATE SET updated_at=now()`,
    [STORE_ID, TENANT_ID]
  );
  const customers = [
    ['cust_growth_001', '13800000001', 1, 600, 'dormant', 'high'],
    ['cust_growth_002', '13800000002', 1, 400, 'active', 'medium'],
    ['cust_growth_003', '13800000003', 1, 0, 'sleeping', 'low'],
    ['cust_growth_004', '13800000004', 3, 1800, 'active', 'high'],
  ];
  for (const c of customers) {
    await pool.query(
      `INSERT INTO growth_ontology_customers (
        customer_id, tenant_id, store_id, phone, first_visit_at, last_visit_at, visit_count,
        total_spend, avg_spend, lifecycle_stage, tags, risk_level, value_level
      ) VALUES ($1,$2,$3,$4,now()-interval '60 days',now()-interval '20 days',$5,$6,$7,$8,'[]'::jsonb,$9,$10)
      ON CONFLICT (customer_id) DO UPDATE SET updated_at=now()`,
      [c[0], TENANT_ID, STORE_ID, c[1], c[2], c[3], c[2] ? c[3] / c[2] : 0, c[4], c[4] === 'dormant' ? 'high' : 'medium', c[5]]
    );
  }
  await pool.query(
    `INSERT INTO growth_ontology_campaigns (campaign_id, tenant_id, store_id, name, target_segment, channel, offer_type, offer_cost_estimate, start_at, end_at, status)
     VALUES ($1,$2,$3,'E2E沉睡客户唤醒','dormant','wecom','coupon',80,now()-interval '1 day',now()+interval '6 days','active')
     ON CONFLICT (campaign_id) DO UPDATE SET updated_at=now()`,
    [CAMPAIGN_ID, TENANT_ID, STORE_ID]
  );
  await pool.query(
    `INSERT INTO growth_ontology_benefits (benefit_id, tenant_id, store_id, campaign_id, name, type, face_value, cost_estimate, valid_from, valid_to, status)
     VALUES ('benefit_growth_001',$1,$2,$3,'满减券','coupon',50,20,now()-interval '1 day',now()+interval '6 days','active')
     ON CONFLICT (benefit_id) DO UPDATE SET updated_at=now()`,
    [TENANT_ID, STORE_ID, CAMPAIGN_ID]
  );
  const touches = [
    ['touch_growth_001', 'cust_growth_001', 'coupon_growth_001'],
    ['touch_growth_002', 'cust_growth_002', null],
    ['touch_growth_003', 'cust_growth_003', 'coupon_growth_003'],
    ['touch_growth_004', 'cust_growth_004', null],
  ];
  for (const t of touches) {
    await pool.query(
      `INSERT INTO growth_ontology_touches (touch_id, tenant_id, store_id, customer_id, campaign_id, channel, content, coupon_id, sent_at, status)
       VALUES ($1,$2,$3,$4,$5,'wecom','E2E客户维护触达',$6,now()-interval '1 day','sent')
       ON CONFLICT (touch_id) DO UPDATE SET updated_at=now()`,
      [t[0], TENANT_ID, STORE_ID, t[1], CAMPAIGN_ID, t[2]]
    );
  }
  const orders = [
    ['order_growth_prev_001', 'cust_growth_004', `${prevDate}T12:00:00+08:00`, 2600, null, null],
    ['order_growth_prev_002', 'cust_growth_004', `${prevDate}T19:00:00+08:00`, 2400, null, null],
    ['order_growth_cur_001', 'cust_growth_001', `${date}T12:00:00+08:00`, 600, 'coupon_growth_001', CAMPAIGN_ID],
    ['order_growth_cur_002', 'cust_growth_002', `${date}T13:00:00+08:00`, 400, null, null],
    ['order_growth_cur_003', 'cust_growth_004', `${addDays(date, -20)}T20:00:00+08:00`, 900, null, null],
  ];
  for (const o of orders) {
    await pool.query(
      `INSERT INTO growth_ontology_orders (order_id, tenant_id, store_id, customer_id, order_time, amount, discount_amount, actual_paid, pax, channel, source, coupon_id, campaign_id)
       VALUES ($1,$2,$3,$4,$5,$6,0,$6,2,'pos','e2e',$7,$8)
       ON CONFLICT (order_id) DO UPDATE SET updated_at=now()`,
      [o[0], TENANT_ID, STORE_ID, o[1], o[2], o[3], o[4], o[5]]
    );
  }
  await pool.query(
    `INSERT INTO growth_ontology_employees (employee_id, tenant_id, store_id, name, role, status, skill_level, performance_score)
     VALUES ('emp_growth_001',$1,$2,'E2E店长','store_manager','active','mid',62)
     ON CONFLICT (employee_id) DO UPDATE SET updated_at=now()`,
    [TENANT_ID, STORE_ID]
  );
}

async function run() {
  const token = await getToken();
  await ensureGrowthOntologyCore(pool);
  await cleanup();
  await seed();

  const date = todayLocal();
  const diagnosis = await api('/api/ontology/diagnosis/run', {
    method: 'POST',
    body: JSON.stringify({ tenant_id: TENANT_ID, store_id: STORE_ID, date }),
  }, token);
  assertOk('Daily diagnosis generated', diagnosis.ok && Array.isArray(diagnosis.issues) && diagnosis.issues.length > 0, diagnosis);
  assertOk('Issues generated', diagnosis.issues?.some(x => x.issue_type === 'revenue_decline'), diagnosis.issues || []);
  assertOk('Opportunities generated', Array.isArray(diagnosis.opportunities) && diagnosis.opportunities.length > 0, diagnosis.opportunities || []);

  const issues = await api(`/api/ontology/issues?tenant_id=${encodeURIComponent(TENANT_ID)}&store_id=${encodeURIComponent(STORE_ID)}`, {}, token);
  const opportunities = await api(`/api/ontology/opportunities?tenant_id=${encodeURIComponent(TENANT_ID)}&store_id=${encodeURIComponent(STORE_ID)}`, {}, token);
  const firstOpp = opportunities.opportunities?.[0] || diagnosis.opportunities?.[0];
  assertOk('GET issues/opportunities API verified', issues.issues?.length > 0 && firstOpp?.opportunity_id, { issues, opportunities });

  const tasks = await api(`/api/ontology/opportunities/${encodeURIComponent(firstOpp.opportunity_id)}/generate-tasks`, {
    method: 'POST',
    body: JSON.stringify({ tenant_id: TENANT_ID, store_id: STORE_ID, ownerUserId: 'admin' }),
  }, token);
  assertOk('Tasks generated', tasks.tasks?.length > 0 && tasks.tasks[0].opportunity_id === firstOpp.opportunity_id, tasks);

  const taskCheck = await pool.query(`SELECT count(*)::int AS c FROM master_tasks WHERE tenant_id=$1 AND store_id=$2 AND opportunity_id=$3`, [TENANT_ID, STORE_ID, firstOpp.opportunity_id]);
  assertOk('master_tasks write verified', Number(taskCheck.rows[0]?.c || 0) > 0, taskCheck.rows[0]);

  const tracked = await api('/api/ontology/results/track', {
    method: 'POST',
    body: JSON.stringify({ tenant_id: TENANT_ID, store_id: STORE_ID, opportunityId: firstOpp.opportunity_id }),
  }, token);
  assertOk('Results tracked', tracked.result?.result_id, tracked);

  const attribution = await api('/api/ontology/attribution/run', {
    method: 'POST',
    body: JSON.stringify({ tenant_id: TENANT_ID, store_id: STORE_ID, campaignId: CAMPAIGN_ID, opportunityId: firstOpp.opportunity_id, taskId: tasks.tasks[0].task_id, attributionWindowDays: 7 }),
  }, token);
  const evidence = attribution.attribution?.evidenceDetails || [];
  const trueRevenue = evidence.filter(e => e.relatedOrderId).reduce((sum, e) => sum + Number(e.orderAmount || 0), 0);
  assertOk('Attribution generated', attribution.attribution?.attributedOrderCount === 2 && attribution.attribution?.attributedRevenue === trueRevenue && trueRevenue === 1000, attribution);

  const report = await api(`/api/ontology/closed-loop-report?tenant_id=${encodeURIComponent(TENANT_ID)}&store_id=${encodeURIComponent(STORE_ID)}&period=30d`, {}, token);
  assertOk('Closed loop report generated', report.ok && report.ontologyStatus === 'ok' && report.boss_summary && report.attributionSummary?.attributedRevenue === 1000, report);
  const bossText = [report.boss_title, report.boss_summary, ...(report.key_findings_for_owner || []), ...(report.next_actions_for_owner || [])].join(' ');
  assertOk('Boss language output verified', !/\b(ontology|metric|schema|json|sql|api|id)\b|指标ID|技术字段/i.test(bossText), { bossText });

  await cleanup();
  if (failures.length) {
    console.error(JSON.stringify({ failures }, null, 2));
    process.exit(1);
  }
  console.log('E2E ontology growth closed loop PASSED');
}

run().catch(async (e) => {
  console.error(e?.stack || e);
  await cleanup().catch(() => {});
  process.exit(1);
}).finally(async () => {
  await pool.end().catch(() => {});
});
