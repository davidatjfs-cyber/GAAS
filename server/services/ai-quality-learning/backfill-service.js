import { resolveTenantIdDefault } from '../../utils/database.js';
import {
  feedbackLabel,
  materializeLearningCandidate,
  recordAiFeedback,
  recordAiInteraction,
} from './trace-feedback-service.js';

export async function backfillTenantLearningSignals(pool, tenantId = null) {
  const tid = resolveTenantIdDefault(tenantId);
  let traced = 0;
  let feedback = 0;
  const policyR = await pool.query(
    `SELECT retention_days FROM ai_learning_policies WHERE tenant_id=$1 LIMIT 1`,
    [tid]
  );
  const retentionDays = Math.max(30, Math.min(1095, Number(policyR.rows[0]?.retention_days) || 365));
  await pool.query(
    `UPDATE ai_interaction_traces
        SET actor_id=NULL, business_context='{}'::jsonb
      WHERE tenant_id=$1 AND created_at < NOW()-make_interval(days => $2)
        AND (actor_id IS NOT NULL OR business_context <> '{}'::jsonb)`,
    [tid, retentionDays]
  );
  await pool.query(
    `UPDATE ai_feedback_events SET actor_id=NULL, note=NULL
      WHERE tenant_id=$1 AND created_at < NOW()-make_interval(days => $2)
        AND (actor_id IS NOT NULL OR note IS NOT NULL)`,
    [tid, retentionDays]
  );
  await pool.query(
    `UPDATE ai_learning_candidates SET status='archived'
      WHERE tenant_id=$1 AND created_at < NOW()-make_interval(days => $2)
        AND status='eligible'`,
    [tid, retentionDays]
  );
  await pool.query(
    `UPDATE agent_quality_audits
        SET username='', query_text='[RETAINED_HASH_ONLY]', response_text='[RETAINED_HASH_ONLY]'
      WHERE tenant_id=$1 AND created_at < NOW()-make_interval(days => $2)
        AND response_text <> '[RETAINED_HASH_ONLY]'`,
    [tid, retentionDays]
  );
  await pool.query(
    `UPDATE diagnosis_feedback
        SET user_key='[anonymized]', query_text='[RETAINED_HASH_ONLY]',
            diagnosis='[RETAINED_HASH_ONLY]', feedback_note=NULL
      WHERE tenant_id=$1 AND created_at < NOW()-make_interval(days => $2)
        AND diagnosis <> '[RETAINED_HASH_ONLY]'`,
    [tid, retentionDays]
  );
  const audits = await pool.query(
    `SELECT id, route, username, query_text, response_text, audit_result, passed, rewrite_count, created_at
       FROM agent_quality_audits
      WHERE tenant_id=$1 AND trace_id IS NULL AND created_at >= NOW()-INTERVAL '30 days'
      ORDER BY created_at ASC LIMIT 500`,
    [tid]
  );
  for (const row of audits.rows || []) {
    const traceId = await recordAiInteraction(pool, {
      source: 'agent_quality_audit', sourceRecordId: row.id, route: row.route,
      purpose: 'user_response', actorId: row.username, input: row.query_text,
      output: row.response_text, qualityMetrics: {
        ...(row.audit_result || {}), passed: row.passed, rewrite_count: row.rewrite_count,
      }, tenantId: tid,
    });
    await pool.query(
      `UPDATE agent_quality_audits SET trace_id=$1 WHERE id=$2 AND tenant_id=$3 AND trace_id IS NULL`,
      [traceId, row.id, tid]
    );
    traced += 1;
    await recordAiFeedback(pool, {
      traceId, actorId: 'quality_gate', feedbackType: 'quality_audit',
      rating: row.passed === true ? 1 : -1,
      idempotencyKey: `quality-audit:${row.id}`, input: row.query_text,
      output: row.response_text, tenantId: tid,
    });
    feedback += 1;
  }

  const diagnoses = await pool.query(
    `SELECT id, task_id, user_key, query_text, diagnosis, feedback, feedback_note, metrics_used, created_at
       FROM diagnosis_feedback
      WHERE tenant_id=$1 AND trace_id IS NULL AND feedback IS NOT NULL
        AND created_at >= NOW()-INTERVAL '90 days'
      ORDER BY created_at ASC LIMIT 500`,
    [tid]
  );
  for (const row of diagnoses.rows || []) {
    const traceId = await recordAiInteraction(pool, {
      source: 'diagnosis_feedback', sourceRecordId: row.id, route: 'data_diagnosis',
      purpose: 'diagnosis', actorId: row.user_key, input: row.query_text || row.feedback_note || row.task_id,
      output: row.diagnosis, businessContext: { metrics_used: row.metrics_used || [] }, tenantId: tid,
    });
    await pool.query(
      `UPDATE diagnosis_feedback SET trace_id=$1 WHERE id=$2 AND tenant_id=$3 AND trace_id IS NULL`,
      [traceId, row.id, tid]
    );
    traced += 1;
    await recordAiFeedback(pool, {
      traceId, actorId: row.user_key, feedbackType: 'user_rating',
      rating: Number(row.feedback) === 1 ? 1 : -1,
      note: row.feedback_note || '', idempotencyKey: `diagnosis:${row.id}`,
      input: row.query_text || row.feedback_note || row.task_id, output: row.diagnosis, tenantId: tid,
    });
    feedback += 1;
  }
  const pending = await pool.query(
    `SELECT f.id, f.trace_id, f.feedback_type, f.rating, f.business_outcome
       FROM ai_feedback_events f
      WHERE f.tenant_id=$1 AND f.rating IN (-1,1)
        AND NOT EXISTS (
          SELECT 1 FROM ai_learning_candidates c
           WHERE c.tenant_id=f.tenant_id AND c.source_feedback_id=f.id
        )
      ORDER BY f.created_at ASC LIMIT 500`,
    [tid]
  );
  let materialized = 0;
  for (const row of pending.rows || []) {
    const candidate = await materializeLearningCandidate(pool, {
      traceId: row.trace_id,
      feedbackId: row.id,
      label: feedbackLabel(row.feedback_type, row.rating),
      labelScore: row.rating,
      businessOutcome: row.business_outcome || {},
      tenantId: tid,
    });
    if (candidate.created) materialized += 1;
  }
  return { tenantId: tid, traced, feedback, materialized };
}
