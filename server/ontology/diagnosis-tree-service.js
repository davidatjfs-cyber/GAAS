import { randomUUID } from 'node:crypto';
import { createOpportunitiesForIssue, listOpportunities } from './growth-opportunity-service.js';
import { summarizeIssueForBoss } from './boss-language-service.js';

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function severityByDrop(rate) {
  if (rate <= -20) return 'P1';
  if (rate <= -8) return 'P2';
  return 'P3';
}

async function orderStats(pool, { tenantId, storeId, start, end }) {
  const r = await pool.query(
    `SELECT COALESCE(sum(actual_paid),0)::numeric AS revenue,
            count(*)::int AS orders,
            count(DISTINCT customer_id)::int AS customers
       FROM growth_ontology_orders
      WHERE tenant_id=$1 AND store_id=$2 AND order_time >= $3::timestamptz AND order_time < $4::timestamptz`,
    [tenantId, storeId, start, end]
  );
  return r.rows[0] || { revenue: 0, orders: 0, customers: 0 };
}

async function repeatStats(pool, { tenantId, storeId }) {
  const r = await pool.query(
    `SELECT count(*) FILTER (WHERE visit_count >= 2)::numeric AS repeat_customers,
            count(*)::numeric AS customers,
            count(*) FILTER (WHERE risk_level IN ('high','sleeping') OR lifecycle_stage IN ('dormant','sleeping'))::numeric AS risk_customers
       FROM growth_ontology_customers
      WHERE tenant_id=$1 AND store_id=$2`,
    [tenantId, storeId]
  );
  const row = r.rows[0] || {};
  return {
    repeatRate: num(row.customers) ? num(row.repeat_customers) / num(row.customers) : null,
    riskCustomers: num(row.risk_customers),
    customers: num(row.customers),
  };
}

async function marketingStats(pool, { tenantId, storeId }) {
  const r = await pool.query(
    `SELECT count(DISTINCT t.customer_id)::numeric AS touched,
            count(DISTINCT o.customer_id)::numeric AS returned
       FROM growth_ontology_touches t
       LEFT JOIN growth_ontology_orders o ON o.tenant_id=t.tenant_id
        AND o.store_id=t.store_id AND o.customer_id=t.customer_id
        AND o.order_time >= t.sent_at AND o.order_time < t.sent_at + interval '7 days'
      WHERE t.tenant_id=$1 AND t.store_id=$2`,
    [tenantId, storeId]
  );
  const row = r.rows[0] || {};
  return {
    touched: num(row.touched),
    returned: num(row.returned),
    conversionRate: num(row.touched) ? num(row.returned) / num(row.touched) : null,
  };
}

async function employeeStats(pool, { tenantId, storeId }) {
  const r = await pool.query(
    `SELECT avg(performance_score)::numeric AS avg_score,
            count(*) FILTER (WHERE performance_score IS NOT NULL AND performance_score < 70)::numeric AS low_count
       FROM growth_ontology_employees
      WHERE tenant_id=$1 AND store_id=$2`,
    [tenantId, storeId]
  );
  return { avgScore: num(r.rows[0]?.avg_score), lowCount: num(r.rows[0]?.low_count) };
}

async function newCustomerSecondVisitStats(pool, { tenantId, storeId, date }) {
  const r = await pool.query(
    `WITH first_visit AS (
       SELECT c.customer_id, c.total_spend, c.tags, c.first_visit_at,
              count(o.order_id) FILTER (WHERE o.order_time > c.first_visit_at + interval '1 hour') AS later_orders
         FROM growth_ontology_customers c
         LEFT JOIN growth_ontology_orders o ON o.tenant_id=c.tenant_id
          AND o.store_id=c.store_id AND o.customer_id=c.customer_id
        WHERE c.tenant_id=$1 AND c.store_id=$2
          AND c.visit_count <= 1
          AND c.first_visit_at >= ($3::date - interval '14 days')
          AND c.first_visit_at < ($3::date - interval '7 days')
        GROUP BY c.customer_id, c.total_spend, c.tags, c.first_visit_at
      )
      SELECT count(*)::numeric AS candidates,
             count(*) FILTER (WHERE later_orders = 0)::numeric AS no_second_visit,
             count(*) FILTER (WHERE later_orders = 0 AND COALESCE(tags, '[]'::jsonb) ? 'signature_dish')::numeric AS signature_dish_customers,
             COALESCE(avg(total_spend) FILTER (WHERE later_orders = 0),0)::numeric AS avg_first_spend
        FROM first_visit`,
    [tenantId, storeId, date]
  );
  const row = r.rows[0] || {};
  return {
    candidates: num(row.candidates),
    noSecondVisit: num(row.no_second_visit),
    signatureDishCustomers: num(row.signature_dish_customers),
    avgFirstSpend: num(row.avg_first_spend),
  };
}

function issueRow({ tenantId, storeId, issueType, title, description, severity, confidence, evidence, roots, impact }) {
  return {
    issue_id: `issue_${randomUUID()}`,
    tenant_id: tenantId,
    store_id: storeId,
    issue_type: issueType,
    issue_title: title,
    issue_description: description,
    severity,
    confidence_score: confidence,
    evidence_json: evidence,
    root_cause_candidates_json: roots,
    impact_amount_estimate: impact || 0,
    status: 'open',
    first_detected_at: new Date().toISOString(),
    last_detected_at: new Date().toISOString(),
  };
}

export async function runDailyDiagnosis(pool, options = {}) {
  const tenantId = options.tenantId || options.tenant_id || 'default';
  const storeId = options.storeId || options.store_id || '';
  const date = options.date || new Date().toISOString().slice(0, 10);
  if (!storeId) return { ontologyStatus: 'insufficient_data', missingFields: ['store_id'], issues: [], opportunities: [] };
  const dayStart = `${date}T00:00:00+08:00`;
  const dayEnd = `${date}T23:59:59+08:00`;
  const previous = new Date(`${date}T00:00:00+08:00`);
  previous.setDate(previous.getDate() - 7);
  const prevStart = previous.toISOString();
  const prevEndDate = new Date(previous);
  prevEndDate.setDate(prevEndDate.getDate() + 1);
  const prevEnd = prevEndDate.toISOString();

  const [current, prev, repeat, marketing, employee, newCustomerSecondVisit] = await Promise.all([
    orderStats(pool, { tenantId, storeId, start: dayStart, end: dayEnd }),
    orderStats(pool, { tenantId, storeId, start: prevStart, end: prevEnd }),
    repeatStats(pool, { tenantId, storeId }),
    marketingStats(pool, { tenantId, storeId }),
    employeeStats(pool, { tenantId, storeId }),
    newCustomerSecondVisitStats(pool, { tenantId, storeId, date }),
  ]);

  const issues = [];
  const curRevenue = num(current.revenue);
  const prevRevenue = num(prev.revenue);
  if (prevRevenue > 0) {
    const revenueChangeRate = Number((((curRevenue - prevRevenue) / prevRevenue) * 100).toFixed(2));
    if (revenueChangeRate <= -8) {
      issues.push(issueRow({
        tenantId, storeId, issueType: 'revenue_decline', title: '营业额下滑',
        description: '本期营业额低于可比周期，需要拆解客流、复购和午市。',
        severity: severityByDrop(revenueChangeRate), confidence: 0.84,
        evidence: { currentRevenue: curRevenue, previousRevenue: prevRevenue, changeRate: revenueChangeRate, revenueGap: prevRevenue - curRevenue },
        roots: ['traffic_decline', 'repeat_decline', 'lunch_decline'],
        impact: prevRevenue - curRevenue,
      }));
    }
  }
  if (repeat.repeatRate !== null && repeat.repeatRate < 0.35) {
    issues.push(issueRow({
      tenantId, storeId, issueType: 'repeat_decline', title: '复购偏弱',
      description: '复购客户占比偏低，客户维护动作需要进入闭环。',
      severity: 'P2', confidence: 0.76,
      evidence: repeat, roots: ['new_customer_not_followed', 'dormant_customer_not_reactivated'], impact: 0,
    }));
  }
  if (newCustomerSecondVisit.noSecondVisit >= 5) {
    issues.push(issueRow({
      tenantId,
      storeId,
      issueType: 'new_customer_no_second_visit',
      title: '新客未二次回店',
      description: '有一批首次消费后的新客已经过了最佳二次转化窗口，但还没有第二次消费。',
      severity: newCustomerSecondVisit.noSecondVisit >= 30 ? 'P1' : 'P2',
      confidence: 0.82,
      evidence: newCustomerSecondVisit,
      roots: ['new_customer_not_followed', 'second_visit_invitation_missing'],
      impact: Math.round(newCustomerSecondVisit.noSecondVisit * Math.max(newCustomerSecondVisit.avgFirstSpend, 80) * 0.12),
    }));
    console.log('New customer second visit diagnosis generated');
  }
  if (repeat.riskCustomers >= 1) {
    issues.push(issueRow({
      tenantId, storeId, issueType: 'customer_asset_risk', title: '客户资产流失风险',
      description: '存在沉睡或高风险客户，需要尽快触达维护。',
      severity: repeat.riskCustomers >= 3 ? 'P1' : 'P2', confidence: 0.8,
      evidence: repeat, roots: ['vip_churn', 'stored_value_inactive'], impact: 0,
    }));
  }
  if (employee.lowCount >= 1) {
    issues.push(issueRow({
      tenantId, storeId, issueType: 'staff_execution_risk', title: '员工执行风险',
      description: '部分员工执行评分偏低，整改任务可能无法稳定落地。',
      severity: 'P2', confidence: 0.72,
      evidence: employee, roots: ['training_not_completed', 'task_overdue'], impact: 0,
    }));
  }
  if (marketing.touched > 0 && marketing.conversionRate !== null && marketing.conversionRate < 0.25) {
    issues.push(issueRow({
      tenantId, storeId, issueType: 'marketing_ineffective', title: '营销转化不足',
      description: '客户已触达，但回店转化没有起来。',
      severity: 'P2', confidence: 0.78,
      evidence: marketing, roots: ['offer_not_attractive', 'segment_not_precise'], impact: 0,
    }));
  }

  const savedIssues = [];
  const opportunities = [];
  for (const issue of issues) {
    const r = await pool.query(
      `INSERT INTO growth_ontology_issues (
        issue_id, tenant_id, store_id, issue_type, issue_title, issue_description, severity,
        confidence_score, evidence_json, root_cause_candidates_json, impact_amount_estimate,
        status, first_detected_at, last_detected_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11,$12,$13,$14)
      RETURNING *`,
      [
        issue.issue_id, issue.tenant_id, issue.store_id, issue.issue_type, issue.issue_title,
        issue.issue_description, issue.severity, issue.confidence_score, JSON.stringify(issue.evidence_json),
        JSON.stringify(issue.root_cause_candidates_json), issue.impact_amount_estimate, issue.status,
        issue.first_detected_at, issue.last_detected_at,
      ]
    );
    const saved = r.rows[0];
    saved.boss_language_summary = summarizeIssueForBoss(saved);
    savedIssues.push(saved);
    opportunities.push(...await createOpportunitiesForIssue(pool, saved));
  }
  console.log('Daily diagnosis generated');
  console.log('Issues generated');
  console.log('Opportunities generated');
  return {
    ontologyStatus: savedIssues.length ? 'ok' : 'no_issue_detected',
    issues: savedIssues,
    opportunities,
  };
}

export async function listIssues(pool, options = {}) {
  const tenantId = options.tenantId || 'default';
  const storeId = String(options.storeId || '').trim();
  const r = await pool.query(
    `SELECT * FROM growth_ontology_issues
      WHERE tenant_id=$1 AND ($2::text='' OR store_id=$2)
      ORDER BY created_at DESC LIMIT 100`,
    [tenantId, storeId]
  );
  return (r.rows || []).map(row => ({ ...row, boss_language_summary: summarizeIssueForBoss(row) }));
}

export { listOpportunities };
