#!/usr/bin/env node
import { Pool } from 'pg';
import { ensureBaselineSchemaHealth } from '../baseline-schema-health.js';
import { ensureGrowthOntologyCore } from '../ontology/growth-ontology-schema.js';

const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:3000';
const DATABASE_URL = process.env.E2E_DATABASE_URL || process.env.DATABASE_URL || 'postgres://hrms:Abc1234567!@127.0.0.1:5432/hrms';
const TENANT_ID = process.env.E2E_TENANT_ID || 'default';
const STORE_ID = 'ontology_second_visit_store_001';
const CAMPAIGN_ID = 'ontology_second_visit_campaign_001';
const pool = new Pool({ connectionString: DATABASE_URL });
const failures = [];

function isoDaysAgo(days, hour = 12) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

function today() {
  return new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
}

function check(name, condition, detail = {}) {
  if (condition) console.log(name);
  else {
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

async function token() {
  if (process.env.E2E_TOKEN) return process.env.E2E_TOKEN;
  const r = await fetch(`${BASE_URL}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123', tenant_id: TENANT_ID }),
  });
  const j = await r.json();
  if (!j.token) throw new Error('E2E_TOKEN required');
  return j.token;
}

async function cleanup() {
  const queries = [
    [`DELETE FROM growth_ontology_attributions WHERE tenant_id=$1 AND store_id=$2`, [TENANT_ID, STORE_ID]],
    [`DELETE FROM growth_ontology_business_results WHERE tenant_id=$1 AND store_id=$2`, [TENANT_ID, STORE_ID]],
    [`DELETE FROM master_tasks WHERE tenant_id=$1 AND (store_id=$2 OR store=$2)`, [TENANT_ID, STORE_ID]],
    [`DELETE FROM growth_ontology_opportunities WHERE tenant_id=$1 AND store_id=$2`, [TENANT_ID, STORE_ID]],
    [`DELETE FROM growth_ontology_issues WHERE tenant_id=$1 AND store_id=$2`, [TENANT_ID, STORE_ID]],
    [`DELETE FROM growth_ontology_touches WHERE tenant_id=$1 AND store_id=$2`, [TENANT_ID, STORE_ID]],
    [`DELETE FROM growth_ontology_campaigns WHERE tenant_id=$1 AND store_id=$2`, [TENANT_ID, STORE_ID]],
    [`DELETE FROM growth_ontology_orders WHERE tenant_id=$1 AND store_id=$2`, [TENANT_ID, STORE_ID]],
    [`DELETE FROM growth_ontology_customers WHERE tenant_id=$1 AND store_id=$2`, [TENANT_ID, STORE_ID]],
    [`DELETE FROM growth_ontology_stores WHERE tenant_id=$1 AND store_id=$2`, [TENANT_ID, STORE_ID]],
  ];
  for (const [sql, params] of queries) await pool.query(sql, params).catch(() => {});
}

async function seedBeforeDiagnosis() {
  await pool.query(
    `INSERT INTO growth_ontology_stores (store_id, tenant_id, name, city, business_type, status)
     VALUES ($1,$2,'E2E新客二次转化门店','上海','restaurant','active')`,
    [STORE_ID, TENANT_ID]
  );
  for (let i = 1; i <= 36; i++) {
    const id = `second_visit_new_${String(i).padStart(3, '0')}`;
    const tags = i <= 18 ? ['signature_dish'] : [];
    await pool.query(
      `INSERT INTO growth_ontology_customers (
        customer_id, tenant_id, store_id, phone, first_visit_at, last_visit_at,
        visit_count, total_spend, avg_spend, lifecycle_stage, tags, risk_level, value_level
      ) VALUES ($1,$2,$3,$4,$5,$5,1,$6,$6,'new',$7::jsonb,'medium','medium')`,
      [id, TENANT_ID, STORE_ID, `13780${String(i).padStart(6, '0')}`, isoDaysAgo(10, 12), 120 + i * 5, JSON.stringify(tags)]
    );
    await pool.query(
      `INSERT INTO growth_ontology_orders (order_id, tenant_id, store_id, customer_id, order_time, amount, discount_amount, actual_paid, pax, channel, source)
       VALUES ($1,$2,$3,$4,$5,$6,0,$6,2,'pos','first_visit')`,
      [`order_first_${id}`, TENANT_ID, STORE_ID, id, isoDaysAgo(10, 12), 120 + i * 5]
    );
  }
}

async function seedAfterTask() {
  await pool.query(
    `INSERT INTO growth_ontology_campaigns (campaign_id, tenant_id, store_id, name, target_segment, channel, offer_type, offer_cost_estimate, start_at, end_at, status)
     VALUES ($1,$2,$3,'新客二次到店邀请','new_customer_no_second_visit','wecom','30元券',180,now()-interval '1 day',now()+interval '14 days','active')`,
    [CAMPAIGN_ID, TENANT_ID, STORE_ID]
  );
  for (let i = 1; i <= 18; i++) {
    const customerId = `second_visit_new_${String(i).padStart(3, '0')}`;
    await pool.query(
      `INSERT INTO growth_ontology_touches (touch_id, tenant_id, store_id, customer_id, campaign_id, channel, content, coupon_id, sent_at, status)
       VALUES ($1,$2,$3,$4,$5,'wecom','新客二次到店邀请',$6,now()-interval '2 days','sent')`,
      [`touch_second_${i}`, TENANT_ID, STORE_ID, customerId, CAMPAIGN_ID, `coupon_second_${i}`]
    );
  }
  const amounts = [260, 310, 280, 340, 295];
  for (let i = 1; i <= amounts.length; i++) {
    const customerId = `second_visit_new_${String(i).padStart(3, '0')}`;
    await pool.query(
      `INSERT INTO growth_ontology_orders (order_id, tenant_id, store_id, customer_id, order_time, amount, discount_amount, actual_paid, pax, channel, source, coupon_id, campaign_id)
       VALUES ($1,$2,$3,$4,now()-($5::int * interval '8 hours'),$6,30,$6,2,'pos','e2e_second_visit',$7,$8)`,
      [`order_second_${i}`, TENANT_ID, STORE_ID, customerId, i, amounts[i - 1], `coupon_second_${i}`, CAMPAIGN_ID]
    );
  }
}

async function run() {
  const tk = await token();
  await ensureBaselineSchemaHealth(pool);
  await ensureGrowthOntologyCore(pool);
  await cleanup();
  await seedBeforeDiagnosis();

  const diagnosis = await api('/api/ontology/diagnosis/run', {
    method: 'POST',
    body: JSON.stringify({ tenant_id: TENANT_ID, store_id: STORE_ID, date: today() }),
  }, tk);
  check('New customer second visit diagnosis generated', diagnosis.issues?.some(i => i.issue_type === 'new_customer_no_second_visit'), diagnosis);
  const opp = diagnosis.opportunities?.find(o => o.opportunity_type === 'new_customer_second_visit');
  check('New customer second visit opportunity generated', !!opp, diagnosis.opportunities || []);

  const tasks = await api(`/api/ontology/opportunities/${encodeURIComponent(opp.opportunity_id)}/generate-tasks`, {
    method: 'POST',
    body: JSON.stringify({ tenant_id: TENANT_ID, store_id: STORE_ID, ownerUserId: 'admin' }),
  }, tk);
  check('New customer second visit task generated', tasks.tasks?.[0]?.action_type === 'invite_second_visit', tasks);

  await seedAfterTask();
  const tracked = await api('/api/ontology/results/track', {
    method: 'POST',
    body: JSON.stringify({ tenant_id: TENANT_ID, store_id: STORE_ID, opportunityId: opp.opportunity_id }),
  }, tk);
  check('New customer second visit results tracked', tracked.result?.result_type === 'new_customer_second_visit', tracked);

  const attr = await api('/api/ontology/attribution/run', {
    method: 'POST',
    body: JSON.stringify({ tenant_id: TENANT_ID, store_id: STORE_ID, campaignId: CAMPAIGN_ID, opportunityId: opp.opportunity_id, taskId: tasks.tasks[0].task_id, attributionWindowDays: 14, scenario: 'new_customer_second_visit' }),
  }, tk);
  check('New customer second visit attribution generated', attr.attribution?.attributedOrderCount === 5, attr);

  const report = await api(`/api/ontology/closed-loop-report?tenant_id=${encodeURIComponent(TENANT_ID)}&store_id=${encodeURIComponent(STORE_ID)}&period=30d`, {}, tk);
  const bossText = [report.boss_summary, report.actual_business_impact, ...(report.key_findings_for_owner || [])].join(' ');
  check('Boss language second visit report generated', /新客/.test(bossText) && !/\b(ontology|schema|entity)\b/i.test(bossText), report);

  await cleanup();
  if (failures.length) {
    console.error(JSON.stringify({ failures }, null, 2));
    process.exit(1);
  }
  console.log('E2E new customer second visit growth closed loop PASSED');
}

run().catch(async (e) => {
  console.error(e?.stack || e);
  await cleanup().catch(() => {});
  process.exit(1);
}).finally(async () => {
  await pool.end().catch(() => {});
});
