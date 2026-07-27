import crypto from 'node:crypto';
import { resolveTenantIdDefault } from '../../utils/database.js';
import { redactLearningText, sanitizeJson, sha256 } from './redaction-service.js';

const PURPOSE_RE = /^[a-zA-Z0-9_.:-]{1,80}$/;

export async function recordAiInteraction(pool, {
  source,
  sourceRecordId = null,
  route = null,
  purpose = null,
  actorId = null,
  modelProvider = null,
  modelName = null,
  promptVersion = null,
  input = '',
  output = '',
  status = 'completed',
  latencyMs = null,
  inputTokens = null,
  outputTokens = null,
  qualityMetrics = {},
  businessContext = {},
  tenantId = null,
} = {}) {
  const tid = resolveTenantIdDefault(tenantId);
  const src = String(source || '').trim();
  if (!src) throw new Error('ai_trace_source_required');
  const normalizedPurpose = PURPOSE_RE.test(String(purpose || '')) ? String(purpose) : null;
  const r = await pool.query(
    `INSERT INTO ai_interaction_traces (
       tenant_id, source, source_record_id, route, purpose, actor_id,
       model_provider, model_name, prompt_version, input_hash, output_hash,
       status, latency_ms, input_tokens, output_tokens, quality_metrics, business_context
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17::jsonb)
     ON CONFLICT (tenant_id, source, source_record_id)
     DO UPDATE SET
       output_hash = EXCLUDED.output_hash,
       status = EXCLUDED.status,
       latency_ms = COALESCE(EXCLUDED.latency_ms, ai_interaction_traces.latency_ms),
       quality_metrics = ai_interaction_traces.quality_metrics || EXCLUDED.quality_metrics,
       business_context = ai_interaction_traces.business_context || EXCLUDED.business_context
     RETURNING trace_id`,
    [
      tid, src, sourceRecordId == null ? null : String(sourceRecordId), String(route || '') || null,
      normalizedPurpose, String(actorId || '') || null, String(modelProvider || '') || null,
      String(modelName || '') || null, String(promptVersion || '') || null, sha256(input),
      output ? sha256(output) : null, String(status || 'completed'),
      Number.isFinite(Number(latencyMs)) ? Number(latencyMs) : null,
      Number.isFinite(Number(inputTokens)) ? Number(inputTokens) : null,
      Number.isFinite(Number(outputTokens)) ? Number(outputTokens) : null,
      JSON.stringify(sanitizeJson(qualityMetrics) || {}), JSON.stringify(sanitizeJson(businessContext) || {}),
    ]
  );
  return r.rows[0]?.trace_id || null;
}

async function loadTraceSourceText(pool, tenantId, traceId) {
  const audit = await pool.query(
    `SELECT query_text AS input, response_text AS output
       FROM agent_quality_audits
      WHERE tenant_id=$1 AND trace_id=$2 LIMIT 1`,
    [tenantId, traceId]
  );
  if (audit.rows[0]) return audit.rows[0];
  const diagnosis = await pool.query(
    `SELECT COALESCE(NULLIF(query_text, ''), feedback_note, '') AS input, diagnosis AS output
       FROM diagnosis_feedback
      WHERE tenant_id=$1 AND trace_id=$2 LIMIT 1`,
    [tenantId, traceId]
  );
  if (diagnosis.rows[0]) return diagnosis.rows[0];
  const message = await pool.query(
    `SELECT COALESCE(agent_data->>'query', agent_data->>'text', '') AS input,
            COALESCE(NULLIF(content, ''), agent_response, '') AS output
       FROM agent_messages m
       JOIN ai_interaction_traces t
         ON t.tenant_id=$1 AND t.trace_id=$2
        AND t.source='agent_message' AND t.source_record_id=m.id::text
      WHERE m.tenant_id=$1
      LIMIT 1`,
    [tenantId, traceId]
  );
  return message.rows[0] || { input: '', output: '' };
}

export function feedbackLabel(feedbackType, rating) {
  if (feedbackType === 'business_outcome') return Number(rating) > 0 ? 'business_win' : 'business_loss';
  if (feedbackType === 'quality_audit') return Number(rating) > 0 ? 'audit_pass' : 'audit_fail';
  return Number(rating) > 0 ? 'helpful' : 'unhelpful';
}

export async function materializeLearningCandidate(pool, {
  traceId,
  feedbackId,
  input,
  output,
  label,
  labelScore,
  businessOutcome = {},
  tenantId = null,
} = {}) {
  const tid = resolveTenantIdDefault(tenantId);
  const policyR = await pool.query(
    `SELECT platform_learning_enabled, allowed_purposes
       FROM ai_learning_policies
      WHERE tenant_id=$1
        AND authorization_basis='contract'
        AND NULLIF(TRIM(agreement_reference),'') IS NOT NULL
      LIMIT 1`,
    [tid]
  );
  const policy = policyR.rows[0];
  if (!policy?.platform_learning_enabled) return { created: false, reason: 'platform_learning_not_enabled' };

  const traceR = await pool.query(
    `SELECT route, purpose FROM ai_interaction_traces WHERE tenant_id=$1 AND trace_id=$2 LIMIT 1`,
    [tid, traceId]
  );
  const trace = traceR.rows[0];
  if (!trace) return { created: false, reason: 'trace_not_found' };
  const allowed = Array.isArray(policy.allowed_purposes) ? policy.allowed_purposes : [];
  if (allowed.length && !allowed.includes(trace.purpose) && !allowed.includes('*')) {
    return { created: false, reason: 'purpose_not_allowed' };
  }

  const source = (input == null || output == null)
    ? await loadTraceSourceText(pool, tid, traceId)
    : { input, output };
  const cleanInput = redactLearningText(source.input);
  const cleanOutput = redactLearningText(source.output);
  if (!cleanInput.text.trim() || !cleanOutput.text.trim()) return { created: false, reason: 'empty_after_redaction' };

  const pseudonymKey = String(process.env.AI_LEARNING_PSEUDONYM_KEY || '').trim();
  if (!pseudonymKey) throw new Error('AI_LEARNING_PSEUDONYM_KEY_required');
  const pseudonym = crypto.createHmac('sha256', pseudonymKey).update(tid).digest('hex');
  const redactionReport = {
    input: cleanInput.report,
    output: cleanOutput.report,
    sanitizer_version: 1,
  };
  const r = await pool.query(
    `INSERT INTO ai_learning_candidates (
       tenant_id, source_trace_id, source_feedback_id, source_tenant_pseudonym,
       route, purpose, sanitized_input, sanitized_output, label, label_score,
       business_outcome, redaction_report
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb)
     ON CONFLICT (tenant_id, source_trace_id, label)
     DO UPDATE SET
       source_feedback_id=EXCLUDED.source_feedback_id,
       label_score=EXCLUDED.label_score,
       business_outcome=EXCLUDED.business_outcome,
       redaction_report=EXCLUDED.redaction_report,
       status='eligible', withdrawn_at=NULL
     RETURNING id`,
    [
      tid, traceId, feedbackId || null, pseudonym, trace.route, trace.purpose,
      cleanInput.text, cleanOutput.text, String(label || 'unlabeled'),
      Number.isFinite(Number(labelScore)) ? Number(labelScore) : null,
      JSON.stringify(sanitizeJson(businessOutcome) || {}), JSON.stringify(redactionReport),
    ]
  );
  return { created: true, candidateId: r.rows[0]?.id };
}

export async function recordAiFeedback(pool, {
  traceId,
  actorId = null,
  feedbackType = 'user_rating',
  rating = null,
  note = '',
  businessOutcome = {},
  idempotencyKey = null,
  input = null,
  output = null,
  tenantId = null,
} = {}) {
  const tid = resolveTenantIdDefault(tenantId);
  if (!traceId) throw new Error('trace_id_required');
  const numericRating = rating == null ? null : Number(rating);
  if (numericRating != null && ![-1, 0, 1].includes(numericRating)) throw new Error('invalid_rating');
  const cleanNote = redactLearningText(note).text.slice(0, 1000);
  const r = await pool.query(
    `INSERT INTO ai_feedback_events (
       trace_id, tenant_id, actor_id, feedback_type, rating, note,
       business_outcome, idempotency_key
     ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)
     ON CONFLICT (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL
     DO UPDATE SET rating=EXCLUDED.rating, note=EXCLUDED.note,
                   business_outcome=EXCLUDED.business_outcome
     RETURNING id`,
    [
      traceId, tid, String(actorId || '') || null, String(feedbackType || 'user_rating'),
      numericRating, cleanNote, JSON.stringify(sanitizeJson(businessOutcome) || {}),
      idempotencyKey == null ? null : String(idempotencyKey).slice(0, 160),
    ]
  );
  const feedbackId = r.rows[0]?.id;
  let candidate = { created: false, reason: 'unlabeled_feedback' };
  if (numericRating === -1 || numericRating === 1) {
    candidate = await materializeLearningCandidate(pool, {
      traceId,
      feedbackId,
      input,
      output,
      label: feedbackLabel(feedbackType, numericRating),
      labelScore: numericRating,
      businessOutcome,
      tenantId: tid,
    });
  }
  return { feedbackId, candidate };
}
