import { listOpportunities } from './growth-opportunity-service.js';
import { summarizeIssueForBoss } from './boss-language-service.js';
import { childLogger } from '../utils/logger.js';
import {
  loadDiagnosisRulesSafe,
  loadDiagnosisThresholds,
  resolveDiagnosisWindow,
  fetchDiagnosisStats,
  buildDiagnosisIssues,
  supersedeOpenDiagnosisRecords,
  persistDiagnosisIssues,
} from './run-daily-diagnosis-helpers.js';

const log = childLogger({ domain: 'ontology', handler: 'diagnosis-tree' });

export async function runDailyDiagnosis(pool, options = {}) {
  const tenantId = options.tenantId || options.tenant_id || 'default';
  const storeId = options.storeId || options.store_id || '';
  const date = options.date || new Date().toISOString().slice(0, 10);
  if (!storeId) {
    return { ontologyStatus: 'insufficient_data', missingFields: ['store_id'], issues: [], opportunities: [] };
  }

  const window = resolveDiagnosisWindow(date);
  const ruleState = await loadDiagnosisRulesSafe(pool, { tenantId, storeId });
  const thresholds = await loadDiagnosisThresholds(pool, { tenantId, storeId });
  const stats = await fetchDiagnosisStats(pool, { tenantId, storeId, date, thresholds, window });
  const { issues, dataGaps } = await buildDiagnosisIssues(pool, {
    tenantId, storeId, date, rules: ruleState.byId, thresholds, stats,
  });

  await supersedeOpenDiagnosisRecords(pool, { tenantId, storeId });
  const { savedIssues, opportunities } = await persistDiagnosisIssues(pool, {
    tenantId, storeId, issues, rules: ruleState.byId, thresholds,
  });

  log.info({ msg: 'daily_diagnosis_generated' });
  log.info({ msg: 'issues_generated' });
  log.info({ msg: 'opportunities_generated' });
  return {
    ontologyStatus: savedIssues.length ? 'ok' : 'no_issue_detected',
    issues: savedIssues,
    opportunities,
    dataGaps,
    marketingStats: {
      touched: stats.marketing.touched,
      returned: stats.marketing.returned,
      conversionRate: stats.marketing.conversionRate,
      evaluated: stats.marketing.touched > 0,
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
