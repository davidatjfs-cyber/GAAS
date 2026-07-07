import { generateActionPlanFromInsights, inferIssuesFromMetrics } from './business-ontology-engine.js';

function addDays(date, days) {
  const d = new Date(date.getTime());
  d.setDate(d.getDate() + Number(days || 3));
  return d;
}

export function createTaskDraftsFromOntologyInsights(insightsOrMetrics, options = {}) {
  const insights = Array.isArray(insightsOrMetrics)
    ? insightsOrMetrics
    : inferIssuesFromMetrics(insightsOrMetrics || {}, options);
  const now = options.now ? new Date(options.now) : new Date();
  const actionPlan = generateActionPlanFromInsights(insights);

  return actionPlan.map(action => ({
    title: action.actionName,
    description: `${action.target}：${action.expectedResult}`,
    ownerRole: action.ownerRole,
    priority: action.priority,
    dueDate: addDays(now, action.deadlineDays).toISOString(),
    expectedResult: action.expectedResult,
    trackingMetrics: action.trackingMetrics,
    sourceIssueId: action.relatedIssueId,
    sourceDomain: action.sourceDomain,
    status: 'draft',
  }));
}
