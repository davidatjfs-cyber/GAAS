/**
 * I/O bodies for agent quality / long-memory / autonomous tasks (P2 peel).
 */
import { randomUUID } from 'crypto';
import { buildAutonomousTaskFingerprintBody, markQualityMetricBody } from './agent-quality-autonomy-helpers.js';

export async function getAgentLongMemoryBody(deps, userKey, memoryKey) {
  const u = String(userKey || '').trim().toLowerCase();
  const k = String(memoryKey || '').trim();
  if (!u || !k) return null;
  try {
    const r = await deps.pool().query(
      `SELECT memory_value FROM agent_long_memory WHERE user_key = $1 AND memory_key = $2 LIMIT 1`,
      [u, k]
    );
    const row = r.rows?.[0];
    return row?.memory_value && typeof row.memory_value === 'object' ? row.memory_value : null;
  } catch (e) {
    return null;
  }
}

export async function setAgentLongMemoryBody(deps, userKey, memoryKey, value) {
  const u = String(userKey || '').trim().toLowerCase();
  const k = String(memoryKey || '').trim();
  if (!u || !k) return;
  const payload = value && typeof value === 'object' ? value : { value: String(value || '') };
  try {
    await deps.pool().query(
      `INSERT INTO agent_long_memory (user_key, memory_key, memory_value, created_at, updated_at, tenant_id)
       VALUES ($1, $2, $3::jsonb, NOW(), NOW(), $4)
       ON CONFLICT (user_key, memory_key, tenant_id)
       DO UPDATE SET memory_value = EXCLUDED.memory_value, updated_at = NOW()`,
      [u, k, JSON.stringify(payload), deps.resolveTenantIdDefault()]
    );
  } catch (e) {
    deps.log.error('[agents] setAgentLongMemory failed:', e?.message || e);
  }
}

export async function recordAgentQualityAuditBody(deps, {
  route, username, queryText, responseText, auditResult, passed, rewriteCount = 0,
}) {
  const auditId = randomUUID();
  let traceId = null;
  try {
    traceId = await deps.recordAiInteraction(deps.pool(), {
      source: 'agent_quality_audit',
      sourceRecordId: auditId,
      route,
      purpose: 'user_response',
      actorId: username,
      input: queryText,
      output: responseText,
      qualityMetrics: { ...(auditResult || {}), passed: passed === true, rewrite_count: rewriteCount },
    });
  } catch (e) {
    deps.log.error('[agents] record AI interaction trace failed:', e?.message || e);
  }
  try {
    await deps.pool().query(
      `INSERT INTO agent_quality_audits (id, route, username, query_text, response_text, audit_result, passed, rewrite_count, tenant_id, trace_id)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10)`,
      [
        auditId,
        String(route || '').trim(),
        String(username || '').trim(),
        String(queryText || '').slice(0, 1000),
        String(responseText || '').slice(0, 4000),
        JSON.stringify(auditResult || {}),
        passed === true,
        Math.max(0, Number(rewriteCount) || 0),
        deps.resolveTenantIdDefault(),
        traceId,
      ]
    );
  } catch (e) {
    deps.log.error('[agents] recordAgentQualityAudit failed:', e?.message || e);
    try {
      await deps.pool().query(
        `INSERT INTO agent_quality_audits (id, route, username, query_text, response_text, audit_result, passed, rewrite_count, tenant_id)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9)`,
        [auditId, String(route || '').trim(), String(username || '').trim(), String(queryText || '').slice(0, 1000),
          String(responseText || '').slice(0, 4000), JSON.stringify(auditResult || {}), passed === true,
          Math.max(0, Number(rewriteCount) || 0), deps.resolveTenantIdDefault()]
      );
    } catch (fallbackError) {
      deps.log.error('[agents] recordAgentQualityAudit legacy fallback failed:', fallbackError?.message || fallbackError);
    }
  }
  if (traceId) {
    try {
      await deps.recordAiFeedback(deps.pool(), {
        traceId,
        actorId: 'quality_gate',
        feedbackType: 'quality_audit',
        rating: passed === true ? 1 : -1,
        input: queryText,
        output: responseText,
        idempotencyKey: `quality-audit:${auditId}`,
      });
    } catch (e) {
      deps.log.error('[agents] record AI quality feedback failed:', e?.message || e);
    }
  }
}

export async function createOrUpdateAutonomousDataTaskBody(deps, metrics, {
  taskType, store, brand, requesterUsername, route, queryText, reason, evidence, ownerUsername, dueHours = 8,
}) {
  const fingerprint = buildAutonomousTaskFingerprintBody(
    { taskType, store, route, queryText },
    { normalizeStoreKey: deps.normalizeStoreKey, normalizePlainText: deps.normalizePlainText }
  );
  try {
    const r = await deps.pool().query(
      `INSERT INTO agent_autonomous_tasks (
         fingerprint, task_type, status, store, brand, requester_username, route,
         query_text, reason, evidence, action_plan, owner_username, notify_count, due_at, created_at, updated_at, tenant_id
       )
       VALUES (
         $1, $2, 'open', $3, $4, $5, $6,
         $7, $8, $9::jsonb, $10::jsonb, $11, 0, NOW() + make_interval(hours => $12), NOW(), NOW(), $13
       )
       ON CONFLICT (fingerprint, tenant_id)
       DO UPDATE SET
         reason = EXCLUDED.reason,
         evidence = EXCLUDED.evidence,
         owner_username = COALESCE(agent_autonomous_tasks.owner_username, EXCLUDED.owner_username),
         updated_at = NOW()
       RETURNING *`,
      [
        fingerprint,
        String(taskType || 'data_gap').trim() || 'data_gap',
        String(store || '').trim(),
        String(brand || '').trim(),
        String(requesterUsername || '').trim(),
        String(route || '').trim(),
        String(queryText || '').slice(0, 2000),
        String(reason || '').slice(0, 500),
        JSON.stringify(evidence || {}),
        JSON.stringify({ suggestedAction: '同步/补齐数据源后自动回访用户', createdBy: 'agent_autonomy' }),
        String(ownerUsername || '').trim(),
        Math.max(1, Math.min(72, Number(dueHours) || 8)),
        deps.resolveTenantIdDefault()
      ]
    );
    markQualityMetricBody(metrics, 'autonomousTasks', 1);
    return r.rows?.[0] || null;
  } catch (e) {
    deps.log.error('[agents] createOrUpdateAutonomousDataTask failed:', e?.message || e);
    return null;
  }
}

export async function notifyAutonomousDataTaskOwnerBody(deps, task) {
  const t = task && typeof task === 'object' ? task : null;
  if (!t) return;
  const owner = String(t.owner_username || '').trim();
  if (!owner) return;
  try {
    const fu = await deps.lookupFeishuUserByUsername(owner);
    if (!fu?.open_id) return;
    const msg = [
      `📌 自治任务提醒 [${t.task_type}]`,
      `门店：${t.store || '-'}`,
      `原因：${t.reason || '数据不足'}`,
      `用户问题：${String(t.query_text || '').slice(0, 120)}`,
      `请补齐数据源后在系统内关闭任务。`
    ].join('\n');
    await deps.sendLarkMessage(fu.open_id, deps.prefixWithAgentName('master', msg));
    await deps.pool().query(
      `UPDATE agent_autonomous_tasks
       SET notify_count = COALESCE(notify_count, 0) + 1, updated_at = NOW()
       WHERE id = $1`,
      [t.id]
    );
  } catch (e) {
    deps.log.error('[agents] notifyAutonomousDataTaskOwner failed:', e?.message || e);
  }
}
