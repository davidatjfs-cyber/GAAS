import { runForActiveTenants, runWithSystemTenantContext } from '../../utils/database.js';
import { childLogger } from '../../utils/logger.js';
import { backfillTenantLearningSignals } from './backfill-service.js';
import { monitorActiveCanaries } from './canary-service.js';
import { ensureContractAuthorizedLearningPolicies } from './contract-policy-service.js';
import { buildEvaluationDataset, generateImprovementProposals } from './dataset-service.js';
import { sanitizeJson } from './redaction-service.js';

const log = childLogger({ domain: 'ai-quality-learning' });

export async function runAiQualityLearningCycle(pool, {
  generateCandidate = null,
  evaluateCandidate = null,
  triggerType = 'scheduler',
} = {}) {
  const run = await runWithSystemTenantContext(() => pool.query(
    `INSERT INTO ai_learning_cycle_runs (status,trigger_type) VALUES ('running',$1) RETURNING id,started_at`,
    [String(triggerType || 'scheduler').slice(0, 30)]
  ));
  const runId = run.rows[0].id;
  try {
    const policySync = await ensureContractAuthorizedLearningPolicies(pool);
    const tenantRun = await runForActiveTenants(
      (tenantId) => backfillTenantLearningSignals(pool, tenantId),
      { p: pool, continueOnError: true }
    );
    const dataset = await buildEvaluationDataset(pool);
    const proposals = dataset.created
      ? await generateImprovementProposals(pool, {
        datasetId: dataset.datasetId,
        datasetVersion: dataset.version,
        generateCandidate,
        evaluateCandidate,
      })
      : [];
    const canaries = await monitorActiveCanaries(pool);
    const values = (tenantRun.results || []).filter((item) => item?.ok).map((item) => item.value || {});
    const totals = values.reduce((acc, item) => ({
      traced: acc.traced + Number(item.traced || 0),
      feedback: acc.feedback + Number(item.feedback || 0),
      materialized: acc.materialized + Number(item.materialized || 0),
    }), { traced: 0, feedback: 0, materialized: 0 });
    const promoted = canaries.filter((item) => item.status === 'approved').length;
    const rolledBack = canaries.filter((item) => item.status === 'rolled_back').length;
    await runWithSystemTenantContext(() => pool.query(
      `UPDATE ai_learning_cycle_runs SET
         status='completed', tenant_count=$2, trace_count=$3, feedback_count=$4,
         candidate_count=$5, dataset_id=$6, dataset_version=$7,
         proposal_count=$8, canary_count=$9, promoted_count=$10,
         rolled_back_count=$11, error_count=$12, error_summary=$13::jsonb,
         completed_at=NOW()
       WHERE id=$1`,
      [runId, policySync.activeTenants || values.length, totals.traced, totals.feedback,
        totals.materialized, dataset.datasetId || null, dataset.version || null,
        proposals.length, canaries.length, promoted, rolledBack,
        tenantRun.errors?.length || 0, JSON.stringify(sanitizeJson(tenantRun.errors || []))]
    ));
    return { runId, policySync, tenantRun, dataset, proposals, canaries, completedAt: new Date().toISOString() };
  } catch (error) {
    await runWithSystemTenantContext(() => pool.query(
      `UPDATE ai_learning_cycle_runs SET status='failed',error_count=1,
         error_summary=$2::jsonb,completed_at=NOW() WHERE id=$1`,
      [runId, JSON.stringify([{ message: String(error?.message || error).slice(0, 500) }])]
    )).catch(() => {});
    throw error;
  }
}

export function startAiQualityLearningScheduler(pool, {
  initialDelayMs = 120000,
  intervalMs = 24 * 60 * 60 * 1000,
  generateCandidate = null,
  evaluateCandidate = null,
} = {}) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const result = await runAiQualityLearningCycle(pool, { generateCandidate, evaluateCandidate });
      log.info({ msg: 'cycle_complete', dataset: result.dataset, proposals: result.proposals?.length || 0, canaries: result.canaries?.length || 0, errors: result.tenantRun?.errors?.length || 0 });
    } catch (error) {
      log.error({ msg: 'cycle_failed', err: error?.message || String(error) });
    } finally {
      running = false;
    }
  };
  const initialTimer = setTimeout(tick, Math.max(1000, initialDelayMs));
  const intervalTimer = setInterval(tick, Math.max(60000, intervalMs));
  return () => {
    clearTimeout(initialTimer);
    clearInterval(intervalTimer);
  };
}
