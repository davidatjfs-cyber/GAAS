/**
 * P4 peel: runDailyDiagnosis stat queries, rule evaluation, issue building, persistence.
 */
import { randomUUID } from 'node:crypto';
import { createOpportunitiesForIssue } from './growth-opportunity-service.js';
import { summarizeIssueForBoss } from './boss-language-service.js';
import {
  confidenceNoteForRule,
  evaluateRule,
  getRuleThreshold,
  loadEffectiveRules,
  recordRuleHit,
  renderBossLanguage,
} from './ontology-rule-service.js';
import { getDefaultThreshold } from './rule-identity.js';
import { getBenchmarkForStore } from './benchmark-service.js';
import { recordDataQuality } from './data-trust-service.js';
import { childLogger } from '../utils/logger.js';

const log = childLogger({ domain: 'ontology', handler: 'run-daily-diagnosis' });

export function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function severityByDrop(rate) {
  if (rate <= -20) return 'P1';
  if (rate <= -8) return 'P2';
  return 'P3';
}

export async function orderStats(pool, { tenantId, storeId, start, end }) {
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

export async function repeatStats(pool, { tenantId, storeId }) {
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

export async function marketingStats(pool, { tenantId, storeId }) {
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

export async function employeeStats(pool, { tenantId, storeId }) {
  const r = await pool.query(
    `SELECT avg(performance_score)::numeric AS avg_score,
            count(*) FILTER (WHERE performance_score IS NOT NULL AND performance_score < 70)::numeric AS low_count
       FROM growth_ontology_employees
      WHERE tenant_id=$1 AND store_id=$2`,
    [tenantId, storeId]
  );
  return { avgScore: num(r.rows[0]?.avg_score), lowCount: num(r.rows[0]?.low_count) };
}

export async function dormantCustomerStats(pool, { tenantId, storeId, date, daysMin = 90, daysMax = 180, minVisitCount = 2, minTotalSpend = 300 }) {
  const r = await pool.query(
    `SELECT count(*)::numeric AS dormant_count,
            count(*) FILTER (WHERE visit_count >= $5 OR total_spend >= $6)::numeric AS priority_customer_count,
            COALESCE(max(visit_count), 0)::numeric AS max_visit_count,
            COALESCE(max(total_spend), 0)::numeric AS max_total_spend,
            COALESCE(avg(total_spend), 0)::numeric AS avg_total_spend,
            COALESCE(min(floor(extract(epoch from ($3::date::timestamptz - last_visit_at)) / 86400)), 0)::numeric AS min_last_visit_days
       FROM growth_ontology_customers
      WHERE tenant_id=$1 AND store_id=$2
        AND last_visit_at IS NOT NULL
        AND last_visit_at < ($3::date::timestamptz - ($4::int * interval '1 day'))
        AND last_visit_at >= ($3::date::timestamptz - ($7::int * interval '1 day'))`,
    [tenantId, storeId, date, daysMin, minVisitCount, minTotalSpend, daysMax]
  );
  const row = r.rows[0] || {};
  return {
    dormantCustomerCount: num(row.dormant_count),
    priorityCustomerCount: num(row.priority_customer_count),
    maxVisitCount: num(row.max_visit_count),
    maxTotalSpend: num(row.max_total_spend),
    avgTotalSpend: num(row.avg_total_spend),
    minLastVisitDays: num(row.min_last_visit_days) || Number(daysMin),
    daysMin: Number(daysMin),
    daysMax: Number(daysMax),
  };
}

export async function newCustomerSecondVisitStats(pool, { tenantId, storeId, date, daysMin = 7, daysMax = 14 }) {
  const r = await pool.query(
    `WITH first_visit AS (
       SELECT c.customer_id, c.total_spend, c.tags, c.first_visit_at,
              count(o.order_id) FILTER (WHERE o.order_time > c.first_visit_at + interval '1 hour') AS later_orders
         FROM growth_ontology_customers c
         LEFT JOIN growth_ontology_orders o ON o.tenant_id=c.tenant_id
          AND o.store_id=c.store_id AND o.customer_id=c.customer_id
        WHERE c.tenant_id=$1 AND c.store_id=$2
          AND c.visit_count <= 1
          AND c.first_visit_at >= ($3::date - ($5::int * interval '1 day'))
          AND c.first_visit_at < ($3::date - ($4::int * interval '1 day'))
        GROUP BY c.customer_id, c.total_spend, c.tags, c.first_visit_at
      )
      SELECT count(*)::numeric AS candidates,
             count(*) FILTER (WHERE later_orders = 0)::numeric AS no_second_visit,
             count(*) FILTER (WHERE later_orders = 0 AND COALESCE(tags, '[]'::jsonb) ? 'signature_dish')::numeric AS signature_dish_customers,
             COALESCE(avg(total_spend) FILTER (WHERE later_orders = 0),0)::numeric AS avg_first_spend
        FROM first_visit`,
    [tenantId, storeId, date, daysMin, daysMax]
  );
  const row = r.rows[0] || {};
  return {
    candidates: num(row.candidates),
    noSecondVisit: num(row.no_second_visit),
    signatureDishCustomers: num(row.signature_dish_customers),
    avgFirstSpend: num(row.avg_first_spend),
  };
}

export async function loadDiagnosisRulesSafe(pool, { tenantId, storeId }) {
  try {
    const rules = await loadEffectiveRules(pool, { tenantId, storeId, ruleType: 'diagnosis' });
    return { rules, byId: new Map(rules.map(rule => [rule.rule_id, rule])) };
  } catch (e) {
    log.warn({ msg: 'ontology_rules_load_failed_fallback_to_code_rules', err: e?.message || e });
    return { rules: [], byId: new Map(), error: e };
  }
}

export async function thresholdSafe(pool, options) {
  try {
    const result = await getRuleThreshold(pool, options);
    return result?.value ?? options.defaultValue;
  } catch {
    return options.defaultValue;
  }
}

export async function applyRule(pool, rule, inputContext) {
  if (!rule) return { matched: true, matchedConditions: [] };
  return evaluateRule(pool, rule, inputContext);
}

export function ruleEvidence(rule, matchedConditions, extra = {}) {
  if (!rule) return extra;
  return {
    ...extra,
    rule_id: rule.rule_id,
    rule_version: rule.version,
    rule_scope: rule.rule_scope || 'system',
    confidence_note: confidenceNoteForRule(rule),
    matched_conditions: matchedConditions || [],
    rule_action: rule.action_json || {},
  };
}

export function issueRow({ tenantId, storeId, issueType, title, description, severity, confidence, evidence, roots, impact }) {
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

/** 近7天(不含今天) vs 再往前7天的周环比窗口 */
export function resolveDiagnosisWindow(date) {
  const todayStart = new Date(`${date}T00:00:00+08:00`);
  const dayEnd = todayStart.toISOString();
  const dayStartDate = new Date(todayStart);
  dayStartDate.setDate(dayStartDate.getDate() - 7);
  const dayStart = dayStartDate.toISOString();
  const prevEnd = dayStart;
  const prevStartDate = new Date(dayStartDate);
  prevStartDate.setDate(prevStartDate.getDate() - 7);
  const prevStart = prevStartDate.toISOString();
  return { dayStart, dayEnd, prevStart, prevEnd };
}

export async function loadDiagnosisThresholds(pool, { tenantId, storeId }) {
  const dormantDaysMin = await thresholdSafe(pool, { tenantId, storeId, ruleId: 'dormant_customer_reactivation', thresholdKey: 'days_min', defaultValue: getDefaultThreshold('dormant_customer_reactivation', 'days_min', 90) });
  const dormantDaysMax = await thresholdSafe(pool, { tenantId, storeId, ruleId: 'dormant_customer_reactivation', thresholdKey: 'days_max', defaultValue: getDefaultThreshold('dormant_customer_reactivation', 'days_max', 180) });
  const minHistoricalVisitCount = await thresholdSafe(pool, { tenantId, storeId, ruleId: 'dormant_customer_reactivation', thresholdKey: 'min_historical_visit_count', defaultValue: getDefaultThreshold('dormant_customer_reactivation', 'min_historical_visit_count', 2) });
  const minTotalSpend = await thresholdSafe(pool, { tenantId, storeId, ruleId: 'dormant_customer_reactivation', thresholdKey: 'min_total_spend', defaultValue: getDefaultThreshold('dormant_customer_reactivation', 'min_total_spend', 300) });
  const newFirstVisitDaysMin = await thresholdSafe(pool, { tenantId, storeId, ruleId: 'new_customer_second_visit', thresholdKey: 'first_visit_days_min', defaultValue: getDefaultThreshold('new_customer_second_visit', 'first_visit_days_min', 7) });
  const newFirstVisitDaysMax = await thresholdSafe(pool, { tenantId, storeId, ruleId: 'new_customer_second_visit', thresholdKey: 'first_visit_days_max', defaultValue: getDefaultThreshold('new_customer_second_visit', 'first_visit_days_max', 14) });
  return {
    dormantDaysMin,
    dormantDaysMax,
    minHistoricalVisitCount,
    minTotalSpend,
    newFirstVisitDaysMin,
    newFirstVisitDaysMax,
    revenueDeclineFallback: getDefaultThreshold('revenue_decline', 'revenueChangeRate', -8),
    repeatRateFallback: getDefaultThreshold('repeat_rate_low', 'repeatRate', 0.35),
    marketingConversionFallback: getDefaultThreshold('marketing_conversion_low', 'marketingConversionRate', 0.25),
    newCustomerNoSecondVisitMin: getDefaultThreshold('new_customer_second_visit', 'no_second_visit_min', 5),
  };
}

export async function fetchDiagnosisStats(pool, { tenantId, storeId, date, thresholds, window }) {
  const { dayStart, dayEnd, prevStart, prevEnd } = window;
  const [current, prev, repeat, marketing, employee, dormant, newCustomerSecondVisit] = await Promise.all([
    orderStats(pool, { tenantId, storeId, start: dayStart, end: dayEnd }),
    orderStats(pool, { tenantId, storeId, start: prevStart, end: prevEnd }),
    repeatStats(pool, { tenantId, storeId }),
    marketingStats(pool, { tenantId, storeId }),
    employeeStats(pool, { tenantId, storeId }),
    dormantCustomerStats(pool, {
      tenantId, storeId, date,
      daysMin: thresholds.dormantDaysMin,
      daysMax: thresholds.dormantDaysMax,
      minVisitCount: thresholds.minHistoricalVisitCount,
      minTotalSpend: thresholds.minTotalSpend,
    }),
    newCustomerSecondVisitStats(pool, {
      tenantId, storeId, date,
      daysMin: thresholds.newFirstVisitDaysMin,
      daysMax: thresholds.newFirstVisitDaysMax,
    }),
  ]);
  return { current, prev, repeat, marketing, employee, dormant, newCustomerSecondVisit };
}

export async function buildDiagnosisIssues(pool, ctx) {
  const {
    tenantId, storeId, date, rules, thresholds, stats,
  } = ctx;
  const { current, prev, repeat, marketing, employee, dormant, newCustomerSecondVisit } = stats;
  const issues = [];
  const curRevenue = num(current.revenue);
  const prevRevenue = num(prev.revenue);
  let revenueChangeRate = null;

  if (prevRevenue > 0) {
    revenueChangeRate = Number((((curRevenue - prevRevenue) / prevRevenue) * 100).toFixed(2));
    const rule = rules.get('revenue_decline');
    const evaluated = await applyRule(pool, rule, { revenueChangeRate, currentRevenue: curRevenue, previousRevenue: prevRevenue });
    if ((!rule && revenueChangeRate <= thresholds.revenueDeclineFallback) || (rule && evaluated.matched)) {
      issues.push(issueRow({
        tenantId, storeId, issueType: 'revenue_decline', title: '营业额下滑',
        description: '本期营业额低于可比周期，需要拆解客流、复购和午市。',
        severity: rule?.severity || severityByDrop(revenueChangeRate), confidence: Number(rule?.confidence_base || 0.84),
        evidence: ruleEvidence(rule, evaluated.matchedConditions, { currentRevenue: curRevenue, previousRevenue: prevRevenue, changeRate: revenueChangeRate, revenueGap: prevRevenue - curRevenue }),
        roots: ['traffic_decline', 'repeat_decline', 'lunch_decline'],
        impact: prevRevenue - curRevenue,
      }));
    }
  }

  const curOrders = num(current.orders);
  if (curOrders > 0) {
    const avgTicket = curRevenue / curOrders;
    const benchmark = await getBenchmarkForStore(pool, storeId, 'avg_ticket_price').catch(() => null);
    if (benchmark && Number.isFinite(num(benchmark.p25)) && avgTicket < num(benchmark.p25)) {
      const p10 = benchmark.p10 ?? benchmark.p25;
      issues.push(issueRow({
        tenantId, storeId, issueType: 'below_peer_benchmark', title: '客单价低于同类门店',
        description: `本店客单价${avgTicket.toFixed(1)}元，低于同类型门店25分位水平${num(benchmark.p25).toFixed(1)}元(${benchmark.source === 'platform' ? '平台真实基准' : '行业参考值，样本不足暂未生成平台基准'})。`,
        severity: avgTicket < num(p10) ? 'P2' : 'P3',
        confidence: benchmark.source === 'platform' ? Math.min(0.9, 0.5 + Number(benchmark.confidence_score || 0) * 0.4) : 0.5,
        evidence: { avg_ticket_price: Number(avgTicket.toFixed(2)), benchmark_p25: benchmark.p25, benchmark_p50: benchmark.p50, benchmark_source: benchmark.source, sample_size: benchmark.sample_size || 0 },
        roots: ['pricing_strategy', 'upsell_not_executed'],
        impact: 0,
      }));
    }
  }

  if (repeat.repeatRate !== null) {
    const rule = rules.get('repeat_rate_low');
    const evaluated = await applyRule(pool, rule, { repeatRate: repeat.repeatRate, customers: repeat.customers, riskCustomers: repeat.riskCustomers });
    if ((!rule && repeat.repeatRate < thresholds.repeatRateFallback) || (rule && evaluated.matched)) {
      issues.push(issueRow({
        tenantId, storeId, issueType: 'repeat_decline', title: '复购偏弱',
        description: '复购客户占比偏低，客户维护动作需要进入闭环。',
        severity: rule?.severity || 'P2', confidence: Number(rule?.confidence_base || 0.76),
        evidence: ruleEvidence(rule, evaluated.matchedConditions, repeat), roots: ['new_customer_not_followed', 'dormant_customer_not_reactivated'], impact: 0,
      }));
    }
  }

  const newRule = rules.get('new_customer_second_visit');
  const newEvaluated = await applyRule(pool, newRule, {
    firstVisitDays: thresholds.newFirstVisitDaysMin,
    secondVisitCount: newCustomerSecondVisit.noSecondVisit > 0 ? 0 : 1,
    noSecondVisit: newCustomerSecondVisit.noSecondVisit,
  });
  if ((!newRule && newCustomerSecondVisit.noSecondVisit >= thresholds.newCustomerNoSecondVisitMin) || (newRule && newCustomerSecondVisit.noSecondVisit >= 1 && newEvaluated.matched)) {
    issues.push(issueRow({
      tenantId,
      storeId,
      issueType: 'new_customer_no_second_visit',
      title: '新客未二次回店',
      description: '有一批首次消费后的新客已经过了最佳二次转化窗口，但还没有第二次消费。',
      severity: newRule?.severity || (newCustomerSecondVisit.noSecondVisit >= 30 ? 'P1' : 'P2'),
      confidence: Number(newRule?.confidence_base || 0.82),
      evidence: ruleEvidence(newRule, newEvaluated.matchedConditions, newCustomerSecondVisit),
      roots: ['new_customer_not_followed', 'second_visit_invitation_missing'],
      impact: Math.round(newCustomerSecondVisit.noSecondVisit * Math.max(newCustomerSecondVisit.avgFirstSpend, 80) * 0.12),
    }));
    log.info({ msg: 'new_customer_second_visit_diagnosis_generated' });
  }

  const dormantRule = rules.get('dormant_customer_reactivation');
  const dormantEvaluated = await applyRule(pool, dormantRule, {
    lastVisitDays: dormant.minLastVisitDays,
    visitCount: dormant.maxVisitCount,
    totalSpend: dormant.maxTotalSpend,
    priorityCustomerCount: dormant.priorityCustomerCount,
  });
  if ((!dormantRule && repeat.riskCustomers >= 1) || (dormantRule && dormant.priorityCustomerCount >= 1 && dormantEvaluated.matched)) {
    issues.push(issueRow({
      tenantId, storeId, issueType: 'customer_asset_risk', title: '客户资产流失风险',
      description: '存在沉睡或高风险客户，需要尽快触达维护。',
      severity: dormantRule?.severity || (repeat.riskCustomers >= 3 ? 'P1' : 'P2'), confidence: Number(dormantRule?.confidence_base || 0.8),
      evidence: ruleEvidence(dormantRule, dormantEvaluated.matchedConditions, { ...repeat, ...dormant }), roots: ['vip_churn', 'stored_value_inactive'], impact: 0,
    }));
    if (dormantRule) log.info({ msg: 'dormant_customer_rule_evaluated_from_config' });
  }

  if (employee.lowCount >= 1) {
    issues.push(issueRow({
      tenantId, storeId, issueType: 'staff_execution_risk', title: '员工执行风险',
      description: '部分员工执行评分偏低，整改任务可能无法稳定落地。',
      severity: 'P2', confidence: 0.72,
      evidence: employee, roots: ['training_not_completed', 'task_overdue'], impact: 0,
    }));
  }

  if (employee.avgScore > 0 && revenueChangeRate !== null) {
    const conflict = employee.avgScore >= 85 && revenueChangeRate <= -8;
    await recordDataQuality(pool, {
      dataId: `employee_score_${tenantId}_${storeId}_${date}`,
      dataType: 'employee_performance_review',
      tenantId,
      storeId,
      sourceType: 'employee_manual_entry',
      crossSourceChecks: [{
        ruleId: 'employee_score_vs_actual_revenue',
        result: conflict ? 'conflict' : 'consistent',
      }],
    }).catch((e) => log.warn({ msg: 'data_trust_record_employee_score_check_failed', err: e?.message || e }));
  }

  if (marketing.touched > 0 && marketing.conversionRate !== null) {
    const rule = rules.get('marketing_conversion_low');
    const evaluated = await applyRule(pool, rule, { marketingConversionRate: marketing.conversionRate, touched: marketing.touched, returned: marketing.returned });
    if ((!rule && marketing.conversionRate < thresholds.marketingConversionFallback) || (rule && evaluated.matched)) {
      issues.push(issueRow({
        tenantId, storeId, issueType: 'marketing_ineffective', title: '营销转化不足',
        description: '客户已触达，但回店转化没有起来。',
        severity: rule?.severity || 'P2', confidence: Number(rule?.confidence_base || 0.78),
        evidence: ruleEvidence(rule, evaluated.matchedConditions, marketing), roots: ['offer_not_attractive', 'segment_not_precise'], impact: 0,
      }));
    }
  } else if (marketing.touched === 0) {
    log.info({ msg: 'ontology_marketing_conversion_skipped_no_resolvable_touches_for_store', detail: [storeId] });
  }

  const dataGaps = [];
  if (marketing.touched === 0) {
    dataGaps.push({
      code: 'marketing_touches',
      message: '当前门店没有可关联的客户触达明细，营销转化规则暂未评估',
    });
  }

  return { issues, dataGaps, revenueChangeRate };
}

export async function supersedeOpenDiagnosisRecords(pool, { tenantId, storeId }) {
  await pool.query(
    `UPDATE growth_ontology_issues SET status='superseded', updated_at=now()
      WHERE tenant_id=$1 AND store_id=$2 AND status='open'`,
    [tenantId, storeId]
  );
  await pool.query(
    `UPDATE growth_ontology_opportunities SET status='superseded', updated_at=now()
      WHERE tenant_id=$1 AND store_id=$2 AND status='open'`,
    [tenantId, storeId]
  );
}

export async function persistDiagnosisIssues(pool, { tenantId, storeId, issues, rules, thresholds }) {
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
    const evidence = saved.evidence_json || {};
    if (evidence.rule_id) {
      try {
        const sourceRule = rules.get(evidence.rule_id);
        const bossLanguageOutput = renderBossLanguage(sourceRule, {
          ...evidence,
          days_min: evidence.daysMin || thresholds.dormantDaysMin,
          priority_customer_count: evidence.priorityCustomerCount || 0,
          change_rate: Math.abs(Number(evidence.changeRate || 0)),
        }) || saved.boss_language_summary;
        const hit = await recordRuleHit(pool, {
          tenantId,
          storeId,
          rule: sourceRule,
          inputContext: evidence,
          output: {
            generatedIssueId: saved.issue_id,
            confidenceScore: saved.confidence_score,
            severity: saved.severity,
            bossLanguageOutput,
            matchedConditions: evidence.matched_conditions || [],
          },
        });
        if (hit?.id) {
          saved.evidence_json = { ...evidence, rule_hit_id: hit.id };
          await pool.query(`UPDATE growth_ontology_issues SET evidence_json=$2::jsonb WHERE issue_id=$1`, [saved.issue_id, JSON.stringify(saved.evidence_json)]);
        }
        saved.boss_language_summary = bossLanguageOutput;
      } catch (e) {
        log.warn({ msg: 'ontology_rules_record_hit_failed', err: e?.message || e });
      }
    }
    savedIssues.push(saved);
    opportunities.push(...await createOpportunitiesForIssue(pool, saved));
  }
  return { savedIssues, opportunities };
}
