/**
 * 规则身份桥 — 报告推理层（metric-issue-mapping）与日诊断层（ontology_rules / diagnosis-tree）
 * 共用同一套 canonical issue / rule / metric 身份与默认阈值。
 *
 * 不替换两套引擎，只消除「同名不同义 / 同义不同名」：
 * - reportIssueId：报告/infer API 用的 issueId
 * - diagnosisIssueType：growth_ontology_issues.issue_type
 * - ruleId：ontology_rules.rule_id
 * - metricIds：报告 metricsInput 键
 * - defaultThresholds：诊断硬编码 fallback 与规则默认阈值的单一来源
 */

export const RULE_IDENTITY_CATALOG = [
  {
    canonicalIssueId: 'revenue_decline',
    reportIssueIds: ['revenue_decline'],
    diagnosisIssueType: 'revenue_decline',
    ruleId: 'revenue_decline',
    metricIds: ['revenue', 'lunch_revenue'],
    domain: 'operation_improvement',
    defaultThresholds: {
      decline_threshold: -8,
      revenueChangeRate: -8,
    },
  },
  {
    canonicalIssueId: 'repeat_decline',
    reportIssueIds: ['customer_retention_weak'],
    diagnosisIssueType: 'repeat_decline',
    ruleId: 'repeat_rate_low',
    metricIds: ['repeat_purchase_rate'],
    domain: 'customer_growth',
    defaultThresholds: {
      rate_threshold: 0.35,
      repeatRate: 0.35,
    },
  },
  {
    canonicalIssueId: 'new_customer_no_second_visit',
    reportIssueIds: ['new_customer_activation_weak'],
    diagnosisIssueType: 'new_customer_no_second_visit',
    ruleId: 'new_customer_second_visit',
    metricIds: ['new_customer_second_visit_rate'],
    domain: 'customer_growth',
    defaultThresholds: {
      first_visit_days_min: 7,
      first_visit_days_max: 14,
      no_second_visit_min: 5,
    },
  },
  {
    canonicalIssueId: 'customer_asset_risk',
    reportIssueIds: ['vip_churn_risk', 'stored_value_activation_weak'],
    diagnosisIssueType: 'customer_asset_risk',
    ruleId: 'dormant_customer_reactivation',
    metricIds: ['vip_inactive_count', 'stored_value_inactive_count'],
    domain: 'customer_growth',
    defaultThresholds: {
      days_min: 90,
      days_max: 180,
      min_historical_visit_count: 2,
      min_total_spend: 300,
    },
  },
  {
    canonicalIssueId: 'marketing_ineffective',
    reportIssueIds: ['marketing_conversion_weak', 'marketing_revenue_weak', 'coupon_activation_weak'],
    diagnosisIssueType: 'marketing_ineffective',
    ruleId: 'marketing_conversion_low',
    metricIds: ['campaign_conversion_rate', 'attributed_revenue', 'coupon_used_count'],
    domain: 'customer_growth',
    defaultThresholds: {
      conversion_threshold: 0.25,
      marketingConversionRate: 0.25,
    },
  },
  {
    canonicalIssueId: 'staff_execution_risk',
    reportIssueIds: ['task_closure_weak', 'execution_power_weak', 'training_execution_weak'],
    diagnosisIssueType: 'staff_execution_risk',
    ruleId: 'task_overdue_high',
    metricIds: ['task_overdue_rate', 'task_completion_rate', 'training_completion_rate'],
    domain: 'task_execution',
    defaultThresholds: {
      overdue_rate: 0.2,
      overdue_count: 1,
    },
  },
  {
    canonicalIssueId: 'service_quality_issue',
    reportIssueIds: ['service_quality_issue', 'complaint_risk_up', 'kitchen_quality_issue'],
    diagnosisIssueType: null,
    ruleId: null,
    metricIds: ['service_complaint_rate', 'complaint_rate', 'dish_complaint_rate'],
    domain: 'operation_improvement',
    defaultThresholds: {},
    note: '目前仅报告推理层覆盖，日诊断树尚未单独建规则',
  },
  {
    canonicalIssueId: 'talent_pipeline_weak',
    reportIssueIds: ['skill_certification_weak', 'talent_pipeline_weak'],
    diagnosisIssueType: null,
    ruleId: null,
    metricIds: ['certification_pass_rate', 'promotion_candidate_count'],
    domain: 'talent_development',
    defaultThresholds: {},
    note: '目前仅报告推理层覆盖',
  },
];

const byCanonical = new Map(RULE_IDENTITY_CATALOG.map((row) => [row.canonicalIssueId, row]));
const byReportIssue = new Map();
const byDiagnosisType = new Map();
const byRuleId = new Map();
const byMetricId = new Map();

for (const row of RULE_IDENTITY_CATALOG) {
  for (const id of row.reportIssueIds || []) byReportIssue.set(id, row);
  if (row.diagnosisIssueType) byDiagnosisType.set(row.diagnosisIssueType, row);
  if (row.ruleId) byRuleId.set(row.ruleId, row);
  for (const mid of row.metricIds || []) byMetricId.set(mid, row);
}

export function listRuleIdentities() {
  return RULE_IDENTITY_CATALOG.map((row) => ({
    ...row,
    reportIssueIds: [...(row.reportIssueIds || [])],
    metricIds: [...(row.metricIds || [])],
    defaultThresholds: { ...(row.defaultThresholds || {}) },
  }));
}

export function resolveRuleIdentity(ref = {}) {
  const {
    canonicalIssueId,
    reportIssueId,
    issueId,
    diagnosisIssueType,
    issueType,
    ruleId,
    metricId,
  } = ref;
  if (canonicalIssueId && byCanonical.has(canonicalIssueId)) return byCanonical.get(canonicalIssueId);
  const reportKey = reportIssueId || issueId;
  if (reportKey && byReportIssue.has(reportKey)) return byReportIssue.get(reportKey);
  const diagKey = diagnosisIssueType || issueType;
  if (diagKey && byDiagnosisType.has(diagKey)) return byDiagnosisType.get(diagKey);
  if (ruleId && byRuleId.has(ruleId)) return byRuleId.get(ruleId);
  if (metricId && byMetricId.has(metricId)) return byMetricId.get(metricId);
  return null;
}

export function getDefaultThreshold(ruleIdOrCanonical, thresholdKey, fallback) {
  const row =
    byRuleId.get(ruleIdOrCanonical) ||
    byCanonical.get(ruleIdOrCanonical) ||
    byDiagnosisType.get(ruleIdOrCanonical) ||
    null;
  if (!row) return fallback;
  const val = row.defaultThresholds?.[thresholdKey];
  return val === undefined || val === null ? fallback : val;
}

export function stampInsightIdentity(insight = {}) {
  const identity = resolveRuleIdentity({
    reportIssueId: insight.issueId,
    issueId: insight.issueId,
    metricId: insight.sourceMetrics?.[0],
  });
  if (!identity) {
    return {
      ...insight,
      canonicalIssueId: insight.issueId || null,
      diagnosisIssueType: null,
      ruleId: null,
    };
  }
  return {
    ...insight,
    canonicalIssueId: identity.canonicalIssueId,
    diagnosisIssueType: identity.diagnosisIssueType,
    ruleId: identity.ruleId,
  };
}
