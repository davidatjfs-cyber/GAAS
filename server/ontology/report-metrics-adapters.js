import { enrichReportWithOntology } from './business-ontology-engine.js';
import { createTaskDraftsFromOntologyInsights } from './task-draft-adapter.js';
import { buildBossReportFields } from './boss-language-service.js';

function num(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function pct(v) {
  const n = num(v);
  if (n === null) return null;
  return Math.abs(n) <= 1 ? Number((n * 100).toFixed(2)) : n;
}

function changeRate(current, previous) {
  const c = num(current);
  const p = num(previous);
  if (c === null || p === null || p === 0) return null;
  return Number((((c - p) / Math.abs(p)) * 100).toFixed(2));
}

function addMetric(out, id, current, previous, options = {}) {
  const c = options.percent ? pct(current) : num(current);
  const p = options.percent ? pct(previous) : num(previous);
  if (c === null || p === null) return;
  out[id] = { current: c, previous: p, changeRate: changeRate(c, p) };
}

function firstValue(obj, keys) {
  for (const key of keys) {
    const parts = key.split('.');
    let cur = obj;
    for (const part of parts) cur = cur?.[part];
    if (cur !== undefined && cur !== null && cur !== '') return cur;
  }
  return null;
}

export function buildCustomerAssetMetricsInput(reportData = {}) {
  const out = {};
  const s = reportData.summary || {};
  const p = reportData.previous_period || {};
  addMetric(out, 'repeat_purchase_rate', s.repeat_purchase_rate ?? s.new_repeat_rate ?? (num(s.identifiable_customers) ? num(s.repeat_customers) / Math.max(1, num(s.identifiable_customers)) : null), p.repeat_purchase_rate ?? p.new_repeat_rate ?? (num(p.identifiable_customers) ? num(p.repeat_customers) / Math.max(1, num(p.identifiable_customers)) : null), { percent: true });
  addMetric(out, 'new_customer_second_visit_rate', s.new_customer_second_visit_rate ?? s.new_repeat_rate, p.new_customer_second_visit_rate ?? p.new_repeat_rate, { percent: true });
  addMetric(out, 'vip_inactive_count', s.vip_inactive_count ?? s.churn_risk_customers, p.vip_inactive_count ?? p.churn_risk_customers);
  addMetric(out, 'stored_value_inactive_count', s.stored_value_inactive_count ?? s.stored_value_inactive_customers, p.stored_value_inactive_count ?? p.stored_value_inactive_customers);
  return out;
}

export function buildOperationImprovementMetricsInput(reportData = {}) {
  const out = {};
  const s = reportData.summary || {};
  addMetric(out, 'revenue', firstValue(reportData, ['summary.revenue', 'summary.customer_revenue']), firstValue(reportData, ['summary.previous_revenue', 'previous_period.revenue', 'previous_period.customer_revenue']));
  addMetric(out, 'lunch_revenue', firstValue(reportData, ['summary.lunch_revenue']), firstValue(reportData, ['summary.previous_lunch_revenue', 'previous_period.lunch_revenue']));
  addMetric(out, 'complaint_rate', s.complaint_rate, s.previous_complaint_rate, { percent: true });
  addMetric(out, 'dish_complaint_rate', s.dish_complaint_rate, s.previous_dish_complaint_rate, { percent: true });
  addMetric(out, 'service_complaint_rate', s.service_complaint_rate, s.previous_service_complaint_rate, { percent: true });
  addMetric(out, 'task_completion_rate', s.task_completion_rate ?? s.completion_rate, s.previous_task_completion_rate ?? s.previous_completion_rate, { percent: true });
  const overdueCurrent = s.task_overdue_rate ?? (num(s.generated_tasks) ? num(s.overdue_tasks) / Math.max(1, num(s.generated_tasks)) : null);
  const overduePrevious = s.previous_task_overdue_rate ?? (num(s.previous_generated_tasks) ? num(s.previous_overdue_tasks) / Math.max(1, num(s.previous_generated_tasks)) : null);
  addMetric(out, 'task_overdue_rate', overdueCurrent, overduePrevious, { percent: true });
  return out;
}

export function buildTalentDevelopmentMetricsInput(reportData = {}) {
  const out = {};
  const s = reportData.summary || {};
  addMetric(out, 'training_completion_rate', s.training_completion_rate ?? s.completion_rate, s.previous_training_completion_rate ?? s.previous_completion_rate, { percent: true });
  addMetric(out, 'certification_pass_rate', s.certification_pass_rate ?? s.exam_pass_rate, s.previous_certification_pass_rate ?? s.previous_exam_pass_rate, { percent: true });
  addMetric(out, 'promotion_candidate_count', s.promotion_candidate_count ?? s.promotion_candidates, s.previous_promotion_candidate_count ?? s.previous_promotion_candidates);
  return out;
}

export function enrichReportForBusinessOntology(reportData = {}, buildMetricsInput, options = {}) {
  const metricsInput = buildMetricsInput(reportData);
  if (!Object.keys(metricsInput).length) {
    const bossFields = buildBossReportFields({
      title: 'AI经营结论',
      summary: '当前数据不足，暂无法生成经营判断。',
      confidenceNote: '缺少可比较的真实经营数据，不会强行推断变化。',
    });
    return {
      ...reportData,
      ontologyStatus: 'insufficient_data',
      ontologyMissingFields: options.missingFields || [],
      ontologyInsights: [],
      bossSummary: '当前数据不足，暂无法生成经营判断。',
      actionPlan: [],
      trackingMetrics: [],
      priorityIssues: [],
      taskDrafts: [],
      ...bossFields,
    };
  }
  const enriched = enrichReportWithOntology(reportData, metricsInput);
  const taskDrafts = createTaskDraftsFromOntologyInsights(enriched.ontologyInsights);
  const bossFields = buildBossReportFields({
    title: 'AI经营结论',
    summary: enriched.bossSummary,
    findings: (enriched.priorityIssues || enriched.ontologyInsights || []).slice(0, 4).map(item => item.bossLanguageTitle || item.issueName),
    actions: (enriched.actionPlan || []).slice(0, 4).map(item => item.actionName || item.expectedResult),
    riskWarning: (enriched.priorityIssues || []).some(item => item.severity === 'P1') ? '存在 P1 重点问题，需要当天安排负责人跟进。' : '当前问题可按任务优先级推进。',
    expectedImpact: taskDrafts.length ? '建议先生成任务草稿，完成后用回店、复购、营业额和任务完成率追踪结果。' : '',
  });
  return {
    ...enriched,
    ontologyStatus: enriched.ontologyInsights.length ? 'ok' : 'no_issue_detected',
    metricsInput,
    taskDrafts,
    ...bossFields,
  };
}
