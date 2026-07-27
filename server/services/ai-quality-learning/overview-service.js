import { resolveTenantIdDefault, runWithSystemTenantContext } from '../../utils/database.js';

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
        (SELECT COUNT(*)::int FROM ai_learning_policies
          WHERE platform_learning_enabled=TRUE AND authorization_basis='contract') AS contract_authorized_tenants,
        (SELECT COUNT(*)::int FROM ai_learning_candidates WHERE status='eligible') AS eligible_candidates,
        (SELECT COUNT(DISTINCT tenant_id)::int FROM ai_learning_candidates WHERE status='eligible') AS contributing_tenants,
        (SELECT COUNT(*)::int FROM ai_evaluation_datasets) AS datasets,
        (SELECT COUNT(*)::int FROM ai_quality_release_candidates WHERE status IN ('draft','evaluated','canary','pending_approval')) AS open_release_candidates,
        (SELECT COUNT(*)::int FROM ai_quality_model_calls WHERE created_at >= date_trunc('day',NOW())) AS quality_model_calls_today
    `);
    return {
      ...(r.rows[0] || {}),
      platform_quality_model_configured: Boolean(String(process.env.AI_QUALITY_LLM_API_KEY || '').trim()),
      platform_quality_model_provider: String(process.env.AI_QUALITY_LLM_PROVIDER || '').trim() || null,
      platform_quality_model_name: String(process.env.AI_QUALITY_LLM_MODEL || '').trim() || null,
      quality_model_daily_limit: Math.max(1, Math.min(10000, Number(process.env.AI_QUALITY_DAILY_CALL_LIMIT) || 100)),
    };
  });
}

export async function getPlatformQualityActivity(pool) {
  return runWithSystemTenantContext(async () => {
    const [policies, cycles, releases, modelCalls] = await Promise.all([
      pool.query(
        `SELECT tenant_id,authorization_basis,authorization_source,agreement_reference,agreement_version,
                agreement_effective_at,automation_mode,enabled_at,updated_at
           FROM ai_learning_policies
          WHERE platform_learning_enabled=TRUE
          ORDER BY tenant_id LIMIT 200`
      ),
      pool.query(
        `SELECT id,status,trigger_type,tenant_count,trace_count,feedback_count,
                candidate_count,dataset_version,proposal_count,canary_count,
                promoted_count,rolled_back_count,error_count,started_at,completed_at
           FROM ai_learning_cycle_runs ORDER BY started_at DESC LIMIT 100`
      ),
      pool.query(
        `SELECT e.id,e.release_candidate_id,e.from_status,e.to_status,e.reason,
                e.metrics,e.created_at,c.artifact_key,c.artifact_version
           FROM ai_quality_release_events e
           JOIN ai_quality_release_candidates c ON c.id=e.release_candidate_id
          ORDER BY e.created_at DESC LIMIT 200`
      ),
      pool.query(
        `SELECT id,operation,route,provider,model_name,success,latency_ms,
                input_tokens,output_tokens,error_code,created_at
           FROM ai_quality_model_calls ORDER BY created_at DESC LIMIT 200`
      ),
    ]);
    return {
      policies: policies.rows || [], cycles: cycles.rows || [],
      releases: releases.rows || [], modelCalls: modelCalls.rows || [],
    };
  });
}
