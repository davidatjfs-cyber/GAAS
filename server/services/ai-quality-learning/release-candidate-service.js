import crypto from 'node:crypto';

import { runWithSystemTenantContext } from '../../utils/database.js';

const MAX_RELEASE_TEXT = 6000;

function metric(metrics, key) {
  const n = Number(metrics?.[key]);
  return Number.isFinite(n) ? n : null;
}

function redactReleaseText(value) {
  let text = String(value || '').slice(0, MAX_RELEASE_TEXT);
  const replace = (pattern, replacement) => {
    text = text.replace(pattern, (...args) => (typeof replacement === 'function' ? replacement(...args) : replacement));
  };
  replace(/\b(?:bearer|basic)\s+[a-z0-9._~+/=-]{8,}\b/gi, '[AUTH_REDACTED]');
  replace(/\b(?:api[_-]?key|secret|token|password|passwd)\s*[:=]\s*[^\s,;，。]{4,}/gi, '[SECRET_REDACTED]');
  replace(/https?:\/\/[^\s<>{}"']+/gi, '[URL_REDACTED]');
  replace(/(?<!\d)(?:\d{1,3}\.){3}\d{1,3}(?!\d)/g, '[IP_REDACTED]');
  replace(/\b\d{17}[0-9Xx]\b/g, '[ID_REDACTED]');
  replace(/(?<!\d)(?:\+?86[- ]?)?1[3-9]\d{9}(?!\d)/g, '[PHONE_REDACTED]');
  replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[EMAIL_REDACTED]');
  replace(/(?<!\d)\d{16,19}(?!\d)/g, '[BANK_REDACTED]');
  replace(/\b(?:ou_|on_|oc_|cli_)[a-z0-9_-]{12,}\b/gi, '[EXTERNAL_ID_REDACTED]');
  replace(/(?:姓名|员工|顾客|客户|联系人|负责人|店长)\s*[:：=]\s*[\u4e00-\u9fa5·]{2,12}/g, '[PERSON_REDACTED]');
  replace(/(?:公司|品牌|门店|店铺|商户)\s*[:：=]\s*[^\s,，。；;]{2,40}/g, '[ENTITY_REDACTED]');
  replace(/(?:地址|住址|所在地)\s*[:：=]\s*[^\n。；;]{4,80}/g, '[ADDRESS_REDACTED]');
  replace(/(?:微信号|账号|工号|会员号)\s*[:：=]\s*[a-zA-Z0-9_-]{4,40}/gi, '[ACCOUNT_REDACTED]');
  return text;
}

function sanitizeReleaseJson(value, depth = 0) {
  if (depth > 5 || value == null) return value == null ? null : '[DEPTH_LIMIT]';
  if (typeof value === 'string') return redactReleaseText(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitizeReleaseJson(item, depth + 1));
  if (typeof value !== 'object') return String(value);
  const result = {};
  for (const [key, item] of Object.entries(value).slice(0, 100)) {
    if (/password|secret|token|api[_-]?key|authorization|phone|mobile|email|address|open.?id|user.?id|customer.?id|employee.?id|person.?name|customer.?name/i.test(key)) {
      result[key] = '[SECRET_REDACTED]';
    } else {
      result[key] = sanitizeReleaseJson(item, depth + 1);
    }
  }
  return result;
}

function hashCanaryBucket(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
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

export function decideAutomaticPromotion(baseline = {}, canary = {}, {
  minSamples = 100,
  minTenants = 3,
} = {}) {
  const rollback = shouldRollbackCanary(baseline, canary);
  const sampleSize = Number(canary?.sample_size || 0);
  const tenantCount = Number(canary?.tenant_count || 0);
  if (rollback.rollback) return { status: 'rolled_back', reason: 'automatic_quality_rollback', rollback };
  if (sampleSize < minSamples || tenantCount < minTenants) {
    return { status: 'canary', reason: 'awaiting_canary_evidence', rollback };
  }
  return { status: 'approved', reason: 'automatic_quality_promotion', rollback };
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
        type, key, version, JSON.stringify(sanitizeReleaseJson(artifactPayload) || {}), datasetId,
        JSON.stringify(sanitizeReleaseJson(baselineMetrics) || {}), JSON.stringify(sanitizeReleaseJson(metrics) || {}),
        JSON.stringify(finalGate), finalGate.passed ? 'canary' : 'rejected',
        String(createdBy || '').slice(0, 120),
      ]
    );
    await pool.query(
      `INSERT INTO ai_quality_release_events (
         release_candidate_id,from_status,to_status,reason,metrics
       ) VALUES ($1,'draft',$2,$3,$4::jsonb)`,
      [r.rows[0].id, r.rows[0].status,
        finalGate.passed ? 'automatic_offline_gate_passed' : 'automatic_offline_gate_rejected',
        JSON.stringify({ baseline: sanitizeReleaseJson(baselineMetrics), candidate: sanitizeReleaseJson(metrics), gate: finalGate })]
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
      const bucket = Number.parseInt(hashCanaryBucket(`${tid}|${actorId}|${row.id}`).slice(0, 8), 16) % 100;
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
    const decision = decideAutomaticPromotion(row.baseline_metrics || {}, canaryMetrics || {});
    const status = decision.status;
    const r = await pool.query(
      `UPDATE ai_quality_release_candidates
          SET canary_metrics=$1::jsonb, status=$2, updated_at=NOW()
        WHERE id=$3 RETURNING *`,
      [JSON.stringify(sanitizeReleaseJson(canaryMetrics) || {}), status, candidateId]
    );
    if (row.status !== status) {
      await pool.query(
        `INSERT INTO ai_quality_release_events (
           release_candidate_id,from_status,to_status,reason,metrics
         ) VALUES ($1,$2,$3,$4,$5::jsonb)`,
        [candidateId, row.status, status, decision.reason,
          JSON.stringify({ canary: sanitizeReleaseJson(canaryMetrics), rollback: decision.rollback })]
      );
    }
    return { candidate: r.rows[0], rollback: decision.rollback, decision };
  });
}
