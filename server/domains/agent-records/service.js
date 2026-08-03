/**
 * Agent 记录域：issues / scores / audits / appeals / messages / feishu-users /
 * agent-scores/me / hrms-notifications/me。
 */

export const STORE_SCOPED_ROLES = Object.freeze(['store_manager', 'store_production_manager']);
export const RECORDS_ADMIN_ROLES = Object.freeze(['admin', 'hq_manager', 'hr_manager']);

export function clampLimit(raw, { min = 1, max = 200, fallback = 50 } = {}) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

export function isStoreScopedRole(role) {
  return STORE_SCOPED_ROLES.includes(String(role || '').trim());
}

export function isRecordsAdminRole(role) {
  return RECORDS_ADMIN_ROLES.includes(String(role || '').trim());
}

/** 月度 new_model breakdown 已产出 A/B/C/D 时，不得被 employee_scores「待定」盖住 */
export function letterGradeOnly(v) {
  const s = String(v ?? '').trim().toUpperCase();
  return /^[ABCD]$/.test(s) ? s : null;
}

export function mergeProfileDim(breakdownVal, employeeVal) {
  return (
    letterGradeOnly(breakdownVal) ??
    letterGradeOnly(employeeVal) ??
    (String(employeeVal ?? '').trim() || null)
  );
}

export function shanghaiCalendarYm(now = new Date()) {
  return now.toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' }).slice(0, 7);
}

export function shanghaiPrevCalendarYm(now = new Date()) {
  const cur = shanghaiCalendarYm(now);
  const [y, m] = cur.split('-').map((x) => parseInt(x, 10));
  let mm = m - 1;
  let yy = y;
  if (mm < 1) {
    mm = 12;
    yy -= 1;
  }
  return `${yy}-${String(mm).padStart(2, '0')}`;
}

/** 档案绩效展示周期：每月 10 日（上海）起展示上月；10 日前仍展示上上月 */
export function profilePerformanceDisplayPeriodShanghai(now = new Date()) {
  const ymd = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
  const [y, m, d] = ymd.split('-').map((x) => parseInt(x, 10));
  const pad = (n) => String(n).padStart(2, '0');
  const subMonth = (yy, mm, delta) => {
    let M = mm + delta;
    let Y = yy;
    while (M < 1) {
      M += 12;
      Y -= 1;
    }
    while (M > 12) {
      M -= 12;
      Y += 1;
    }
    return `${Y}-${pad(M)}`;
  };
  if (d >= 10) return subMonth(y, m, -1);
  return subMonth(y, m, -2);
}

/** 马己仙出品观察号读主责 NNYXLYR04 的 new_model 行 */
export function resolveScoresUsername(username, store) {
  const u = String(username || '').trim();
  const majStore = /马己仙/.test(String(store || ''));
  const obsPm = u.toLowerCase() === 'nnyxcs35';
  return obsPm && majStore ? 'NNYXLYR04' : u;
}

export function parseBreakdownObject(rawBd) {
  let bd = rawBd;
  if (typeof bd === 'string') {
    try {
      bd = JSON.parse(bd);
    } catch {
      bd = null;
    }
  }
  return bd && typeof bd === 'object' && !Array.isArray(bd) ? bd : {};
}

/**
 * @returns {{ whereSql: string, params: unknown[], limitPlaceholder: string }}
 */
export function buildTenantScopedListFilter({
  role,
  username,
  tenantId = 'default',
  status,
  storeScopeColumn,
  limit,
  max = 200,
  fallback = 50,
} = {}) {
  const params = [];
  const push = (v) => {
    params.push(v);
    return `$${params.length}`;
  };
  const where = ['1=1'];
  if (storeScopeColumn && isStoreScopedRole(role)) {
    where.push(`${storeScopeColumn} = ${push(String(username || '').trim())}`);
  }
  const st = String(status || '').trim();
  if (st && st !== 'all') where.push(`status = ${push(st)}`);
  where.push(`tenant_id = ${push(tenantId || 'default')}`);
  const lim = clampLimit(limit, { min: 1, max, fallback });
  return {
    whereSql: where.join(' AND '),
    params,
    limitPlaceholder: push(lim),
  };
}

export async function listAgentIssues(pool, opts) {
  const { whereSql, params, limitPlaceholder } = buildTenantScopedListFilter({
    ...opts,
    storeScopeColumn: 'assignee_username',
  });
  const r = await pool.query(
    `SELECT * FROM agent_issues WHERE ${whereSql} ORDER BY created_at DESC LIMIT ${limitPlaceholder}`,
    params
  );
  return r.rows || [];
}

export async function resolveAgentIssue(pool, { id, resolution, tenantId = 'default' }) {
  const issueId = String(id || '').trim();
  if (!issueId) return { ok: false, status: 400, error: 'missing_id' };
  await pool.query(
    `UPDATE agent_issues SET status='resolved', resolution=$1, resolved_at=NOW(), updated_at=NOW() WHERE id=$2 AND tenant_id=$3`,
    [String(resolution || '').trim(), issueId, tenantId || 'default']
  );
  return { ok: true };
}

export async function listMyNotifications(pool, username, limit, opts = {}) {
  const u = String(username || '').trim();
  if (!u) return { ok: false, status: 400, error: 'missing_username' };
  const lim = clampLimit(limit, { min: 1, max: 100, fallback: 30 });
  const unreadOnly = opts.unreadOnly === true;
  const unreadSql = unreadOnly ? ' AND read_at IS NULL' : '';
  try {
    const r = await pool.query(
      `SELECT id, title, message, type, meta, created_at, read_at
         FROM hrms_user_notifications
         WHERE lower(target_username) = lower($1)${unreadSql}
         ORDER BY created_at DESC
         LIMIT $2`,
      [u, lim]
    );
    return { ok: true, items: r.rows || [] };
  } catch (e) {
    const msg = String(e?.message || '');
    if (msg.includes('does not exist')) return { ok: true, items: [] };
    // 兼容尚未跑 migration 的旧库（无 read_at）
    if (/read_at|column/i.test(msg)) {
      const r = await pool.query(
        `SELECT id, title, message, type, meta, created_at
           FROM hrms_user_notifications
           WHERE lower(target_username) = lower($1)${unreadSql}
           ORDER BY created_at DESC
           LIMIT $2`,
        [u, lim]
      );
      return { ok: true, items: (r.rows || []).map((row) => ({ ...row, read_at: null })) };
    }
    throw e;
  }
}

/**
 * 确认已读系统通知。同 assignment_id 的历史提醒一并标记，避免培训每日提醒堆积后逐条点完。
 */
export async function ackMyNotification(pool, username, id) {
  const u = String(username || '').trim();
  const notifId = String(id || '').trim().replace(/^db-/, '');
  if (!u) return { ok: false, status: 400, error: 'missing_username' };
  if (!notifId) return { ok: false, status: 400, error: 'missing_id' };
  try {
    const found = await pool.query(
      `SELECT id, meta, message FROM hrms_user_notifications
        WHERE id = $1 AND lower(target_username) = lower($2)
        LIMIT 1`,
      [notifId, u]
    );
    if (!found.rows?.length) return { ok: false, status: 404, error: 'not_found' };
    const assignmentId = String(found.rows[0]?.meta?.assignment_id || '').trim();
    const message = String(found.rows[0]?.message || '');
    // 2026-08-03：用户长期反馈"点了已读，下次打开同一条又弹出来"——根因是同一条通知在库里
    // 存在多条一模一样的副本（system-alert.js 双重插入，已单独修复），而这里只把用户点中的
    // 那一条 id 置为已读，孪生副本仍是未读，下次强制确认队列又把它捞出来弹一次。除了堵住
    // 产生重复的源头，这里再加一道兜底：本人名下 message 完全相同的未读副本一并标记已读——
    // 用户看到的"同一条通知"就该一次点掉，不该因为底层存了几份而被要求点几次；同时也能把
    // 修复前已经积压在库里的历史重复副本，在用户点第一次时顺带清干净。
    let r;
    if (assignmentId) {
      r = await pool.query(
        `UPDATE hrms_user_notifications
            SET read_at = COALESCE(read_at, NOW())
          WHERE lower(target_username) = lower($1)
            AND (
              id = $2
              OR COALESCE(meta->>'assignment_id', '') = $3
              OR message = $4
            )
            AND read_at IS NULL
          RETURNING id`,
        [u, notifId, assignmentId, message]
      );
    } else {
      r = await pool.query(
        `UPDATE hrms_user_notifications
            SET read_at = COALESCE(read_at, NOW())
          WHERE lower(target_username) = lower($1)
            AND (id = $2 OR message = $3)
            AND read_at IS NULL
          RETURNING id`,
        [u, notifId, message]
      );
    }
    return { ok: true, acked_ids: (r.rows || []).map((row) => String(row.id)), read_at: new Date().toISOString() };
  } catch (e) {
    if (/read_at|column/i.test(String(e?.message || ''))) {
      return { ok: false, status: 503, error: 'read_at_unavailable', message: '请先执行 migration 154' };
    }
    throw e;
  }
}

export async function listAgentScores(pool, opts) {
  const { whereSql, params, limitPlaceholder } = buildTenantScopedListFilter({
    ...opts,
    storeScopeColumn: 'username',
    max: 100,
    fallback: 20,
  });
  const r = await pool.query(
    `SELECT * FROM agent_scores WHERE ${whereSql} ORDER BY created_at DESC LIMIT ${limitPlaceholder}`,
    params
  );
  return r.rows || [];
}

export async function listVisualAudits(pool, opts) {
  const { whereSql, params, limitPlaceholder } = buildTenantScopedListFilter({
    ...opts,
    storeScopeColumn: 'username',
  });
  const r = await pool.query(
    `SELECT * FROM agent_visual_audits WHERE ${whereSql} ORDER BY created_at DESC LIMIT ${limitPlaceholder}`,
    params
  );
  return r.rows || [];
}

export async function createAppeal(pool, { username, reason, tenantId = 'default' }) {
  const u = String(username || '').trim();
  const rsn = String(reason || '').trim();
  if (!u || !rsn) return { ok: false, status: 400, error: 'missing_params' };
  const r = await pool.query(
    `INSERT INTO agent_appeals (username, reason, tenant_id) VALUES ($1,$2,$3) RETURNING id`,
    [u, rsn, tenantId || 'default']
  );
  return { ok: true, id: r.rows?.[0]?.id };
}

export async function listAppeals(pool, opts) {
  const { whereSql, params, limitPlaceholder } = buildTenantScopedListFilter({
    ...opts,
    storeScopeColumn: 'username',
    max: 100,
    fallback: 20,
  });
  const r = await pool.query(
    `SELECT * FROM agent_appeals WHERE ${whereSql} ORDER BY created_at DESC LIMIT ${limitPlaceholder}`,
    params
  );
  return r.rows || [];
}

export async function listAgentMessages(pool, { role, username, tenantId = 'default', limit } = {}) {
  const params = [];
  const push = (v) => {
    params.push(v);
    return `$${params.length}`;
  };
  const where = ['1=1'];
  if (!isRecordsAdminRole(role)) {
    where.push(`sender_username = ${push(String(username || '').trim())}`);
  }
  where.push(`tenant_id = ${push(tenantId || 'default')}`);
  const lim = clampLimit(limit, { min: 1, max: 200, fallback: 50 });
  const r = await pool.query(
    `SELECT id, direction, channel, sender_username, sender_name, routed_to, content_type, content, agent_response, created_at
         FROM agent_messages WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT ${push(lim)}`,
    params
  );
  return r.rows || [];
}

export async function listFeishuUsers(pool) {
  const r = await pool.query(`SELECT * FROM feishu_users ORDER BY created_at DESC LIMIT 100`);
  return r.rows || [];
}

/**
 * @param {import('pg').Pool} pool
 * @param {{
 *   username: string,
 *   tenantId?: string,
 *   now?: Date,
 *   getSharedState: (tenantId?: string) => Promise<object|null>,
 *   inferBrandFromStoreName: (store: string) => string|null,
 *   fetchStoreRatingForProfileDisplay: (store: string, period: string) => Promise<object>,
 *   calculateStoreRating: (store: string, brand: string, period: string) => Promise<unknown>,
 * }} deps
 */
export async function getMyAgentScore(pool, deps) {
  const username = String(deps.username || '').trim();
  if (!username) return { ok: false, status: 400, error: 'missing_username' };
  const now = deps.now || new Date();
  // 2026-08-01：我的绩效加月份筛选，deps.month=YYYY-MM 时直接查该月，不传保持原行为
  // （按10号分界显示上上月/上月的自动收口结果）。
  const monthOverride = /^\d{4}-\d{2}$/.test(String(deps.month || '')) ? String(deps.month) : '';
  const personalPeriod = monthOverride || profilePerformanceDisplayPeriodShanghai(now);
  const storePeriod = monthOverride || shanghaiPrevCalendarYm(now);
  const tenantIdQ = deps.tenantId || 'default';

  let store = null;
  let brand = null;
  try {
    const fu = await pool.query(
      `SELECT store FROM feishu_users WHERE lower(username) = lower($1) AND registered = true LIMIT 1`,
      [username]
    );
    store = String(fu.rows?.[0]?.store || '').trim() || null;
  } catch {
    /* ignore */
  }

  if (!store) {
    try {
      const state = await deps.getSharedState();
      const emps = [
        ...(Array.isArray(state?.employees) ? state.employees : []),
        ...(Array.isArray(state?.users) ? state.users : []),
      ];
      const me = emps.find(
        (e) => String(e?.username || '').trim().toLowerCase() === username.toLowerCase()
      );
      if (me?.store) store = String(me.store).trim();
    } catch {
      /* ignore */
    }
  }

  const es = await pool
    .query(
      `SELECT total_score, execution_rating, attitude_rating, ability_rating, period, store
         FROM employee_scores WHERE lower(username) = lower($1) AND period = $2 LIMIT 1`,
      [username, personalPeriod]
    )
    .catch(() => ({ rows: [] }));
  const emp = es.rows?.[0];
  if (!store && emp?.store) store = String(emp.store).trim();

  const scoresUsername = resolveScoresUsername(username, store);
  const asMonth = await pool
    .query(
      `SELECT total_score, breakdown, summary, period, brand, store
         FROM agent_scores
         WHERE lower(username) = lower($1) AND period = $2 AND period ~ '^[0-9]{4}-[0-9]{2}$'
           AND tenant_id = $3
         ORDER BY CASE WHEN score_model = 'new_model_monthly' THEN 0 ELSE 1 END,
                  updated_at DESC NULLS LAST
         LIMIT 1`,
      [scoresUsername, personalPeriod, tenantIdQ]
    )
    .catch(() => ({ rows: [] }));

  const rowM = asMonth.rows?.[0];
  if (!store && rowM?.store) store = String(rowM.store).trim();
  brand = rowM?.brand || null;
  if (store && !brand) brand = deps.inferBrandFromStoreName(store);

  let store_rating = null;
  let store_rating_period = null;
  let store_rating_is_fallback = false;
  if (store) {
    let srInfo = await deps.fetchStoreRatingForProfileDisplay(store, storePeriod);
    store_rating = srInfo.rating;
    store_rating_period = srInfo.period;
    store_rating_is_fallback = !!srInfo.isFallback;
    if (!store_rating) {
      try {
        await deps.calculateStoreRating(
          store,
          brand || deps.inferBrandFromStoreName(store),
          storePeriod
        );
        srInfo = await deps.fetchStoreRatingForProfileDisplay(store, storePeriod);
        store_rating = srInfo.rating;
        store_rating_period = srInfo.period;
        store_rating_is_fallback = !!srInfo.isFallback;
      } catch {
        /* ignore */
      }
    }
  }

  const bM = parseBreakdownObject(rowM?.breakdown);
  const total_score =
    emp?.total_score != null ? emp.total_score : rowM?.total_score != null ? rowM.total_score : null;
  const execution_rating = mergeProfileDim(bM.execution_rating, emp?.execution_rating);
  const attitude_rating = mergeProfileDim(bM.attitude_rating, emp?.attitude_rating);
  const ability_rating = mergeProfileDim(bM.ability_rating, emp?.ability_rating);
  const store_rating_out = store_rating ?? null;
  const summary = rowM?.summary || null;
  const period = personalPeriod;
  const displayPeriod = personalPeriod;
  const storeRatingPeriodNote = store_rating
    ? store_rating_is_fallback
      ? `门店级别展示「${store_rating_period}」月闭合结果（「${storePeriod}」月评级尚未生成，暂用最近一期）；每月 1 日（上海）起切换展示上月。`
      : `门店级别对应「${storePeriod}」月闭合结果；每月 1 日（上海）起随自然月切换为上月。`
    : `「${storePeriod}」月门店级别尚未生成；每月 1 日（上海）起展示上月闭合结果。`;
  const personalPerformanceNote = `个人绩效（得分与执行力/态度/能力）对应「${personalPeriod}」月闭合；每月 10 日（上海）起更新为上月的整月结果，10 日前仍展示上一闭合月，期间不变。`;
  const displayPeriodNote = `${storeRatingPeriodNote} ${personalPerformanceNote}`;

  return {
    ok: true,
    body: {
      total_score,
      breakdown: {
        ...bM,
        execution_rating,
        attitude_rating,
        ability_rating,
        store_rating: store_rating_out,
      },
      summary,
      period,
      displayPeriod,
      storeRatingDisplayPeriod: storePeriod,
      personalPerformanceDisplayPeriod: personalPeriod,
      storeRatingPeriodNote,
      personalPerformanceNote,
      displayPeriodNote,
      brand,
      store,
      execution_rating,
      attitude_rating,
      ability_rating,
      store_rating: store_rating_out,
      store_rating_period,
      store_rating_is_fallback,
      store_rating_matches_display_period: !!(
        store_rating_period && store_rating_period === storePeriod
      ),
      store_rating_is_prev_month: !!(
        store_rating_period && store_rating_period === shanghaiPrevCalendarYm(now)
      ),
    },
  };
}
