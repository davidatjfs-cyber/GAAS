import { runWithSystemTenantContext } from '../../utils/database.js';

export function normalizeContractLearningConfig({
  agreementReference,
  agreementVersion = '1',
  agreementEffectiveAt = null,
  recordedBy = 'platform_owner',
} = {}) {
  const reference = String(agreementReference || '').trim();
  if (!reference) throw new Error('AI_LEARNING_AGREEMENT_REFERENCE_required');
  const effectiveAt = agreementEffectiveAt ? new Date(agreementEffectiveAt) : new Date();
  if (Number.isNaN(effectiveAt.getTime())) throw new Error('invalid_agreement_effective_at');
  return {
    authorizationBasis: 'contract',
    agreementReference: reference.slice(0, 200),
    agreementVersion: String(agreementVersion || '1').trim().slice(0, 80),
    agreementEffectiveAt: effectiveAt.toISOString(),
    recordedBy: String(recordedBy || 'platform_owner').trim().slice(0, 120),
    automationMode: 'automatic',
  };
}

export async function writeContractLearningPolicy(pool, tenantId, normalized, authorizationSource) {
  const r = await pool.query(
    `INSERT INTO ai_learning_policies (
       tenant_id, platform_learning_enabled, allowed_purposes, retention_days,
       max_daily_contributions, updated_by, authorization_basis,
       agreement_reference, agreement_version, agreement_effective_at,
       authorization_recorded_by, authorization_source, automation_mode, enabled_at
     ) VALUES ($1,TRUE,ARRAY['*']::TEXT[],365,100,$2,'contract',$3,$4,$5,$2,$6,'automatic',NOW())
     ON CONFLICT (tenant_id) DO UPDATE SET
       platform_learning_enabled=TRUE,
       allowed_purposes=ARRAY['*']::TEXT[],
       authorization_basis='contract',
       agreement_reference=EXCLUDED.agreement_reference,
       agreement_version=EXCLUDED.agreement_version,
       agreement_effective_at=EXCLUDED.agreement_effective_at,
       authorization_recorded_by=EXCLUDED.authorization_recorded_by,
       authorization_source=EXCLUDED.authorization_source,
       automation_mode='automatic',
       enabled_at=COALESCE(ai_learning_policies.enabled_at,NOW()),
       policy_version=ai_learning_policies.policy_version+1,
       updated_by=EXCLUDED.updated_by,
       updated_at=NOW()
     WHERE ai_learning_policies.platform_learning_enabled IS DISTINCT FROM TRUE
        OR ai_learning_policies.authorization_basis IS DISTINCT FROM 'contract'
        OR ai_learning_policies.agreement_reference IS DISTINCT FROM EXCLUDED.agreement_reference
        OR ai_learning_policies.agreement_version IS DISTINCT FROM EXCLUDED.agreement_version
     RETURNING *`,
    [tenantId, normalized.recordedBy, normalized.agreementReference,
      normalized.agreementVersion, normalized.agreementEffectiveAt,
      String(authorizationSource || 'manual_platform_record').slice(0, 40)]
  );
  const policy = r.rows[0];
  if (!policy) return null;
  await pool.query(
    `INSERT INTO ai_learning_policy_events (
       tenant_id, policy_version, platform_learning_enabled, allowed_purposes,
       retention_days, max_daily_contributions, changed_by,
       authorization_basis, agreement_reference, agreement_version,
       agreement_effective_at, authorization_source, automation_mode
     ) VALUES ($1,$2,TRUE,$3,$4,$5,$6,'contract',$7,$8,$9,$10,'automatic')`,
    [policy.tenant_id, policy.policy_version, policy.allowed_purposes,
      policy.retention_days, policy.max_daily_contributions, normalized.recordedBy,
      normalized.agreementReference, normalized.agreementVersion,
      normalized.agreementEffectiveAt,
      String(authorizationSource || 'manual_platform_record').slice(0, 40)]
  );
  return policy;
}

export async function recordContractLearningAuthorization(pool, {
  tenantId,
  ...config
} = {}) {
  const tid = String(tenantId || '').trim();
  if (!tid) throw new Error('tenant_id_required');
  const normalized = normalizeContractLearningConfig(config);
  if (!String(process.env.AI_LEARNING_PSEUDONYM_KEY || '').trim()) {
    throw new Error('AI_LEARNING_PSEUDONYM_KEY_required');
  }
  return runWithSystemTenantContext(async () => {
    const tenant = await pool.query(
      `SELECT tenant_id FROM tenants WHERE tenant_id=$1 AND status IN ('active','provisioning') LIMIT 1`,
      [tid]
    );
    if (!tenant.rows[0]) throw new Error('tenant_not_found_or_inactive');
    return writeContractLearningPolicy(pool, tid, normalized, 'manual_platform_record');
  });
}

export async function ensureContractAuthorizedLearningPolicies(pool) {
  if (!String(process.env.AI_LEARNING_PSEUDONYM_KEY || '').trim()) {
    throw new Error('AI_LEARNING_PSEUDONYM_KEY_required');
  }
  return runWithSystemTenantContext(async () => {
    const active = await pool.query(`SELECT tenant_id FROM tenants WHERE status='active' ORDER BY tenant_id`);
    const contracts = await pool.query(
      `SELECT DISTINCT ON (o.tenant_id)
              o.tenant_id, c.contract_no,
              COALESCE(c.version_no,1)::text AS agreement_version,
              COALESCE(c.effective_at,c.approved_at,c.signed_at,o.updated_at) AS effective_at,
              COALESCE(c.approved_by,'sales_contract_automation') AS recorded_by
         FROM sales_orders o
         JOIN sales_contracts c ON c.id=o.contract_id
         JOIN tenants t ON t.tenant_id=o.tenant_id AND t.status='active'
        WHERE o.tenant_id IS NOT NULL
          AND c.status='effective' AND c.approval_status='approved'
        ORDER BY o.tenant_id,COALESCE(c.effective_at,c.approved_at,c.signed_at,o.updated_at) DESC`
    );
    const enabled = [];
    for (const row of contracts.rows || []) {
      const policy = await writeContractLearningPolicy(pool, row.tenant_id, normalizeContractLearningConfig({
        agreementReference: row.contract_no,
        agreementVersion: row.agreement_version,
        agreementEffectiveAt: row.effective_at,
        recordedBy: row.recorded_by,
      }), 'sales_crm');
      if (policy) enabled.push(policy.tenant_id);
    }
    const crmTenantIds = (contracts.rows || []).map((row) => row.tenant_id);
    const revoked = await pool.query(
      `UPDATE ai_learning_policies
          SET platform_learning_enabled=FALSE,updated_at=NOW(),policy_version=policy_version+1
        WHERE authorization_source='sales_crm'
          AND platform_learning_enabled=TRUE
          AND NOT (tenant_id=ANY($1::text[]))
        RETURNING *`,
      [crmTenantIds]
    );
    for (const policy of revoked.rows || []) {
      const affected = await pool.query(
        `SELECT DISTINCT i.dataset_id
           FROM ai_evaluation_dataset_items i
           JOIN ai_learning_candidates c ON c.id=i.candidate_id
          WHERE c.tenant_id=$1`,
        [policy.tenant_id]
      );
      await pool.query(
        `DELETE FROM ai_evaluation_dataset_items i USING ai_learning_candidates c
          WHERE i.candidate_id=c.id AND c.tenant_id=$1`,
        [policy.tenant_id]
      );
      await pool.query(
        `UPDATE ai_learning_candidates SET status='withdrawn',withdrawn_at=NOW()
          WHERE tenant_id=$1 AND status<>'withdrawn'`,
        [policy.tenant_id]
      );
      for (const row of affected.rows || []) {
        await pool.query(
          `UPDATE ai_evaluation_datasets d SET status='invalidated_contract',
             item_count=(SELECT COUNT(*)::int FROM ai_evaluation_dataset_items i WHERE i.dataset_id=d.id),
             tenant_count=(SELECT COUNT(DISTINCT source_tenant_pseudonym)::int FROM ai_evaluation_dataset_items i WHERE i.dataset_id=d.id)
           WHERE d.id=$1`,
          [row.dataset_id]
        );
      }
      await pool.query(
        `INSERT INTO ai_learning_policy_events (
           tenant_id,policy_version,platform_learning_enabled,allowed_purposes,
           retention_days,max_daily_contributions,changed_by,authorization_basis,
           agreement_reference,agreement_version,agreement_effective_at,
           authorization_source,automation_mode
         ) VALUES ($1,$2,FALSE,$3,$4,$5,'sales_contract_automation',$6,$7,$8,$9,$10,'automatic')`,
        [policy.tenant_id, policy.policy_version, policy.allowed_purposes,
          policy.retention_days, policy.max_daily_contributions, policy.authorization_basis,
          policy.agreement_reference, policy.agreement_version,
          policy.agreement_effective_at, policy.authorization_source]
      );
    }
    const authorized = await pool.query(
      `SELECT tenant_id FROM ai_learning_policies
        WHERE platform_learning_enabled=TRUE AND authorization_basis='contract'`
    );
    const authorizedIds = new Set((authorized.rows || []).map((row) => row.tenant_id));
    const missingAuthorization = (active.rows || []).map((row) => row.tenant_id)
      .filter((tenantId) => !authorizedIds.has(tenantId));
    return {
      activeTenants: active.rows?.length || 0,
      enabled,
      revoked: (revoked.rows || []).map((row) => row.tenant_id),
      missingAuthorization,
    };
  });
}
