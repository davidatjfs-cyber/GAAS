import { runWithSystemTenantContext } from '../../utils/database.js';
import { sanitizeJson, sha256 } from './redaction-service.js';
import { evaluateReleaseCandidate } from './release-candidate-service.js';

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
         JOIN tenants t ON t.tenant_id=c.tenant_id AND t.status='active'
        WHERE c.status='eligible'
          AND p.platform_learning_enabled=TRUE
          AND p.authorization_basis='contract'
          AND NULLIF(TRIM(p.agreement_reference),'') IS NOT NULL
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

export async function generateImprovementProposals(pool, {
  datasetId,
  datasetVersion,
  generateCandidate,
  evaluateCandidate = null,
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
      const payload = sanitizeJson({ ...generated, evidence: group }) || {};
      const r = await pool.query(
        `INSERT INTO ai_quality_release_candidates (
           artifact_type, artifact_key, artifact_version, artifact_payload,
           dataset_id, status, created_by
         ) VALUES ('prompt_patch',$1,$2,$3::jsonb,$4,'draft','auto_learning_cycle')
         ON CONFLICT (artifact_type, artifact_key, artifact_version) DO UPDATE SET
           artifact_payload=EXCLUDED.artifact_payload, dataset_id=EXCLUDED.dataset_id,
           updated_at=NOW()
         RETURNING id, artifact_key, artifact_version, status`,
        [group.route, artifactVersion, JSON.stringify(payload), datasetId]
      );
      let evaluation = null;
      if (typeof evaluateCandidate === 'function') {
        const positiveCount = (sampleR.rows || []).filter((item) => !['unhelpful', 'audit_fail', 'business_loss'].includes(item.expected_label)).length;
        const total = Math.max(1, Number(group.sample_count) || sampleR.rows?.length || 1);
        const baselineQuality = positiveCount / total;
        const baselineMetrics = {
          quality_score: baselineQuality,
          groundedness: baselineQuality,
          safety_violation_rate: 0,
          negative_feedback_rate: 1 - baselineQuality,
          p95_latency_ms: 0,
        };
        const judged = await evaluateCandidate({
          route: group.route,
          samples: sampleR.rows || [],
          proposal: payload,
          evidence: { sample_count: Number(group.sample_count), tenant_count: Number(group.tenant_count) },
        });
        if (judged && typeof judged === 'object') {
          evaluation = await evaluateReleaseCandidate(pool, {
            artifactType: 'prompt_patch',
            artifactKey: group.route,
            artifactVersion,
            artifactPayload: payload,
            datasetId,
            baselineMetrics,
            candidateMetrics: {
              ...judged,
              sample_size: Number(group.sample_count),
              tenant_count: Number(group.tenant_count),
            },
            createdBy: 'auto_learning_cycle',
          });
        }
      }
      proposals.push({ ...r.rows[0], evaluation: evaluation?.gate || null });
    }
    return proposals;
  });
}
