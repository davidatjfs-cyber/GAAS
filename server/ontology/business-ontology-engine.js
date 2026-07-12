import { listActionResultMappings } from './action-result-mapping.js';
import { listBusinessDomains } from './business-domains.js';
import { listIssueActionMappings } from './issue-action-mapping.js';
import { listMetricIssueMappings } from './metric-issue-mapping.js';
import { listRuleIdentities, stampInsightIdentity } from './rule-identity.js';

const SEVERITY_RANK = { P1: 3, P2: 2, P3: 1 };

function uniq(values) {
  return [...new Set((values || []).filter(Boolean))];
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function highestSeverity(a, b) {
  return (SEVERITY_RANK[b] || 0) > (SEVERITY_RANK[a] || 0) ? b : a;
}

function numberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function calculateChangeRate(input) {
  if (input?.changeRate !== undefined && input?.changeRate !== null) return input.changeRate;
  const current = numberOrNull(input?.current);
  const previous = numberOrNull(input?.previous);
  if (current === null || previous === null || previous === 0) return null;
  return Math.round(((current - previous) / Math.abs(previous)) * 100);
}

function isTriggered(rule, input) {
  if (!input) return false;
  const current = numberOrNull(input.current);
  const previous = numberOrNull(input.previous);
  const changeRate = numberOrNull(calculateChangeRate(input));

  if (rule.triggerDirection === 'down') {
    return (current !== null && previous !== null && current < previous) || (changeRate !== null && changeRate < 0);
  }
  if (rule.triggerDirection === 'up') {
    return (current !== null && previous !== null && current > previous) || (changeRate !== null && changeRate > 0);
  }
  if (rule.triggerDirection === 'abnormal') {
    return input.abnormal === true || (changeRate !== null && changeRate !== 0);
  }
  return false;
}

function renderEvidence(rule, input) {
  const values = {
    current: input?.current ?? '-',
    previous: input?.previous ?? '-',
    changeRate: calculateChangeRate(input) ?? '-',
    metricName: rule.metricName,
  };
  return String(rule.evidenceTemplate || '{metricName}出现异常')
    .replace(/\{current\}/g, values.current)
    .replace(/\{previous\}/g, values.previous)
    .replace(/\{changeRate\}/g, values.changeRate)
    .replace(/\{metricName\}/g, values.metricName);
}

function actionResultMap() {
  return new Map(listActionResultMappings().map(item => [item.actionType, item.trackingMetrics]));
}

function issueActionMap() {
  return new Map(listIssueActionMappings().map(item => [item.issueId, item.actions]));
}

function buildRecommendedActions(issueId) {
  return (issueActionMap().get(issueId) || []).map(action => ({
    actionId: action.actionId,
    actionName: action.actionName,
    actionType: action.actionType,
    ownerRole: action.ownerRole,
    priority: action.priority,
    deadlineDays: action.defaultDeadlineDays,
    description: action.description,
    executionSteps: action.executionSteps,
    expectedResult: action.expectedResult,
    trackingMetrics: action.trackingMetrics,
  }));
}

function collectTrackingMetrics(rule, actions) {
  const byActionType = actionResultMap();
  const fromActionTypes = actions.flatMap(action => byActionType.get(action.actionType) || []);
  const fromActions = actions.flatMap(action => action.trackingMetrics || []);
  return uniq([...fromActionTypes, ...fromActions, ...(rule.resultMetrics || [])]);
}

function makeInsight(rule, evidence) {
  const recommendedActions = buildRecommendedActions(rule.issueId);
  return {
    domain: rule.domain,
    issueId: rule.issueId,
    issueName: rule.issueName,
    bossLanguageTitle: rule.bossLanguageTitle,
    severity: rule.severity,
    evidence: [evidence],
    possibleCauses: [...(rule.possibleCauses || [])],
    responsibleRoles: [...(rule.responsibleRoles || [])],
    affectedResults: [...(rule.affectedResults || [])],
    resultMetrics: [...(rule.resultMetrics || [])],
    recommendedActions,
    trackingMetrics: collectTrackingMetrics(rule, recommendedActions),
    sourceMetrics: [rule.metricId],
  };
}

function mergeInsight(existing, rule, evidence) {
  existing.severity = highestSeverity(existing.severity, rule.severity);
  existing.evidence = uniq([...existing.evidence, evidence]);
  existing.possibleCauses = uniq([...existing.possibleCauses, ...(rule.possibleCauses || [])]);
  existing.responsibleRoles = uniq([...existing.responsibleRoles, ...(rule.responsibleRoles || [])]);
  existing.affectedResults = uniq([...existing.affectedResults, ...(rule.affectedResults || [])]);
  existing.resultMetrics = uniq([...existing.resultMetrics, ...(rule.resultMetrics || [])]);
  existing.sourceMetrics = uniq([...existing.sourceMetrics, rule.metricId]);
  existing.trackingMetrics = uniq([...existing.trackingMetrics, ...collectTrackingMetrics(rule, existing.recommendedActions)]);
  return existing;
}

export function getBusinessDomains() {
  return listBusinessDomains();
}

export function getMetricIssueMappings(options = {}) {
  return listMetricIssueMappings(options.extraMetricIssueMappings);
}

export function getIssueActionMappings() {
  return listIssueActionMappings();
}

export function getActionResultMappings() {
  return listActionResultMappings();
}

export function inferIssuesFromMetrics(metricsInput = {}, options = {}) {
  const insightsByIssue = new Map();
  const mappings = getMetricIssueMappings(options);

  for (const rule of mappings) {
    const input = metricsInput?.[rule.metricId];
    if (!isTriggered(rule, input)) continue;
    const evidence = renderEvidence(rule, input);
    if (insightsByIssue.has(rule.issueId)) {
      mergeInsight(insightsByIssue.get(rule.issueId), rule, evidence);
    } else {
      insightsByIssue.set(rule.issueId, makeInsight(rule, evidence));
    }
  }

  return [...insightsByIssue.values()]
    .map((insight) => stampInsightIdentity(insight))
    .sort((a, b) => (SEVERITY_RANK[b.severity] || 0) - (SEVERITY_RANK[a.severity] || 0));
}

export function getRuleIdentities() {
  return listRuleIdentities();
}

export function generateActionPlanFromInsights(insights = []) {
  return (insights || []).flatMap(insight => (insight.recommendedActions || []).map(action => ({
    actionName: action.actionName,
    target: insight.issueName,
    ownerRole: action.ownerRole,
    priority: highestSeverity(action.priority, insight.severity),
    deadlineDays: action.deadlineDays,
    expectedResult: action.expectedResult,
    trackingMetrics: uniq([...(action.trackingMetrics || []), ...(insight.trackingMetrics || [])]),
    relatedIssueId: insight.issueId,
    sourceDomain: insight.domain,
    sourceMetrics: [...(insight.sourceMetrics || [])],
    estimated: false,
    groundingStatus: 'source_metrics_available',
  })));
}

export function generateBossSummary(insights = []) {
  if (!insights.length) return '目前没有识别到需要优先处理的经营问题，建议继续观察核心结果和任务闭环。';
  const top = [...insights].sort((a, b) => (SEVERITY_RANK[b.severity] || 0) - (SEVERITY_RANK[a.severity] || 0))[0];
  const action = top.recommendedActions?.[0];
  const roleText = top.responsibleRoles?.length ? `责任对象先看${top.responsibleRoles.join('、')}` : '责任对象需要门店确认';
  const metrics = (top.trackingMetrics || top.resultMetrics || []).slice(0, 3).join('、');
  return `本次最大问题是“${top.bossLanguageTitle}”，对应${top.issueName}。这个问题值得优先处理，因为它会直接影响${(top.affectedResults || top.resultMetrics || ['经营结果']).slice(0, 2).join('、')}。建议先做“${action?.actionName || '生成整改任务'}”，${roleText}，${action?.deadlineDays || 3}天内推进，后续重点看${metrics || '结果变化'}。`;
}

export function enrichReportWithOntology(reportData = {}, metricsInput = {}, options = {}) {
  const ontologyInsights = inferIssuesFromMetrics(metricsInput, options);
  const actionPlan = generateActionPlanFromInsights(ontologyInsights);
  return {
    ...clone(reportData || {}),
    ontologyInsights,
    bossSummary: generateBossSummary(ontologyInsights),
    actionPlan,
    trackingMetrics: uniq(ontologyInsights.flatMap(item => item.trackingMetrics || [])),
    priorityIssues: ontologyInsights.filter(item => item.severity === 'P1' || item.severity === 'P2').map(item => ({
      issueId: item.issueId,
      canonicalIssueId: item.canonicalIssueId || item.issueId,
      diagnosisIssueType: item.diagnosisIssueType || null,
      ruleId: item.ruleId || null,
      issueName: item.issueName,
      severity: item.severity,
      responsibleRoles: item.responsibleRoles,
    })),
  };
}
