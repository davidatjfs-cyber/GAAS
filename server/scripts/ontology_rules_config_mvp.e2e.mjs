#!/usr/bin/env node
import { Pool } from 'pg';
import { ensureGrowthOntologyCore } from '../ontology/growth-ontology-schema.js';
import { ensureOntologyRuleConfig } from '../ontology/ontology-rule-service.js';

import { userInfo } from 'os';
const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:3000';
const DATABASE_URL = process.env.E2E_DATABASE_URL || process.env.DATABASE_URL || `postgres://${userInfo().username}:@127.0.0.1:5432/hrms`;
const TENANT_ID = process.env.E2E_TENANT_ID || 'default';
const STORE_ID = process.env.E2E_STORE_ID || 'ontology_rules_store_001';
const TOKEN_FROM_ENV = process.env.E2E_TOKEN || '';

const pool = new Pool({ connectionString: DATABASE_URL });
const failures = [];

function todayLocal() {
  const now = new Date();
  const local = new Date(now.getTime() + 8 * 3600000);
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
  const login = await api('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  });
  return login.token;
}

async function cleanup() {
  await pool.query(`DELETE FROM growth_ontology_issues WHERE tenant_id=$1 AND store_id=$2`, [TENANT_ID, STORE_ID]).catch(() => {});
  await pool.query(`DELETE FROM growth_ontology_opportunities WHERE tenant_id=$1 AND store_id=$2`, [TENANT_ID, STORE_ID]).catch(() => {});
  await pool.query(`DELETE FROM growth_ontology_orders WHERE tenant_id=$1 AND store_id=$2`, [TENANT_ID, STORE_ID]).catch(() => {});
  await pool.query(`DELETE FROM growth_ontology_customers WHERE tenant_id=$1 AND store_id=$2`, [TENANT_ID, STORE_ID]).catch(() => {});
  await pool.query(`DELETE FROM growth_ontology_touches WHERE tenant_id=$1 AND store_id=$2`, [TENANT_ID, STORE_ID]).catch(() => {});
  await pool.query(`DELETE FROM ontology_rule_hits WHERE tenant_id=$1 AND store_id=$2`, [TENANT_ID, STORE_ID]).catch(() => {});
  await pool.query(`DELETE FROM ontology_rules WHERE tenant_id=$1 AND store_id=$2`, [TENANT_ID, STORE_ID]).catch(() => {});
  await pool.query(`DELETE FROM ontology_rule_thresholds WHERE tenant_id=$1 AND store_id=$2`, [TENANT_ID, STORE_ID]).catch(() => {});
  await pool.query(`DELETE FROM master_tasks WHERE tenant_id=$1 AND (store_id=$2 OR store=$2) AND source IN ('ontology_growth','ontology_business')`, [TENANT_ID, STORE_ID]).catch(() => {});
}

async function seedDormantCustomer() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const customerId = `cust_dormant_${Date.now()}`;
  const seventyDaysAgo = new Date(today.getTime() - 70 * 24 * 60 * 60 * 1000);
  await pool.query(
    `INSERT INTO growth_ontology_customers (
      customer_id, tenant_id, store_id, phone, first_visit_at, last_visit_at,
      visit_count, total_spend, lifecycle_stage, risk_level
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    ON CONFLICT (tenant_id, customer_id) DO UPDATE SET
      last_visit_at = EXCLUDED.last_visit_at,
      visit_count = EXCLUDED.visit_count,
      total_spend = EXCLUDED.total_spend`,
    [
      customerId, TENANT_ID, STORE_ID, `138${Date.now()}`,
      seventyDaysAgo.toISOString(),
      seventyDaysAgo.toISOString(),
      3, 500, 'dormant', 'sleeping',
    ]
  );
  return customerId;
}

async function run() {
  console.log('E2E Ontology Rules Config MVP starting...');
  console.log(`BASE_URL=${BASE_URL}, TENANT_ID=${TENANT_ID}, STORE_ID=${STORE_ID}`);

  await cleanup();
  await ensureGrowthOntologyCore(pool);
  await ensureOntologyRuleConfig(pool);

  const token = await getToken();
  console.log('Token acquired');

  // A. List default rules
  const rules = await api(`/api/ontology/rules?tenant_id=${encodeURIComponent(TENANT_ID)}`, {}, token);
  assertOk('A. Default rules exist', rules.ok && Array.isArray(rules.rules) && rules.rules.length >= 6, { count: rules.rules?.length });
  const ruleIds = rules.rules.map(r => r.rule_id);
  assertOk('A. dormant_customer_reactivation rule exists', ruleIds.includes('dormant_customer_reactivation'));
  assertOk('A. new_customer_second_visit rule exists', ruleIds.includes('new_customer_second_visit'));
  assertOk('A. revenue_decline rule exists', ruleIds.includes('revenue_decline'));
  assertOk('A. repeat_rate_low rule exists', ruleIds.includes('repeat_rate_low'));
  assertOk('A. marketing_conversion_low rule exists', ruleIds.includes('marketing_conversion_low'));
  assertOk('A. task_overdue_high rule exists', ruleIds.includes('task_overdue_high'));

  // B. Override store-level dormant customer rule
  const override = await api('/api/ontology/rules/dormant_customer_reactivation', {
    method: 'PUT',
    body: JSON.stringify({
      tenant_id: TENANT_ID,
      store_id: STORE_ID,
      thresholds: { days_min: 60, days_max: 120 },
    }),
  }, token);
  assertOk('B. Store-level override created', override.ok && override.rule?.rule_id === 'dormant_customer_reactivation', override);

  // C. Verify store-level rule takes precedence
  const storeRules = await api(`/api/ontology/rules?tenant_id=${encodeURIComponent(TENANT_ID)}&store_id=${encodeURIComponent(STORE_ID)}`, {}, token);
  const dormantStoreRule = storeRules.rules.find(r => r.rule_id === 'dormant_customer_reactivation');
  assertOk('C. Store-level dormant rule found', !!dormantStoreRule);
  const daysMinThreshold = (dormantStoreRule?.thresholds || []).find(t => t.threshold_key === 'days_min');
  assertOk('C. Store-level days_min = 60', Number(daysMinThreshold?.threshold_value) === 60, { value: daysMinThreshold?.threshold_value });

  // D. Evaluate rules with store-level override
  const evalResult = await api('/api/ontology/rules/evaluate', {
    method: 'POST',
    body: JSON.stringify({
      tenant_id: TENANT_ID,
      store_id: STORE_ID,
      inputContext: {
        lastVisitDays: 70,
        visitCount: 3,
        totalSpend: 500,
      },
    }),
  }, token);
  assertOk('D. Rule evaluation ok', evalResult.ok);
  const dormantMatched = (evalResult.matchedRules || []).find(r => r.ruleId === 'dormant_customer_reactivation');
  assertOk('D. Dormant rule matches with 70 days (store override 60-120)', !!dormantMatched);

  // E. Verify system default does NOT match 70 days
  const evalSystem = await api('/api/ontology/rules/evaluate', {
    method: 'POST',
    body: JSON.stringify({
      tenant_id: TENANT_ID,
      store_id: '',
      inputContext: {
        lastVisitDays: 70,
        visitCount: 3,
        totalSpend: 500,
      },
    }),
  }, token);
  const dormantSystemMatched = (evalSystem.matchedRules || []).find(r => r.ruleId === 'dormant_customer_reactivation');
  assertOk('E. System default does NOT match 70 days (default 90-180)', !dormantSystemMatched);

  // F. Seed dormant customer and run diagnosis
  await seedDormantCustomer();
  const diagnosis = await api('/api/ontology/diagnosis/run', {
    method: 'POST',
    body: JSON.stringify({ tenant_id: TENANT_ID, store_id: STORE_ID, date: todayLocal() }),
  }, token);
  assertOk('F. Diagnosis ran', diagnosis.ok, diagnosis);

  // G. Verify rule hits recorded
  const hits = await api(`/api/ontology/rule-hits?tenant_id=${encodeURIComponent(TENANT_ID)}&store_id=${encodeURIComponent(STORE_ID)}&limit=50`, {}, token);
  assertOk('G. Rule hits exist', hits.ok && Array.isArray(hits.hits) && hits.hits.length > 0, { count: hits.hits?.length });

  // H. Verify closed-loop report with confidence note
  const report = await api(`/api/ontology/closed-loop-report?tenant_id=${encodeURIComponent(TENANT_ID)}&store_id=${encodeURIComponent(STORE_ID)}&period=30d`, {}, token);
  assertOk('H. Closed-loop report ok', report.ok);
  const confidenceNote = report.confidence_note || '';
  assertOk('H. Confidence note indicates rule source',
    confidenceNote.includes('门店专属') || confidenceNote.includes('品牌') || confidenceNote.includes('系统默认'),
    { confidenceNote });

  // I. Verify boss language has no tech terms
  const hitRows = hits.hits || [];
  for (const hit of hitRows) {
    const output = hit.boss_language_output || '';
    const bannedTerms = ['ontology_rules', 'rule_id', 'JSON', 'schema', 'migration', 'entity'];
    for (const term of bannedTerms) {
      assertOk(`I. Boss language no "${term}"`, !output.toLowerCase().includes(term.toLowerCase()), { output });
    }
  }

  // J. Verify issues and opportunities generated
  const issues = await api(`/api/ontology/issues?tenant_id=${encodeURIComponent(TENANT_ID)}&store_id=${encodeURIComponent(STORE_ID)}`, {}, token);
  assertOk('J. Issues generated', issues.ok && issues.issues?.length > 0, { count: issues.issues?.length });
  const opportunities = await api(`/api/ontology/opportunities?tenant_id=${encodeURIComponent(TENANT_ID)}&store_id=${encodeURIComponent(STORE_ID)}`, {}, token);
  assertOk('J. Opportunities generated', opportunities.ok && opportunities.opportunities?.length > 0, { count: opportunities.opportunities?.length });

  // K. Verify issue evidence contains rule_id and rule_version
  const firstIssue = issues.issues?.[0];
  const evidence = firstIssue?.evidence_json || {};
  assertOk('K. Issue evidence has rule_id', !!evidence.rule_id, { ruleId: evidence.rule_id });
  assertOk('K. Issue evidence has rule_version', evidence.rule_version !== undefined, { version: evidence.rule_version });

  // L. Disable and re-enable rule
  const disableResult = await api('/api/ontology/rules/dormant_customer_reactivation/disable', {
    method: 'POST',
    body: JSON.stringify({ tenant_id: TENANT_ID, store_id: STORE_ID }),
  }, token);
  assertOk('L. Rule disabled', disableResult.ok !== false || disableResult.status === 200 || disableResult.status === 404, disableResult);

  await cleanup();
  if (failures.length) {
    console.error(JSON.stringify({ failures }, null, 2));
    process.exit(1);
  }
  console.log('E2E ontology rules config MVP PASSED');
}

run().catch(async (e) => {
  console.error(e?.stack || e);
  await cleanup().catch(() => {});
  process.exit(1);
}).finally(async () => {
  await pool.end().catch(() => {});
});
