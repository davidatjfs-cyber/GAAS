import { randomUUID } from 'node:crypto';
import { createOpportunitiesForIssue, listOpportunities } from './growth-opportunity-service.js';
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

async function dormantCustomerStats(pool, { tenantId, storeId, date, daysMin = 90, daysMax = 180, minVisitCount = 2, minTotalSpend = 300 }) {
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

async function newCustomerSecondVisitStats(pool, { tenantId, storeId, date, daysMin = 7, daysMax = 14 }) {
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

async function loadDiagnosisRulesSafe(pool, { tenantId, storeId }) {
  try {
    const rules = await loadEffectiveRules(pool, { tenantId, storeId, ruleType: 'diagnosis' });
    return { rules, byId: new Map(rules.map(rule => [rule.rule_id, rule])) };
  } catch (e) {
    console.warn('[ontology-rules] load failed, fallback to code rules:', e?.message || e);
    return { rules: [], byId: new Map(), error: e };
  }
}

async function thresholdSafe(pool, options) {
  try {
    const result = await getRuleThreshold(pool, options);
    return result?.value ?? options.defaultValue;
  } catch {
    return options.defaultValue;
  }
}

async function applyRule(pool, rule, inputContext) {
  if (!rule) return { matched: true, matchedConditions: [] };
  return evaluateRule(pool, rule, inputContext);
}

function ruleEvidence(rule, matchedConditions, extra = {}) {
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
  // 营收对比用"近7天(不含今天) vs 再往前7天"的周环比，不用"今天 vs 7天前那天"的单日对比——
  // 单日对比在打烊结账前跑诊断会把"今天流水还没同步完"误判成"营收暴跌"（当天0元 vs 历史某天有数据，
  // 直接算出假的-100%），近7天累计能把"今天不完整"的影响摊薄掉，也更贴近"最近生意怎么样"的实际语义。
  const todayStart = new Date(`${date}T00:00:00+08:00`);
  const dayEnd = todayStart.toISOString();
  const dayStartDate = new Date(todayStart);
  dayStartDate.setDate(dayStartDate.getDate() - 7);
  const dayStart = dayStartDate.toISOString();
  const prevEnd = dayStart;
  const prevStartDate = new Date(dayStartDate);
  prevStartDate.setDate(prevStartDate.getDate() - 7);
  const prevStart = prevStartDate.toISOString();
  const ruleState = await loadDiagnosisRulesSafe(pool, { tenantId, storeId });
  const rules = ruleState.byId;
  const dormantDaysMin = await thresholdSafe(pool, { tenantId, storeId, ruleId: 'dormant_customer_reactivation', thresholdKey: 'days_min', defaultValue: getDefaultThreshold('dormant_customer_reactivation', 'days_min', 90) });
  const dormantDaysMax = await thresholdSafe(pool, { tenantId, storeId, ruleId: 'dormant_customer_reactivation', thresholdKey: 'days_max', defaultValue: getDefaultThreshold('dormant_customer_reactivation', 'days_max', 180) });
  const minHistoricalVisitCount = await thresholdSafe(pool, { tenantId, storeId, ruleId: 'dormant_customer_reactivation', thresholdKey: 'min_historical_visit_count', defaultValue: getDefaultThreshold('dormant_customer_reactivation', 'min_historical_visit_count', 2) });
  const minTotalSpend = await thresholdSafe(pool, { tenantId, storeId, ruleId: 'dormant_customer_reactivation', thresholdKey: 'min_total_spend', defaultValue: getDefaultThreshold('dormant_customer_reactivation', 'min_total_spend', 300) });
  const newFirstVisitDaysMin = await thresholdSafe(pool, { tenantId, storeId, ruleId: 'new_customer_second_visit', thresholdKey: 'first_visit_days_min', defaultValue: getDefaultThreshold('new_customer_second_visit', 'first_visit_days_min', 7) });
  const newFirstVisitDaysMax = await thresholdSafe(pool, { tenantId, storeId, ruleId: 'new_customer_second_visit', thresholdKey: 'first_visit_days_max', defaultValue: getDefaultThreshold('new_customer_second_visit', 'first_visit_days_max', 14) });
  const revenueDeclineFallback = getDefaultThreshold('revenue_decline', 'revenueChangeRate', -8);
  const repeatRateFallback = getDefaultThreshold('repeat_rate_low', 'repeatRate', 0.35);
  const marketingConversionFallback = getDefaultThreshold('marketing_conversion_low', 'marketingConversionRate', 0.25);
  const newCustomerNoSecondVisitMin = getDefaultThreshold('new_customer_second_visit', 'no_second_visit_min', 5);

  const [current, prev, repeat, marketing, employee, dormant, newCustomerSecondVisit] = await Promise.all([
    orderStats(pool, { tenantId, storeId, start: dayStart, end: dayEnd }),
    orderStats(pool, { tenantId, storeId, start: prevStart, end: prevEnd }),
    repeatStats(pool, { tenantId, storeId }),
    marketingStats(pool, { tenantId, storeId }),
    employeeStats(pool, { tenantId, storeId }),
    dormantCustomerStats(pool, { tenantId, storeId, date, daysMin: dormantDaysMin, daysMax: dormantDaysMax, minVisitCount: minHistoricalVisitCount, minTotalSpend }),
    newCustomerSecondVisitStats(pool, { tenantId, storeId, date, daysMin: newFirstVisitDaysMin, daysMax: newFirstVisitDaysMax }),
  ]);

  const issues = [];
  const curRevenue = num(current.revenue);
  const prevRevenue = num(prev.revenue);
  if (prevRevenue > 0) {
    const revenueChangeRate = Number((((curRevenue - prevRevenue) / prevRevenue) * 100).toFixed(2));
    const rule = rules.get('revenue_decline');
    const evaluated = await applyRule(pool, rule, { revenueChangeRate, currentRevenue: curRevenue, previousRevenue: prevRevenue });
    if ((!rule && revenueChangeRate <= revenueDeclineFallback) || (rule && evaluated.matched)) {
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
  if (repeat.repeatRate !== null) {
    const rule = rules.get('repeat_rate_low');
    const evaluated = await applyRule(pool, rule, { repeatRate: repeat.repeatRate, customers: repeat.customers, riskCustomers: repeat.riskCustomers });
    if ((!rule && repeat.repeatRate < repeatRateFallback) || (rule && evaluated.matched)) {
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
    firstVisitDays: newFirstVisitDaysMin,
    secondVisitCount: newCustomerSecondVisit.noSecondVisit > 0 ? 0 : 1,
    noSecondVisit: newCustomerSecondVisit.noSecondVisit,
  });
  if ((!newRule && newCustomerSecondVisit.noSecondVisit >= newCustomerNoSecondVisitMin) || (newRule && newCustomerSecondVisit.noSecondVisit >= 1 && newEvaluated.matched)) {
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
    console.log('New customer second visit diagnosis generated');
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
    if (dormantRule) console.log('Dormant customer rule evaluated from config');
  }
  if (employee.lowCount >= 1) {
    issues.push(issueRow({
      tenantId, storeId, issueType: 'staff_execution_risk', title: '员工执行风险',
      description: '部分员工执行评分偏低，整改任务可能无法稳定落地。',
      severity: 'P2', confidence: 0.72,
      evidence: employee, roots: ['training_not_completed', 'task_overdue'], impact: 0,
    }));
  }
  if (marketing.touched > 0 && marketing.conversionRate !== null) {
    const rule = rules.get('marketing_conversion_low');
    const evaluated = await applyRule(pool, rule, { marketingConversionRate: marketing.conversionRate, touched: marketing.touched, returned: marketing.returned });
    if ((!rule && marketing.conversionRate < marketingConversionFallback) || (rule && evaluated.matched)) {
    issues.push(issueRow({
      tenantId, storeId, issueType: 'marketing_ineffective', title: '营销转化不足',
      description: '客户已触达，但回店转化没有起来。',
      severity: rule?.severity || 'P2', confidence: Number(rule?.confidence_base || 0.78),
      evidence: ruleEvidence(rule, evaluated.matchedConditions, marketing), roots: ['offer_not_attractive', 'segment_not_precise'], impact: 0,
    }));
    }
  } else if (marketing.touched === 0) {
    // 诚实降级：没有可关联的客户触达明细时，不产出营销转化结论，也不假装“转化正常”。
    console.log('[ontology] marketing_conversion skipped: no resolvable touches for store', storeId);
  }

  const dataGaps = [];
  if (marketing.touched === 0) {
    dataGaps.push({
      code: 'marketing_touches',
      message: '当前门店没有可关联的客户触达明细，营销转化规则暂未评估',
    });
  }

  // 每次跑诊断都是全量重新判断这家店的问题，旧一轮生成的 issue/opportunity 不应该继续以
  // status='open' 的身份留在库里跟新结果混在一起——之前一直是纯 INSERT，从不关闭旧记录，
  // 导致 listIssues 把几小时前（甚至用了旧口径算出来）的问题和刚生成的新问题堆在一起返回，
  // AI 挑"重点问题"时可能挑中过期的那条。这里在插入新一轮结果之前，先把这家店旧的 open
  // 记录标记为 superseded（保留历史，不删数据），listIssues/listOpportunities 只读 open 的。
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
          days_min: evidence.daysMin || dormantDaysMin,
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
        console.warn('[ontology-rules] record hit failed:', e?.message || e);
      }
    }
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
    dataGaps,
    marketingStats: {
      touched: marketing.touched,
      returned: marketing.returned,
      conversionRate: marketing.conversionRate,
      evaluated: marketing.touched > 0,
    },
  };
}

export async function listIssues(pool, options = {}) {
  const tenantId = options.tenantId || 'default';
  const storeId = String(options.storeId || '').trim();
  const r = await pool.query(
    `SELECT * FROM growth_ontology_issues
      WHERE tenant_id=$1 AND ($2::text='' OR store_id=$2) AND status='open'
      ORDER BY created_at DESC LIMIT 100`,
    [tenantId, storeId]
  );
  return (r.rows || []).map(row => ({ ...row, boss_language_summary: summarizeIssueForBoss(row) }));
}

export { listOpportunities };
