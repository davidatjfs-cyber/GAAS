import { runDailyDiagnosis, listIssues } from '../../ontology/diagnosis-tree-service.js';
import { listOpportunities } from '../../ontology/growth-opportunity-service.js';
import { generateTasksForOpportunity, buildTaskDraftsForOpportunity } from '../../ontology/action-plan-service.js';
import { buildClosedLoopReport } from '../../ontology/closed-loop-report-service.js';
import { syncOntologyDataFromProduction } from '../../ontology/real-data-sync.js';

const LOG_PREFIX = '[OntologyToolClient]';

function normalizeParams(options = {}) {
  const tenantId = String(options.tenantId || options.tenant_id || 'default').trim() || 'default';
  const storeId = String(options.storeId || options.store_id || '').trim();
  const date = options.date || new Date().toISOString().slice(0, 10);
  const period = options.period || options.range || '30d';
  return { tenantId, storeId, date, period };
}

function log(message, extra = {}) {
  const extraStr = Object.keys(extra).length ? ' ' + JSON.stringify(extra) : '';
  console.log(`${LOG_PREFIX} ${message}${extraStr}`);
}

function logError(message, error, extra = {}) {
  console.error(`${LOG_PREFIX} ${message}`, error?.message || error, Object.keys(extra).length ? extra : '');
}

export async function getDailyDiagnosis(pool, options) {
  const { tenantId, storeId, date } = normalizeParams(options);
  try {
    await syncOntologyDataFromProduction(pool, tenantId);
    const result = await runDailyDiagnosis(pool, { tenantId, storeId, date });
    log('called runDailyDiagnosis success', { tenantId, storeId, date, issues: result.issues?.length || 0 });
    return { ok: true, data: result };
  } catch (e) {
    logError('runDailyDiagnosis failed', e, { tenantId, storeId, date });
    return { ok: false, error: String(e?.message || e), data: null };
  }
}

export async function getIssues(pool, options) {
  const { tenantId, storeId } = normalizeParams(options);
  try {
    const result = await listIssues(pool, { tenantId, storeId });
    log('called listIssues success', { tenantId, storeId, count: result.length });
    return { ok: true, data: result };
  } catch (e) {
    logError('listIssues failed', e, { tenantId, storeId });
    return { ok: false, error: String(e?.message || e), data: [] };
  }
}

export async function getOpportunities(pool, options) {
  const { tenantId, storeId } = normalizeParams(options);
  try {
    const result = await listOpportunities(pool, { tenantId, storeId });
    log('called listOpportunities success', { tenantId, storeId, count: result.length });
    return { ok: true, data: result };
  } catch (e) {
    logError('listOpportunities failed', e, { tenantId, storeId });
    return { ok: false, error: String(e?.message || e), data: [] };
  }
}

export async function getClosedLoopReport(pool, options) {
  const { tenantId, storeId, period } = normalizeParams(options);
  try {
    const result = await buildClosedLoopReport(pool, { tenantId, storeId, period });
    log('called buildClosedLoopReport success', { tenantId, storeId, period, issues: result.issues?.length || 0 });
    return { ok: true, data: result };
  } catch (e) {
    logError('buildClosedLoopReport failed', e, { tenantId, storeId, period });
    return { ok: false, error: String(e?.message || e), data: null };
  }
}

export async function generateTasksForOpportunityId(pool, opportunityId, options) {
  const { tenantId, storeId } = normalizeParams(options);
  try {
    const result = await generateTasksForOpportunity(pool, opportunityId, { tenantId, storeId });
    log('called generateTasksForOpportunity success', { tenantId, storeId, opportunityId, tasks: result.tasks?.length || 0 });
    return { ok: true, data: result };
  } catch (e) {
    logError('generateTasksForOpportunity failed', e, { tenantId, storeId, opportunityId });
    return { ok: false, error: String(e?.message || e), data: null };
  }
}

export function buildTaskDraftsForOpportunities(opportunities = []) {
  const drafts = [];
  for (const opp of opportunities) {
    const oppDrafts = buildTaskDraftsForOpportunity(opp);
    drafts.push(...oppDrafts);
  }
  return drafts;
}

export async function callOntologyForAgent(pool, options) {
  const params = normalizeParams(options);
  const { tenantId, storeId, date, period } = params;

  log('operation diagnosis started', params);

  const calledApis = [];
  const errors = [];

  const diagnosisResult = await getDailyDiagnosis(pool, { tenantId, storeId, date });
  if (diagnosisResult.ok) calledApis.push('diagnosis/daily');
  else errors.push({ api: 'diagnosis/daily', error: diagnosisResult.error });

  const issuesResult = await getIssues(pool, { tenantId, storeId });
  if (issuesResult.ok) calledApis.push('issues');
  else errors.push({ api: 'issues', error: issuesResult.error });

  const opportunitiesResult = await getOpportunities(pool, { tenantId, storeId });
  if (opportunitiesResult.ok) calledApis.push('opportunities');
  else errors.push({ api: 'opportunities', error: opportunitiesResult.error });

  const closedLoopResult = await getClosedLoopReport(pool, { tenantId, storeId, period });
  if (closedLoopResult.ok) calledApis.push('closed-loop-report');
  else errors.push({ api: 'closed-loop-report', error: closedLoopResult.error });

  const issues = issuesResult.ok ? issuesResult.data : [];
  const opportunities = opportunitiesResult.ok ? opportunitiesResult.data : [];
  const taskDrafts = buildTaskDraftsForOpportunities(opportunities);

  const ontologyAvailable = calledApis.length > 0 && !calledApis.every(api => errors.some(e => e.api === api));
  const _hasData = issues.length > 0 || opportunities.length > 0;

  const evidence = [];
  if (diagnosisResult.ok && diagnosisResult.data) {
    const d = diagnosisResult.data;
    if (typeof d.issues === 'object' && d.issues !== null) {
      evidence.push({ type: 'diagnosis', label: '诊断结果', value: d.ontologyStatus || 'ok', source: 'diagnosis-tree-service' });
    }
  }
  for (const issue of issues.slice(0, 3)) {
    evidence.push({
      type: 'issue',
      label: issue.issue_title || issue.issue_type,
      value: issue.severity || 'P3',
      source: issue.evidence_json?.rule_id ? `rule:${issue.evidence_json.rule_id}` : 'diagnosis-tree-service',
    });
  }
  for (const opp of opportunities.slice(0, 3)) {
    evidence.push({
      type: 'opportunity',
      label: opp.title,
      value: opp.priority || 'P2',
      source: `opportunity:${opp.opportunity_id}`,
    });
  }
  if (closedLoopResult.ok && closedLoopResult.data) {
    const r = closedLoopResult.data;
    if (r.attributionSummary?.attributedRevenue > 0) {
      evidence.push({
        type: 'attribution',
        label: '归因营业额',
        value: r.attributionSummary.attributedRevenue.toFixed(0),
        source: 'closed-loop-report',
      });
    }
    if (Array.isArray(r.tasks) && r.tasks.length > 0) {
      evidence.push({
        type: 'task',
        label: '已生成任务数',
        value: r.tasks.length,
        source: 'closed-loop-report',
      });
    }
  }

  const result = {
    diagnosis: diagnosisResult.ok ? diagnosisResult.data : null,
    issues,
    opportunities,
    closedLoopReport: closedLoopResult.ok ? closedLoopResult.data : null,
    taskDrafts,
    evidence,
    raw: {
      diagnosis: diagnosisResult.data,
      issues: issuesResult.data,
      opportunities: opportunitiesResult.data,
      closedLoopReport: closedLoopResult.data,
    },
    ontologyAvailable,
    calledApis,
    errors: errors.length ? errors : undefined,
    issuesCount: issues.length,
    opportunitiesCount: opportunities.length,
    generatedAt: new Date().toISOString(),
  };

  log('ontology data fetched', {
    tenantId,
    storeId,
    date,
    issues: issues.length,
    opportunities: opportunities.length,
    taskDrafts: taskDrafts.length,
    ontologyAvailable,
    calledApis,
  });

  return result;
}
