import {
  approveReleaseCandidate,
  evaluateReleaseCandidate,
  getPlatformQualityOverview,
  getTenantQualityOverview,
  recordAiFeedback,
  recordCanaryObservation,
  runAiQualityLearningCycle,
  upsertLearningPolicy,
} from './services/ai-quality-learning-service.js';
import { runWithSystemTenantContext } from './utils/database.js';

const TENANT_ADMIN_ROLES = new Set(['admin', 'hq_manager']);

function requireTenantAdmin(req, res) {
  if (!TENANT_ADMIN_ROLES.has(String(req.user?.role || '').trim())) {
    res.status(403).json({ error: 'forbidden' });
    return false;
  }
  return true;
}

export function registerAiQualityLearningRoutes(app, {
  pool,
  authRequired,
  platformAdminRequired,
  requireSuperAdmin,
}) {
  app.get('/api/ai-quality/learning-policy', authRequired, async (req, res) => {
    if (!requireTenantAdmin(req, res)) return;
    try {
      const r = await pool.query(
        `SELECT tenant_id, platform_learning_enabled, allowed_purposes,
                retention_days, max_daily_contributions, policy_version,
                updated_by, updated_at
           FROM ai_learning_policies WHERE tenant_id=$1 LIMIT 1`,
        [req.tenantId]
      );
      return res.json({
        policy: r.rows[0] || {
          tenant_id: req.tenantId,
          platform_learning_enabled: false,
          allowed_purposes: [],
          retention_days: 365,
          max_daily_contributions: 100,
          policy_version: 0,
        },
      });
    } catch (error) {
      return res.status(500).json({ error: error?.message || 'server_error' });
    }
  });

  app.put('/api/ai-quality/learning-policy', authRequired, async (req, res) => {
    if (!requireTenantAdmin(req, res)) return;
    try {
      const policy = await upsertLearningPolicy(pool, {
        enabled: req.body?.platform_learning_enabled === true,
        allowedPurposes: req.body?.allowed_purposes,
        retentionDays: req.body?.retention_days,
        maxDailyContributions: req.body?.max_daily_contributions,
        updatedBy: req.user?.username,
        tenantId: req.tenantId,
      });
      return res.json({ ok: true, policy });
    } catch (error) {
      return res.status(400).json({ error: error?.message || 'invalid_policy' });
    }
  });

  app.post('/api/ai-quality/feedback', authRequired, async (req, res) => {
    try {
      const traceId = String(req.body?.trace_id || '').trim();
      if (!traceId) return res.status(400).json({ error: 'trace_id_required' });
      const trace = await pool.query(
        `SELECT actor_id FROM ai_interaction_traces
          WHERE trace_id=$1 AND tenant_id=$2 LIMIT 1`,
        [traceId, req.tenantId]
      );
      if (!trace.rows[0]) return res.status(404).json({ error: 'trace_not_found' });
      const username = String(req.user?.username || '').trim();
      const owner = String(trace.rows[0].actor_id || '').trim();
      if (!TENANT_ADMIN_ROLES.has(String(req.user?.role || '').trim()) && owner && owner !== username) {
        return res.status(403).json({ error: 'forbidden' });
      }
      const result = await recordAiFeedback(pool, {
        traceId,
        actorId: username,
        feedbackType: 'user_rating',
        rating: req.body?.rating,
        note: req.body?.note,
        businessOutcome: req.body?.business_outcome,
        idempotencyKey: req.body?.idempotency_key || `user:${username}:${traceId}`,
        tenantId: req.tenantId,
      });
      return res.json({ ok: true, ...result });
    } catch (error) {
      return res.status(400).json({ error: error?.message || 'invalid_feedback' });
    }
  });

  app.get('/api/ai-quality/overview', authRequired, async (req, res) => {
    if (!requireTenantAdmin(req, res)) return;
    try {
      return res.json({ overview: await getTenantQualityOverview(pool, req.tenantId) });
    } catch (error) {
      return res.status(500).json({ error: error?.message || 'server_error' });
    }
  });

  const platformOnly = [platformAdminRequired, requireSuperAdmin];

  app.get('/api/admin/ai-quality/overview', platformOnly, async (_req, res) => {
    try {
      return res.json({ overview: await getPlatformQualityOverview(pool) });
    } catch (error) {
      return res.status(500).json({ error: error?.message || 'server_error' });
    }
  });

  app.post('/api/admin/ai-quality/run-cycle', platformOnly, async (_req, res) => {
    try {
      return res.json({ ok: true, result: await runAiQualityLearningCycle(pool) });
    } catch (error) {
      return res.status(500).json({ error: error?.message || 'cycle_failed' });
    }
  });

  app.post('/api/admin/ai-quality/release-candidates/evaluate', platformOnly, async (req, res) => {
    try {
      const result = await evaluateReleaseCandidate(pool, {
        artifactType: req.body?.artifact_type,
        artifactKey: req.body?.artifact_key,
        artifactVersion: req.body?.artifact_version,
        artifactPayload: req.body?.artifact_payload,
        datasetId: req.body?.dataset_id,
        baselineMetrics: req.body?.baseline_metrics,
        candidateMetrics: req.body?.candidate_metrics,
        createdBy: req.platformAdmin?.username,
      });
      return res.json({ ok: true, ...result });
    } catch (error) {
      return res.status(400).json({ error: error?.message || 'evaluation_failed' });
    }
  });

  app.post('/api/admin/ai-quality/release-candidates/:id/canary-observation', platformOnly, async (req, res) => {
    try {
      const result = await recordCanaryObservation(pool, {
        candidateId: req.params.id,
        canaryMetrics: req.body?.canary_metrics,
      });
      return res.json({ ok: true, ...result });
    } catch (error) {
      return res.status(400).json({ error: error?.message || 'canary_observation_failed' });
    }
  });

  app.post('/api/admin/ai-quality/release-candidates/:id/approve', platformOnly, async (req, res) => {
    try {
      const candidate = await approveReleaseCandidate(pool, {
        candidateId: req.params.id,
        approvedBy: req.platformAdmin?.username,
      });
      return res.json({ ok: true, candidate });
    } catch (error) {
      return res.status(400).json({ error: error?.message || 'approval_failed' });
    }
  });

  app.get('/api/admin/ai-quality/datasets', platformOnly, async (_req, res) => {
    try {
      const r = await runWithSystemTenantContext(() => pool.query(
        `SELECT id, version, status, item_count, tenant_count, selection_policy,
                content_hash, created_at
           FROM ai_evaluation_datasets ORDER BY created_at DESC LIMIT 50`
      ));
      return res.json({ items: r.rows || [] });
    } catch (error) {
      return res.status(500).json({ error: error?.message || 'server_error' });
    }
  });

  app.get('/api/admin/ai-quality/release-candidates', platformOnly, async (_req, res) => {
    try {
      const r = await runWithSystemTenantContext(() => pool.query(
        `SELECT id, artifact_type, artifact_key, artifact_version, artifact_payload,
                dataset_id, baseline_metrics, candidate_metrics, gate_result,
                canary_metrics, status, created_by, approved_by, created_at, updated_at
           FROM ai_quality_release_candidates ORDER BY updated_at DESC LIMIT 100`
      ));
      return res.json({ items: r.rows || [] });
    } catch (error) {
      return res.status(500).json({ error: error?.message || 'server_error' });
    }
  });
}
