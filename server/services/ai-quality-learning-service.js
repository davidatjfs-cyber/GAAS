import crypto from 'node:crypto';
import {
  resolveTenantIdDefault,
  runForActiveTenants,
  runWithSystemTenantContext,
} from '../utils/database.js';

const MAX_LEARNING_TEXT = 6000;
const PURPOSE_RE = /^[a-zA-Z0-9_.:-]{1,80}$/;

function sha256(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

export function redactLearningText(value) {
  let text = String(value || '').slice(0, MAX_LEARNING_TEXT);
  const counts = {};
  const replace = (name, pattern, replacement) => {
    let count = 0;
    text = text.replace(pattern, (...args) => {
      count += 1;
      return typeof replacement === 'function' ? replacement(...args) : replacement;
    });
    if (count) counts[name] = count;
  };
  replace('authorization', /\b(?:bearer|basic)\s+[a-z0-9._~+/=-]{8,}\b/gi, '[AUTH_REDACTED]');
  replace('secret', /\b(?:api[_-]?key|secret|token|password|passwd)\s*[:=]\s*[^\s,;，。]{4,}/gi, '[SECRET_REDACTED]');
  replace('id_card', /\b\d{17}[0-9Xx]\b/g, '[ID_REDACTED]');
  replace('phone', /(?<!\d)(?:\+?86[- ]?)?1[3-9]\d{9}(?!\d)/g, '[PHONE_REDACTED]');
  replace('email', /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[EMAIL_REDACTED]');
  replace('bank_card', /(?<!\d)\d{16,19}(?!\d)/g, '[BANK_REDACTED]');
  replace('open_id', /\b(?:ou_|on_|oc_|cli_)[a-z0-9_-]{12,}\b/gi, '[EXTERNAL_ID_REDACTED]');
  return { text, report: { replacements: counts, truncated: String(value || '').length > MAX_LEARNING_TEXT } };
}

function sanitizeJson(value, depth = 0) {
  if (depth > 5 || value == null) return value == null ? null : '[DEPTH_LIMIT]';
  if (typeof value === 'string') return redactLearningText(value).text;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitizeJson(item, depth + 1));
  if (typeof value !== 'object') return String(value);
  const result = {};
  for (const [key, item] of Object.entries(value).slice(0, 100)) {
    if (/password|secret|token|api[_-]?key|authorization/i.test(key)) {
      result[key] = '[SECRET_REDACTED]';
    } else {
      result[key] = sanitizeJson(item, depth + 1);
    }
  }
  return result;
}

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

function feedbackLabel(feedbackType, rating) {
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
       FROM ai_learning_policies WHERE tenant_id=$1 LIMIT 1`,
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

export async function upsertLearningPolicy(pool, {
  enabled,
  allowedPurposes = [],
  retentionDays = 365,
  maxDailyContributions = 100,
  updatedBy = '',
  tenantId = null,
} = {}) {
  const tid = resolveTenantIdDefault(tenantId);
  if (enabled === true && !String(process.env.AI_LEARNING_PSEUDONYM_KEY || '').trim()) {
    throw new Error('AI_LEARNING_PSEUDONYM_KEY_required_before_opt_in');
  }
  const purposes = [...new Set((Array.isArray(allowedPurposes) ? allowedPurposes : [])
    .map((v) => String(v || '').trim()).filter((v) => v === '*' || PURPOSE_RE.test(v)))];
  const r = await pool.query(
    `INSERT INTO ai_learning_policies (
       tenant_id, platform_learning_enabled, allowed_purposes, retention_days,
       max_daily_contributions, updated_by
     ) VALUES ($1,$2,$3::text[],$4,$5,$6)
     ON CONFLICT (tenant_id) DO UPDATE SET
       platform_learning_enabled=EXCLUDED.platform_learning_enabled,
       allowed_purposes=EXCLUDED.allowed_purposes,
       retention_days=EXCLUDED.retention_days,
       max_daily_contributions=EXCLUDED.max_daily_contributions,
       policy_version=ai_learning_policies.policy_version+1,
       updated_by=EXCLUDED.updated_by,
       updated_at=NOW()
     RETURNING *`,
    [
      tid, enabled === true, purposes,
      Math.max(30, Math.min(1095, Number(retentionDays) || 365)),
      Math.max(1, Math.min(1000, Number(maxDailyContributions) || 100)),
      String(updatedBy || '').slice(0, 120),
    ]
  );
  const policy = r.rows[0];
  await pool.query(
    `INSERT INTO ai_learning_policy_events (
       tenant_id, policy_version, platform_learning_enabled, allowed_purposes,
       retention_days, max_daily_contributions, changed_by
     ) VALUES ($1,$2,$3,$4::text[],$5,$6,$7)`,
    [tid, policy.policy_version, policy.platform_learning_enabled, policy.allowed_purposes,
      policy.retention_days, policy.max_daily_contributions, policy.updated_by]
  );
  if (enabled !== true) {
    await runWithSystemTenantContext(async () => {
      const affected = await pool.query(
        `SELECT DISTINCT i.dataset_id
           FROM ai_evaluation_dataset_items i
           JOIN ai_learning_candidates c ON c.id=i.candidate_id
          WHERE c.tenant_id=$1`,
        [tid]
      );
      await pool.query(
        `DELETE FROM ai_evaluation_dataset_items i
          USING ai_learning_candidates c
         WHERE i.candidate_id=c.id AND c.tenant_id=$1`,
        [tid]
      );
      await pool.query(
        `UPDATE ai_learning_candidates SET status='withdrawn', withdrawn_at=NOW()
          WHERE tenant_id=$1 AND status <> 'withdrawn'`,
        [tid]
      );
      for (const row of affected.rows || []) {
        await pool.query(
          `UPDATE ai_evaluation_datasets d SET
             status='invalidated_consent',
             item_count=(SELECT COUNT(*)::int FROM ai_evaluation_dataset_items i WHERE i.dataset_id=d.id),
             tenant_count=(SELECT COUNT(DISTINCT source_tenant_pseudonym)::int FROM ai_evaluation_dataset_items i WHERE i.dataset_id=d.id)
           WHERE d.id=$1`,
          [row.dataset_id]
        );
      }
    });
  }
  return policy;
}

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

export async function buildEvaluationDataset(pool, {
  maxPerTenant = 100,
  lookbackDays = 180,
  version = null,
} = {}) {
  return runWithSystemTenantContext(async () => {
    const candidates = await pool.query(
      `SELECT c.*, p.max_daily_contributions
         FROM ai_learning_candidates c
         JOIN ai_learning_policies p ON p.tenant_id=c.tenant_id
        WHERE c.status='eligible'
          AND p.platform_learning_enabled=TRUE
          AND c.created_at >= NOW()-make_interval(days => $1)
        ORDER BY c.tenant_id, c.created_at DESC`,
      [Math.max(1, Math.min(730, Number(lookbackDays) || 180))]
    );
    const counts = new Map();
    const selected = [];
    for (const row of candidates.rows || []) {
      const cap = Math.min(Number(maxPerTenant) || 100, Number(row.max_daily_contributions) || 100);
      const used = counts.get(row.tenant_id) || 0;
      if (used >= cap) continue;
      counts.set(row.tenant_id, used + 1);
      selected.push(row);
    }
    if (!selected.length) return { created: false, reason: 'no_eligible_candidates' };
    const datasetVersion = version || `auto-${new Date().toISOString().replace(/[-:]/g, '').slice(0, 13)}Z`;
    const contentHash = sha256(selected.map((row) => row.id).sort().join('|'));
    const dataset = await pool.query(
      `INSERT INTO ai_evaluation_datasets (
         version, item_count, tenant_count, selection_policy, content_hash
       ) VALUES ($1,$2,$3,$4::jsonb,$5)
       ON CONFLICT (version) DO UPDATE SET
         item_count=EXCLUDED.item_count, tenant_count=EXCLUDED.tenant_count,
         selection_policy=EXCLUDED.selection_policy, content_hash=EXCLUDED.content_hash
       RETURNING id, version`,
      [
        datasetVersion, selected.length, counts.size,
        JSON.stringify({ max_per_tenant: Number(maxPerTenant) || 100, lookback_days: Number(lookbackDays) || 180, balanced_by_tenant: true }),
        contentHash,
      ]
    );
    const datasetId = dataset.rows[0].id;
    for (const row of selected) {
      await pool.query(
        `INSERT INTO ai_evaluation_dataset_items (
           dataset_id, candidate_id, source_tenant_pseudonym, route,
           sanitized_input, sanitized_output, expected_label, label_score
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (dataset_id, candidate_id) DO NOTHING`,
        [datasetId, row.id, row.source_tenant_pseudonym, row.route,
          row.sanitized_input, row.sanitized_output, row.label, row.label_score]
      );
    }
    return { created: true, datasetId, version: dataset.rows[0].version, itemCount: selected.length, tenantCount: counts.size };
  });
}

function metric(metrics, key) {
  const n = Number(metrics?.[key]);
  return Number.isFinite(n) ? n : null;
}

export function evaluateReleaseGate(baseline = {}, candidate = {}, {
  minSamples = 100,
  minTenants = 3,
} = {}) {
  const checks = [];
  const add = (key, passed, detail) => checks.push({ key, passed: passed === true, detail });
  const samples = metric(candidate, 'sample_size');
  const tenants = metric(candidate, 'tenant_count');
  const baseQuality = metric(baseline, 'quality_score');
  const candQuality = metric(candidate, 'quality_score');
  const baseGround = metric(baseline, 'groundedness');
  const candGround = metric(candidate, 'groundedness');
  const baseSafety = metric(baseline, 'safety_violation_rate');
  const candSafety = metric(candidate, 'safety_violation_rate');
  const baseNegative = metric(baseline, 'negative_feedback_rate');
  const candNegative = metric(candidate, 'negative_feedback_rate');
  const baseLatency = metric(baseline, 'p95_latency_ms');
  const candLatency = metric(candidate, 'p95_latency_ms');
  add('sample_size', samples != null && samples >= minSamples, { actual: samples, minimum: minSamples });
  add('tenant_diversity', tenants != null && tenants >= minTenants, { actual: tenants, minimum: minTenants });
  add('quality_lift', baseQuality != null && candQuality != null && candQuality >= baseQuality + 0.02, { baseline: baseQuality, candidate: candQuality, minimum_lift: 0.02 });
  add('groundedness_non_regression', baseGround != null && candGround != null && candGround >= baseGround, { baseline: baseGround, candidate: candGround });
  add('safety_non_regression', baseSafety != null && candSafety != null && candSafety <= baseSafety && candSafety <= 0.01, { baseline: baseSafety, candidate: candSafety, ceiling: 0.01 });
  add('negative_feedback_non_regression', baseNegative != null && candNegative != null && candNegative <= baseNegative, { baseline: baseNegative, candidate: candNegative });
  add('latency_budget', baseLatency != null && candLatency != null && candLatency <= Math.max(baseLatency * 1.2, baseLatency + 200), { baseline: baseLatency, candidate: candLatency });
  return { passed: checks.every((check) => check.passed), checks };
}

export function shouldRollbackCanary(baseline = {}, canary = {}) {
  const reasons = [];
  const compareHigherBad = (key, allowance = 0) => {
    const before = metric(baseline, key);
    const after = metric(canary, key);
    if (before != null && after != null && after > before + allowance) reasons.push({ key, baseline: before, canary: after });
  };
  compareHigherBad('safety_violation_rate', 0);
  compareHigherBad('negative_feedback_rate', 0.03);
  compareHigherBad('error_rate', 0.01);
  const beforeQuality = metric(baseline, 'quality_score');
  const afterQuality = metric(canary, 'quality_score');
  if (beforeQuality != null && afterQuality != null && afterQuality < beforeQuality - 0.03) {
    reasons.push({ key: 'quality_score', baseline: beforeQuality, canary: afterQuality });
  }
  return { rollback: reasons.length > 0, reasons };
}

export async function generateImprovementProposals(pool, {
  datasetId,
  datasetVersion,
  generateCandidate,
  minSamples = 8,
  minTenants = 2,
} = {}) {
  if (!datasetId || typeof generateCandidate !== 'function') return [];
  return runWithSystemTenantContext(async () => {
    const groups = await pool.query(
      `SELECT COALESCE(route, 'unknown') AS route,
              COUNT(*)::int AS sample_count,
              COUNT(DISTINCT source_tenant_pseudonym)::int AS tenant_count
         FROM ai_evaluation_dataset_items
        WHERE dataset_id=$1 AND expected_label IN ('unhelpful','audit_fail','business_loss')
        GROUP BY COALESCE(route, 'unknown')
       HAVING COUNT(*) >= $2 AND COUNT(DISTINCT source_tenant_pseudonym) >= $3
        ORDER BY COUNT(*) DESC LIMIT 5`,
      [datasetId, Math.max(3, Number(minSamples) || 8), Math.max(2, Number(minTenants) || 2)]
    );
    const proposals = [];
    for (const group of groups.rows || []) {
      const sampleR = await pool.query(
        `SELECT sanitized_input, sanitized_output, expected_label
           FROM ai_evaluation_dataset_items
          WHERE dataset_id=$1 AND COALESCE(route, 'unknown')=$2
            AND expected_label IN ('unhelpful','audit_fail','business_loss')
          ORDER BY candidate_id LIMIT 20`,
        [datasetId, group.route]
      );
      const generated = await generateCandidate({
        route: group.route,
        samples: sampleR.rows || [],
        evidence: { sample_count: group.sample_count, tenant_count: group.tenant_count },
      });
      if (!generated || typeof generated !== 'object') continue;
      const artifactVersion = `${datasetVersion || datasetId}-${group.route}`.slice(0, 80);
      const r = await pool.query(
        `INSERT INTO ai_quality_release_candidates (
           artifact_type, artifact_key, artifact_version, artifact_payload,
           dataset_id, status, created_by
         ) VALUES ('prompt_patch',$1,$2,$3::jsonb,$4,'draft','auto_learning_cycle')
         ON CONFLICT (artifact_type, artifact_key, artifact_version) DO UPDATE SET
           artifact_payload=EXCLUDED.artifact_payload, dataset_id=EXCLUDED.dataset_id,
           updated_at=NOW()
         RETURNING id, artifact_key, artifact_version, status`,
        [group.route, artifactVersion, JSON.stringify(sanitizeJson({ ...generated, evidence: group }) || {}), datasetId]
      );
      proposals.push(r.rows[0]);
    }
    return proposals;
  });
}

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
    observations.push({ candidateId: candidate.id, metrics, rollback: result.rollback });
  }
  return observations;
}

export async function runAiQualityLearningCycle(pool, { generateCandidate = null } = {}) {
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
    })
    : [];
  const canaries = await monitorActiveCanaries(pool);
  return { tenantRun, dataset, proposals, canaries, completedAt: new Date().toISOString() };
}

export function startAiQualityLearningScheduler(pool, {
  initialDelayMs = 120000,
  intervalMs = 24 * 60 * 60 * 1000,
  generateCandidate = null,
} = {}) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const result = await runAiQualityLearningCycle(pool, { generateCandidate });
      console.log('[ai-quality-learning] cycle complete:', JSON.stringify({ dataset: result.dataset, proposals: result.proposals?.length || 0, canaries: result.canaries?.length || 0, errors: result.tenantRun?.errors?.length || 0 }));
    } catch (error) {
      console.error('[ai-quality-learning] cycle failed:', error?.message || error);
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

export async function getTenantQualityOverview(pool, tenantId = null) {
  const tid = resolveTenantIdDefault(tenantId);
  const r = await pool.query(
    `SELECT
       (SELECT COUNT(*)::int FROM ai_interaction_traces WHERE tenant_id=$1) AS traces,
       (SELECT COUNT(*)::int FROM ai_feedback_events WHERE tenant_id=$1) AS feedback,
       (SELECT COUNT(*)::int FROM ai_learning_candidates WHERE tenant_id=$1 AND status='eligible') AS eligible_candidates,
       (SELECT COALESCE(platform_learning_enabled,FALSE) FROM ai_learning_policies WHERE tenant_id=$1) AS platform_learning_enabled`,
    [tid]
  );
  return r.rows[0] || {};
}

export async function getPlatformQualityOverview(pool) {
  return runWithSystemTenantContext(async () => {
    const r = await pool.query(`
      SELECT
        (SELECT COUNT(*)::int FROM ai_learning_policies WHERE platform_learning_enabled=TRUE) AS opted_in_tenants,
        (SELECT COUNT(*)::int FROM ai_learning_candidates WHERE status='eligible') AS eligible_candidates,
        (SELECT COUNT(DISTINCT tenant_id)::int FROM ai_learning_candidates WHERE status='eligible') AS contributing_tenants,
        (SELECT COUNT(*)::int FROM ai_evaluation_datasets) AS datasets,
        (SELECT COUNT(*)::int FROM ai_quality_release_candidates WHERE status IN ('draft','evaluated','canary','pending_approval')) AS open_release_candidates
    `);
    return r.rows[0] || {};
  });
}

export async function evaluateReleaseCandidate(pool, {
  artifactType,
  artifactKey,
  artifactVersion,
  artifactPayload = {},
  datasetId,
  baselineMetrics,
  candidateMetrics,
  createdBy = '',
} = {}) {
  const type = String(artifactType || '').trim();
  const key = String(artifactKey || '').trim();
  const version = String(artifactVersion || '').trim();
  if (!type || !key || !version || !datasetId) throw new Error('missing_release_candidate_fields');
  const gate = evaluateReleaseGate(baselineMetrics, candidateMetrics);
  return runWithSystemTenantContext(async () => {
    const dataset = await pool.query(
      `SELECT id, item_count, tenant_count FROM ai_evaluation_datasets WHERE id=$1 LIMIT 1`,
      [datasetId]
    );
    if (!dataset.rows[0]) throw new Error('evaluation_dataset_not_found');
    const metrics = {
      ...(candidateMetrics || {}),
      sample_size: Number(candidateMetrics?.sample_size ?? dataset.rows[0].item_count),
      tenant_count: Number(candidateMetrics?.tenant_count ?? dataset.rows[0].tenant_count),
    };
    const finalGate = evaluateReleaseGate(baselineMetrics, metrics);
    const r = await pool.query(
      `INSERT INTO ai_quality_release_candidates (
         artifact_type, artifact_key, artifact_version, artifact_payload,
         dataset_id, baseline_metrics, candidate_metrics, gate_result,
         status, created_by
       ) VALUES ($1,$2,$3,$4::jsonb,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9,$10)
       ON CONFLICT (artifact_type, artifact_key, artifact_version) DO UPDATE SET
         artifact_payload=EXCLUDED.artifact_payload,
         dataset_id=EXCLUDED.dataset_id,
         baseline_metrics=EXCLUDED.baseline_metrics,
         candidate_metrics=EXCLUDED.candidate_metrics,
         gate_result=EXCLUDED.gate_result,
         status=EXCLUDED.status,
         updated_at=NOW()
       RETURNING *`,
      [
        type, key, version, JSON.stringify(sanitizeJson(artifactPayload) || {}), datasetId,
        JSON.stringify(sanitizeJson(baselineMetrics) || {}), JSON.stringify(sanitizeJson(metrics) || {}),
        JSON.stringify(finalGate), finalGate.passed ? 'canary' : 'rejected',
        String(createdBy || '').slice(0, 120),
      ]
    );
    return { candidate: r.rows[0], gate: finalGate, initialGate: gate };
  });
}

export async function approveReleaseCandidate(pool, { candidateId, approvedBy } = {}) {
  if (!candidateId) throw new Error('candidate_id_required');
  return runWithSystemTenantContext(async () => {
    const r = await pool.query(
      `UPDATE ai_quality_release_candidates
          SET status='approved', approved_by=$1, updated_at=NOW()
        WHERE id=$2 AND status IN ('canary','pending_approval')
          AND COALESCE((gate_result->>'passed')::boolean, FALSE)=TRUE
        RETURNING *`,
      [String(approvedBy || '').slice(0, 120), candidateId]
    );
    if (!r.rows[0]) throw new Error('candidate_not_approvable');
    return r.rows[0];
  });
}

export async function getRuntimePromptPatch(pool, {
  artifactKey,
  tenantId,
  actorId = '',
} = {}) {
  const key = String(artifactKey || '').trim();
  const tid = String(tenantId || '').trim();
  if (!key || !tid) return null;
  return runWithSystemTenantContext(async () => {
    const r = await pool.query(
      `SELECT id, artifact_version, artifact_payload, status
         FROM ai_quality_release_candidates
        WHERE artifact_type='prompt_patch' AND artifact_key=$1
          AND status IN ('approved','canary','pending_approval')
        ORDER BY updated_at DESC LIMIT 1`,
      [key]
    );
    const row = r.rows[0];
    if (!row) return null;
    if (row.status !== 'approved') {
      const percent = Math.max(1, Math.min(50, Number(row.artifact_payload?.canary_percent) || 10));
      const bucket = Number.parseInt(sha256(`${tid}|${actorId}|${row.id}`).slice(0, 8), 16) % 100;
      if (bucket >= percent) return null;
    }
    const patch = String(row.artifact_payload?.prompt_patch || '').trim().slice(0, 2000);
    return patch ? { patch, candidateId: row.id, version: row.artifact_version, status: row.status } : null;
  });
}

export async function recordCanaryObservation(pool, {
  candidateId,
  canaryMetrics,
} = {}) {
  if (!candidateId) throw new Error('candidate_id_required');
  return runWithSystemTenantContext(async () => {
    const existing = await pool.query(
      `SELECT * FROM ai_quality_release_candidates WHERE id=$1 LIMIT 1`,
      [candidateId]
    );
    const row = existing.rows[0];
    if (!row) throw new Error('release_candidate_not_found');
    const rollback = shouldRollbackCanary(row.baseline_metrics || {}, canaryMetrics || {});
    const status = rollback.rollback ? 'rolled_back' : 'pending_approval';
    const r = await pool.query(
      `UPDATE ai_quality_release_candidates
          SET canary_metrics=$1::jsonb, status=$2, updated_at=NOW()
        WHERE id=$3 RETURNING *`,
      [JSON.stringify(sanitizeJson(canaryMetrics) || {}), status, candidateId]
    );
    return { candidate: r.rows[0], rollback };
  });
}
