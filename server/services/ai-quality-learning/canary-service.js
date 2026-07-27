import { runForActiveTenants, runWithSystemTenantContext } from '../../utils/database.js';
import { recordCanaryObservation } from './release-candidate-service.js';

export async function monitorActiveCanaries(pool) {
  const active = await runWithSystemTenantContext(() => pool.query(
    `SELECT id, created_at FROM ai_quality_release_candidates
      WHERE status IN ('canary','pending_approval')`
  ));
  const observations = [];
  for (const candidate of active.rows || []) {
    const perTenant = await runForActiveTenants(async (tenantId) => {
      const r = await pool.query(
        `SELECT
           COUNT(*)::int AS samples,
           COUNT(*) FILTER (WHERE t.status <> 'completed')::int AS errors,
           COUNT(*) FILTER (WHERE LOWER(COALESCE(t.quality_metrics->>'safety_violation','false'))='true')::int AS safety_violations,
           AVG((t.quality_metrics->>'total')::numeric)
             FILTER (WHERE t.quality_metrics->>'total' ~ '^[0-9]+(\\.[0-9]+)?$') AS quality_score,
           COUNT(f.id)::int AS feedback_count,
           COUNT(f.id) FILTER (WHERE f.rating < 0)::int AS negative_feedback
         FROM ai_interaction_traces t
         LEFT JOIN ai_feedback_events f
           ON f.tenant_id=t.tenant_id AND f.trace_id=t.trace_id
        WHERE t.tenant_id=$1
          AND t.created_at >= $2
          AND t.business_context->>'quality_release_candidate_id'=$3`,
        [tenantId, candidate.created_at, candidate.id]
      );
      return { tenantId, ...(r.rows[0] || {}) };
    }, { p: pool, continueOnError: true });
    const rows = (perTenant.results || []).filter((row) => row?.ok && Number(row.value?.samples) > 0).map((row) => row.value);
    const total = rows.reduce((sum, row) => sum + Number(row.samples || 0), 0);
    if (total < 20) continue;
    const feedbackCount = rows.reduce((sum, row) => sum + Number(row.feedback_count || 0), 0);
    const qualityWeighted = rows.reduce((sum, row) => sum + Number(row.quality_score || 0) * Number(row.samples || 0), 0);
    const qualitySamples = rows.reduce((sum, row) => sum + (row.quality_score == null ? 0 : Number(row.samples || 0)), 0);
    const metrics = {
      sample_size: total,
      tenant_count: rows.length,
      error_rate: rows.reduce((sum, row) => sum + Number(row.errors || 0), 0) / total,
      safety_violation_rate: rows.reduce((sum, row) => sum + Number(row.safety_violations || 0), 0) / total,
      negative_feedback_rate: feedbackCount
        ? rows.reduce((sum, row) => sum + Number(row.negative_feedback || 0), 0) / feedbackCount
        : null,
      quality_score: qualitySamples ? qualityWeighted / qualitySamples : null,
    };
    const result = await recordCanaryObservation(pool, { candidateId: candidate.id, canaryMetrics: metrics });
    observations.push({
      candidateId: candidate.id,
      metrics,
      status: result.candidate?.status,
      rollback: result.rollback,
    });
  }
  return observations;
}
