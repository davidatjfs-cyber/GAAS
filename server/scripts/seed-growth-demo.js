#!/usr/bin/env node
import pg from 'pg';
import { ensureBaselineSchemaHealth } from '../baseline-schema-health.js';
import { ensureGrowthOntologyCore } from '../ontology/growth-ontology-schema.js';
import { runDailyDiagnosis } from '../ontology/diagnosis-tree-service.js';
import { generateTasksForOpportunity } from '../ontology/action-plan-service.js';
import { trackGrowthResults } from '../ontology/result-tracking-service.js';
import { generateGrowthAttribution } from '../ontology/growth-attribution-service.js';
import { buildClosedLoopReport } from '../ontology/closed-loop-report-service.js';

const { Pool } = pg;
const DATABASE_URL = process.env.DATABASE_URL || 'postgres://hrms:Abc1234567!@127.0.0.1:5432/hrms';
const TENANT_ID = process.env.DEMO_TENANT_ID || 'demo_restaurant_group';
const TENANT_NAME = 'Demo 餐厅集团';
const STORE_ID = process.env.DEMO_STORE_ID || 'demo_hongchao_daning_jiuguang';
const STORE_NAME = '洪潮大宁久光店 Demo';
const CAMPAIGN_ID = 'demo_campaign_90_day_winback';

const pool = new Pool({ connectionString: DATABASE_URL });

function daysAgo(days, hour = 12) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

async function cleanup() {
  const queries = [
    [`DELETE FROM growth_ontology_attributions WHERE tenant_id=$1 AND store_id=$2`, [TENANT_ID, STORE_ID]],
    [`DELETE FROM growth_ontology_business_results WHERE tenant_id=$1 AND store_id=$2`, [TENANT_ID, STORE_ID]],
    [`DELETE FROM master_tasks WHERE tenant_id=$1 AND (store_id=$2 OR store=$2) AND source IN ('ontology_growth','ontology_business')`, [TENANT_ID, STORE_ID]],
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
  for (const [sql, params] of queries) await pool.query(sql, params);
}

async function seedTenant() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tenants (
      id BIGSERIAL PRIMARY KEY,
      tenant_id TEXT UNIQUE NOT NULL,
      name TEXT,
      mode TEXT DEFAULT 'managed',
      status TEXT DEFAULT 'active',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS licenses (
      id BIGSERIAL PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      status TEXT DEFAULT 'trial',
      expires_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )`);
  await pool.query(
    `INSERT INTO tenants (tenant_id, name, mode, status)
     VALUES ($1,$2,'managed','active')
     ON CONFLICT (tenant_id) DO UPDATE SET name=EXCLUDED.name, status='active', updated_at=now()`,
    [TENANT_ID, TENANT_NAME]
  );
  await pool.query(
    `INSERT INTO licenses (tenant_id, status, expires_at)
     VALUES ($1,'trial',now()+interval '180 days')`,
    [TENANT_ID]
  );
}

async function seedCoreData() {
  await pool.query(
    `INSERT INTO growth_ontology_stores (store_id, tenant_id, name, city, business_type, status)
     VALUES ($1,$2,$3,'上海','restaurant','active')`,
    [STORE_ID, TENANT_ID, STORE_NAME]
  );
  await pool.query(
    `INSERT INTO growth_ontology_employees (employee_id, tenant_id, store_id, name, role, status, skill_level, performance_score)
     VALUES ('demo_store_manager_001',$1,$2,'Demo 店长','store_manager','active','senior',86)`,
    [TENANT_ID, STORE_ID]
  );

  const customers = [];
  for (let i = 1; i <= 128; i++) {
    const repeat = i <= 42;
    const days = 90 + (i % 90);
    customers.push({
      id: `demo_dormant_${String(i).padStart(3, '0')}`,
      phone: `13990${String(i).padStart(6, '0')}`,
      first: daysAgo(days + 60),
      last: daysAgo(days),
      visits: repeat ? 2 + (i % 3) : 1,
      spend: repeat ? 380 + (i % 8) * 90 : 120 + (i % 5) * 50,
      stage: days > 180 ? 'deep_dormant' : 'dormant',
      risk: 'sleeping',
      value: repeat ? 'high' : 'medium',
      tags: repeat ? ['dormant_90_180', 'repeat_customer'] : ['dormant_90_180'],
    });
  }
  const extraGroups = [
    ['vip', 18, 'active', 'high'],
    ['stored_value', 20, 'active', 'high'],
    ['new', 36, 'new', 'medium'],
    ['active', 45, 'active', 'medium'],
    ['deep_sleeping', 24, 'sleeping', 'low'],
  ];
  for (const [prefix, count, stage, value] of extraGroups) {
    for (let i = 1; i <= count; i++) {
      customers.push({
        id: `demo_${prefix}_${String(i).padStart(3, '0')}`,
        phone: `138${String(extraGroups.indexOf(extraGroups.find(g => g[0] === prefix)) + 1)}${String(i).padStart(8, '0')}`,
        first: daysAgo(stage === 'new' ? 10 : 30 + i),
        last: daysAgo(stage === 'new' ? 10 : 3 + (i % 20)),
        visits: stage === 'new' ? 1 : 2 + (i % 5),
        spend: value === 'high' ? 1200 + i * 20 : 180 + i * 15,
        stage,
        risk: stage === 'sleeping' ? 'sleeping' : 'medium',
        value,
        tags: [prefix],
      });
    }
  }

  for (const c of customers) {
    await pool.query(
      `INSERT INTO growth_ontology_customers (
        customer_id, tenant_id, store_id, phone, first_visit_at, last_visit_at, visit_count,
        total_spend, avg_spend, lifecycle_stage, tags, risk_level, value_level
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13)`,
      [c.id, TENANT_ID, STORE_ID, c.phone, c.first, c.last, c.visits, c.spend, c.spend / Math.max(c.visits, 1), c.stage, JSON.stringify(c.tags), c.risk, c.value]
    );
  }

  for (const c of customers.filter(c => c.id.startsWith('demo_dormant_') && c.visits >= 2).slice(0, 42)) {
    for (let i = 0; i < c.visits; i++) {
      await pool.query(
        `INSERT INTO growth_ontology_orders (order_id, tenant_id, store_id, customer_id, order_time, amount, discount_amount, actual_paid, pax, channel, source)
         VALUES ($1,$2,$3,$4,$5,$6,0,$6,2,'pos','history')`,
        [`order_${c.id}_${i + 1}`, TENANT_ID, STORE_ID, c.id, daysAgo(150 - i * 15, 19), Math.round(c.spend / c.visits)]
      );
    }
  }

  await pool.query(
    `INSERT INTO growth_ontology_campaigns (campaign_id, tenant_id, store_id, name, target_segment, channel, offer_type, offer_cost_estimate, start_at, end_at, status)
     VALUES ($1,$2,$3,'90 天老客专属唤醒','90_180_day_dormant','sms_wecom','30元券',420,now()-interval '14 days',now()+interval '14 days','active')`,
    [CAMPAIGN_ID, TENANT_ID, STORE_ID]
  );
  await pool.query(
    `INSERT INTO growth_ontology_benefits (benefit_id, tenant_id, store_id, campaign_id, name, type, face_value, cost_estimate, valid_from, valid_to, status)
     VALUES ('demo_benefit_30_coupon',$1,$2,$3,'30 元老客回店券','coupon',30,70,now()-interval '14 days',now()+interval '14 days','active')`,
    [TENANT_ID, STORE_ID, CAMPAIGN_ID]
  );

  const touched = customers.filter(c => c.id.startsWith('demo_dormant_') && c.visits >= 2).slice(0, 42);
  for (const [idx, c] of touched.entries()) {
    await pool.query(
      `INSERT INTO growth_ontology_touches (touch_id, tenant_id, store_id, customer_id, campaign_id, channel, content, coupon_id, sent_at, status)
       VALUES ($1,$2,$3,$4,$5,$6,'90 天老客专属唤醒：回店赠招牌菜或 30 元券',$7,now()-interval '12 days','sent')`,
      [`touch_demo_winback_${idx + 1}`, TENANT_ID, STORE_ID, c.id, CAMPAIGN_ID, idx % 2 ? 'wecom' : 'sms', `demo_coupon_${idx + 1}`]
    );
  }
  const returned = touched.slice(0, 6);
  const amounts = [580, 420, 690, 510, 460, 600];
  for (const [idx, c] of returned.entries()) {
    await pool.query(
      `INSERT INTO growth_ontology_orders (order_id, tenant_id, store_id, customer_id, order_time, amount, discount_amount, actual_paid, pax, channel, source, coupon_id, campaign_id)
       VALUES ($1,$2,$3,$4,now()-($5::int * interval '1 day'),$6,70,$6,2,'pos','demo_winback',$7,$8)`,
      [`order_demo_winback_${idx + 1}`, TENANT_ID, STORE_ID, c.id, idx + 1, amounts[idx], `demo_coupon_${idx + 1}`, CAMPAIGN_ID]
    );
  }
}

async function runServices() {
  const diagnosis = await runDailyDiagnosis(pool, { tenantId: TENANT_ID, storeId: STORE_ID, date: new Date().toISOString().slice(0, 10) });
  const opportunity = diagnosis.opportunities.find(o => o.opportunity_type === 'dormant_customer_reactivation') || diagnosis.opportunities[0];
  if (!opportunity) throw new Error('demo_opportunity_not_generated');
  const tasks = await generateTasksForOpportunity(pool, opportunity.opportunity_id, { tenantId: TENANT_ID, storeId: STORE_ID, ownerUserId: 'demo_manager' });
  const taskIds = (tasks.tasks || []).map(t => t.task_id);
  for (const taskId of taskIds.slice(0, Math.max(1, taskIds.length - 2))) {
    await pool.query(
      `UPDATE master_tasks SET status='completed', actual_result='已完成老客唤醒触达', completed_at=now()
        WHERE task_id=$1 AND tenant_id=$2`,
      [taskId, TENANT_ID]
    );
  }
  await trackGrowthResults(pool, { tenantId: TENANT_ID, storeId: STORE_ID, opportunityId: opportunity.opportunity_id, beforeDays: 14, afterDays: 14 });
  await generateGrowthAttribution(pool, {
    tenantId: TENANT_ID,
    storeId: STORE_ID,
    campaignId: CAMPAIGN_ID,
    opportunityId: opportunity.opportunity_id,
    taskId: taskIds[0] || '',
    attributionWindowDays: 14,
  });
  return buildClosedLoopReport(pool, {
    tenantId: TENANT_ID,
    storeId: STORE_ID,
    period: '30d',
    preferredScenario: 'dormant_customer_reactivation',
  });
}

async function main() {
  await ensureBaselineSchemaHealth(pool);
  await ensureGrowthOntologyCore(pool);
  await seedTenant();
  await cleanup();
  await seedCoreData();
  const report = await runServices();
  console.log(JSON.stringify({
    ok: true,
    demoTenant: { tenant_id: TENANT_ID, name: TENANT_NAME },
    demoStore: { store_id: STORE_ID, name: STORE_NAME },
    campaign: CAMPAIGN_ID,
    expected: {
      touchedCustomers: 42,
      returnedCustomers: 6,
      attributedRevenue: 3260,
      offerCost: 420,
      netUplift: 2840,
    },
    report: {
      boss_summary: report.boss_summary,
      attributedRevenue: report.attributionSummary?.attributedRevenue,
      taskReview: report.taskReview,
    },
    frontend: `http://localhost:3000/working-fixed.html`,
    login: { tenant_id: TENANT_ID, username: 'admin', password: 'admin123' },
  }, null, 2));
}

main().catch((e) => {
  console.error(e?.stack || e);
  process.exit(1);
}).finally(async () => {
  await pool.end().catch(() => {});
});
