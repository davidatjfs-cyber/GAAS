/**
 * Agent 运维监控：performance / eval / autonomous-tasks / quality-audits / scheduler / cache。
 * 纯逻辑 + SQL，不碰 req/res。
 */

export const OPS_ADMIN_ROLES = Object.freeze(['admin', 'hq_manager']);
export const OPS_VIEWER_ROLES = Object.freeze(['admin', 'hq_manager', 'hr_manager']);

export function clampLimit(raw, { min = 1, max = 50, fallback = 10 } = {}) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

export function isOpsAdminRole(role) {
  return OPS_ADMIN_ROLES.includes(String(role || '').trim());
}

export function isOpsViewerRole(role) {
  return OPS_VIEWER_ROLES.includes(String(role || '').trim());
}

/**
 * @returns {{ whereSql: string, params: unknown[], limit: number }}
 */
export function buildAutonomousTasksFilter({
  status = 'open',
  role,
  username,
  tenantId = 'default',
  limit,
} = {}) {
  const params = [];
  const push = (v) => {
    params.push(v);
    return `$${params.length}`;
  };
  const where = [];
  const st = String(status || 'open').trim();
  if (st && st !== 'all') where.push(`status = ${push(st)}`);
  const r = String(role || '').trim();
  const u = String(username || '').trim();
  if (!isOpsViewerRole(r)) {
    where.push(`(owner_username = ${push(u)} OR requester_username = ${push(u)})`);
  }
  where.push(`tenant_id = ${push(tenantId || 'default')}`);
  const lim = clampLimit(limit, { min: 1, max: 200, fallback: 50 });
  const limitPlaceholder = push(lim);
  return {
    whereSql: where.length ? `WHERE ${where.join(' AND ')}` : '',
    params,
    limit: lim,
    limitPlaceholder,
  };
}

export function canResolveAutonomousTask({ role, username, ownerUsername, requesterUsername }) {
  const r = String(role || '').trim();
  const u = String(username || '').trim();
  if (isOpsViewerRole(r)) return true;
  return String(ownerUsername || '') === u || String(requesterUsername || '') === u;
}

/**
 * @returns {{ whereSql: string, params: unknown[], limitPlaceholder: string }}
 */
export function buildQualityAuditsFilter({ route, tenantId = 'default', limit } = {}) {
  const params = [];
  const push = (v) => {
    params.push(v);
    return `$${params.length}`;
  };
  const where = [];
  const rt = String(route || '').trim();
  if (rt) where.push(`route = ${push(rt)}`);
  where.push(`tenant_id = ${push(tenantId || 'default')}`);
  const lim = clampLimit(limit, { min: 1, max: 200, fallback: 50 });
  return {
    whereSql: where.length ? `WHERE ${where.join(' AND ')}` : '',
    params,
    limit: lim,
    limitPlaceholder: push(lim),
  };
}

/**
 * @param {import('pg').Pool} pool
 * @param {string} tenantId
 * @param {number|string} [limit]
 */
export async function listEvalSuiteRuns(pool, tenantId, limit) {
  const lim = clampLimit(limit, { min: 1, max: 50, fallback: 10 });
  const r = await pool.query(
    `SELECT id, suite_name, summary, created_by, created_at
         FROM agent_eval_runs
         WHERE tenant_id = $2
         ORDER BY created_at DESC
         LIMIT $1`,
    [lim, tenantId || 'default']
  );
  return r.rows || [];
}

/**
 * @param {import('pg').Pool} pool
 * @param {{ status?: string, role: string, username: string, tenantId?: string, limit?: number|string }} opts
 */
export async function listAutonomousTasks(pool, opts) {
  const { whereSql, params, limitPlaceholder } = buildAutonomousTasksFilter(opts);
  const r = await pool.query(
    `SELECT id, task_type, status, store, brand, requester_username, route, reason, owner_username, notify_count, due_at, created_at, updated_at
         FROM agent_autonomous_tasks
         ${whereSql}
         ORDER BY updated_at DESC
         LIMIT ${limitPlaceholder}`,
    params
  );
  return r.rows || [];
}

/**
 * @param {import('pg').Pool} pool
 * @param {{ id: string, role: string, username: string, note?: string, tenantId?: string }} opts
 * @returns {Promise<{ ok: true } | { ok: false, status: number, error: string }>}
 */
export async function resolveAutonomousTask(pool, opts) {
  const id = String(opts.id || '').trim();
  if (!id) return { ok: false, status: 400, error: 'missing_id' };
  const tenantIdQ = opts.tenantId || 'default';
  const owned = await pool.query(
    `SELECT owner_username, requester_username FROM agent_autonomous_tasks WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
    [id, tenantIdQ]
  );
  const row = owned.rows?.[0] || {};
  if (
    !canResolveAutonomousTask({
      role: opts.role,
      username: opts.username,
      ownerUsername: row.owner_username,
      requesterUsername: row.requester_username,
    })
  ) {
    return { ok: false, status: 403, error: 'forbidden' };
  }
  const note = String(opts.note || '').trim();
  await pool.query(
    `UPDATE agent_autonomous_tasks
         SET status = 'resolved',
             action_plan = jsonb_set(COALESCE(action_plan, '{}'::jsonb), '{resolutionNote}', to_jsonb($1::text), true),
             updated_at = NOW()
         WHERE id = $2 AND tenant_id = $3`,
    [note || 'resolved', id, tenantIdQ]
  );
  return { ok: true };
}

/**
 * @param {import('pg').Pool} pool
 * @param {{ route?: string, tenantId?: string, limit?: number|string }} opts
 */
export async function listQualityAudits(pool, opts) {
  const { whereSql, params, limitPlaceholder } = buildQualityAuditsFilter(opts);
  const r = await pool.query(
    `SELECT id, route, username, query_text, passed, rewrite_count, created_at
         FROM agent_quality_audits
         ${whereSql}
         ORDER BY created_at DESC
         LIMIT ${limitPlaceholder}`,
    params
  );
  return r.rows || [];
}
