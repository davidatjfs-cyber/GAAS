/**
 * Agent 数据中心只读聚合：dashboard / brief / activity-detail / score-provenance /
 * employee-live-dashboard。
 * 纯逻辑 + SQL，不碰 req/res。
 */

import {
  pgGetMonthlyAttitudeFilingCount,
  pgGetMonthlyExecutionFilingCount,
} from '../../lib/performance-filing-counts-pg.js';

export const DASHBOARD_ROLES = Object.freeze([
  'admin',
  'hq_manager',
  'hr_manager',
  'store_manager',
  'front_manager',
  'store_production_manager',
]);

export const BRIEF_ROLES = Object.freeze(['admin', 'hq_manager', 'hr_manager']);

export function shanghaiYmd(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(d);
}

export function resolveActivitySummaryDate(activityDate, todayYmd = shanghaiYmd()) {
  const actPick = String(activityDate || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(actPick) ? actPick : todayYmd;
}

export function clampLimit(raw, { min = 1, max = 60, fallback = 30 } = {}) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

export function mergeAdminAlerts(agentRows, hrmsRows, limit = 35) {
  return [...(agentRows || []), ...(hrmsRows || [])]
    .sort((a, b) => String(b?.sent_at || '').localeCompare(String(a?.sent_at || '')))
    .slice(0, limit);
}

/**
 * @param {{
 *   issues: object,
 *   scores: object,
 *   audits: object,
 *   messages: object,
 *   feishuUsers: object,
 *   generic: object,
 *   performance: object,
 * }} parts
 */
export function buildDashboardPayload(parts) {
  const iss = parts.issues || {};
  const sc = parts.scores || {};
  const au = parts.audits || {};
  const msg = parts.messages || {};
  const usr = parts.feishuUsers || {};
  const gen = parts.generic || {};
  return {
    issues: iss,
    scores: sc,
    audits: au,
    messages: { total_7d: Number(msg.total || 0) },
    feishuUsers: usr,
    performance: parts.performance,
    openIssues: Number(iss.open || 0),
    highOpenIssues: Number(iss.high_open || 0),
    avgScore: sc.avg_score != null ? Number(sc.avg_score) : null,
    totalScores: Number(sc.total || 0),
    totalAudits: Number(au.total || 0),
    failedAudits: Number(au.failed || 0),
    totalMessages: Number(msg.total || 0),
    totalFeishuUsers: Number(usr.total || 0),
    registeredFeishuUsers: Number(usr.registered || 0),
    totalGenericRecords: Number(gen.total || 0),
  };
}

/**
 * @param {import('pg').Pool} pool
 * @param {string} tenantId
 * @param {() => object} getAgentPerformanceMetrics
 */
export async function getDashboardSummary(pool, tenantId, getAgentPerformanceMetrics) {
  const tenantIdQ = tenantId || 'default';
  const [issuesR, scoresR, auditsR, messagesR, usersR, genericR] = await Promise.all([
    pool.query(
      `SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE status='open') as open, COUNT(*) FILTER (WHERE severity='high' AND status='open') as high_open FROM agent_issues WHERE tenant_id = $1`,
      [tenantIdQ]
    ),
    pool.query(
      `SELECT COUNT(*) as total, ROUND(AVG(total_score)::numeric, 1) as avg_score FROM agent_scores WHERE created_at > NOW() - INTERVAL '30 days' AND tenant_id = $1`,
      [tenantIdQ]
    ),
    pool.query(
      `SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE result='fail') as failed, COUNT(*) FILTER (WHERE duplicate_of IS NOT NULL) as duplicates FROM agent_visual_audits WHERE created_at > NOW() - INTERVAL '30 days' AND tenant_id = $1`,
      [tenantIdQ]
    ),
    pool.query(
      `SELECT COUNT(*) as total FROM agent_messages WHERE created_at > NOW() - INTERVAL '7 days' AND tenant_id = $1`,
      [tenantIdQ]
    ),
    pool.query(`SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE registered=TRUE) as registered FROM feishu_users`),
    pool.query(`SELECT COUNT(*) as total FROM feishu_generic_records`),
  ]);
  return buildDashboardPayload({
    issues: issuesR.rows[0] || {},
    scores: scoresR.rows[0] || {},
    audits: auditsR.rows[0] || {},
    messages: messagesR.rows[0] || {},
    feishuUsers: usersR.rows[0] || {},
    generic: genericR.rows[0] || {},
    performance: typeof getAgentPerformanceMetrics === 'function' ? getAgentPerformanceMetrics() : {},
  });
}

/**
 * @param {import('pg').Pool} pool
 * @param {{
 *   username: string,
 *   tenantId: string,
 *   activityDate?: string,
 *   cronJobLabelZh: (key: string) => string,
 * }} opts
 */
export async function getDataCenterBrief(pool, opts) {
  const username = String(opts.username || '').trim();
  const tenantIdQ = opts.tenantId || 'default';
  const shToday = shanghaiYmd();
  const summaryYmd = resolveActivitySummaryDate(opts.activityDate, shToday);
  const cronJobLabelZh = opts.cronJobLabelZh || ((k) => k);

  const [
    alertsR,
    hrmsAlertsR,
    cronR,
    taskCntR,
    rhythmCntR,
    anomalyCntR,
    alertTodayR,
    hrmsAlertTodayR,
    perfRollupR,
  ] = await Promise.all([
    pool
      .query(
        `SELECT id, priority, alert_type, title, LEFT(body, 400) AS body_preview, sent_at
             FROM agent_admin_alert_log
             WHERE tenant_id = $1
             ORDER BY sent_at DESC
             LIMIT 35`,
        [tenantIdQ]
      )
      .catch(() => ({ rows: [] })),
    pool
      .query(
        `SELECT id,
                    'medium'::text AS priority,
                    type AS alert_type,
                    title,
                    LEFT(message, 400) AS body_preview,
                    created_at AS sent_at
             FROM hrms_user_notifications
             WHERE target_username = $1
               AND type IN ('system_alert', 'system_alert_test')
             ORDER BY created_at DESC
             LIMIT 35`,
        [username]
      )
      .catch(() => ({ rows: [] })),
    pool
      .query(
        `SELECT job_key, run_ymd, ok, LEFT(COALESCE(error,''), 200) AS error_preview, created_at
             FROM agent_v2_cron_runs
             WHERE tenant_id = $1
             ORDER BY created_at DESC
             LIMIT 45`,
        [tenantIdQ]
      )
      .catch(() => ({ rows: [] })),
    pool
      .query(
        `SELECT COUNT(*)::int AS c FROM agent_task_logs
             WHERE (created_at AT TIME ZONE 'Asia/Shanghai')::date = $1::date AND tenant_id = $2`,
        [summaryYmd, tenantIdQ]
      )
      .catch(() => ({ rows: [{ c: 0 }] })),
    pool
      .query(`SELECT COUNT(*)::int AS c FROM rhythm_logs WHERE execution_date = $1::date`, [summaryYmd])
      .catch(() => ({ rows: [{ c: 0 }] })),
    pool
      .query(`SELECT COUNT(*)::int AS c FROM anomaly_triggers WHERE trigger_date = $1::date`, [summaryYmd])
      .catch(() => ({ rows: [{ c: 0 }] })),
    pool
      .query(
        `SELECT COUNT(*)::int AS c FROM agent_admin_alert_log
             WHERE DATE(timezone('Asia/Shanghai', sent_at)) = $1::date AND tenant_id = $2`,
        [summaryYmd, tenantIdQ]
      )
      .catch(() => ({ rows: [{ c: 0 }] })),
    pool
      .query(
        `SELECT COUNT(*)::int AS c
             FROM hrms_user_notifications
             WHERE target_username = $1
               AND type IN ('system_alert', 'system_alert_test')
               AND DATE(timezone('Asia/Shanghai', created_at)) = $2::date`,
        [username, summaryYmd]
      )
      .catch(() => ({ rows: [{ c: 0 }] })),
    pool
      .query(
        `SELECT ROUND(AVG(total_score)::numeric, 1) AS avg_bi,
                    COUNT(*)::int AS rollup_rows
             FROM agent_scores
             WHERE score_model = 'anomaly_rollups_v2'
               AND COALESCE(is_invalidated, false) = false
               AND updated_at > NOW() - INTERVAL '14 days'
               AND tenant_id = $1`,
        [tenantIdQ]
      )
      .catch(() => ({ rows: [{ avg_bi: null, rollup_rows: 0 }] })),
  ]);

  return {
    shanghaiDate: shToday,
    activitySummaryDate: summaryYmd,
    dualWrite: {
      summary:
        'HRMS 在审批与全量保存时双写到独立表（员工、休假、奖惩、积分、考勤、薪资域等）。失败会向管理群飞书告警；请关注下方「管理告警」。',
      scopes: ['全量 state→表', '休假/奖惩/积分/考勤审批流', '薪资域异步双写'],
    },
    activityToday: {
      agentTaskLogs: Number(taskCntR.rows?.[0]?.c || 0),
      rhythmRuns: Number(rhythmCntR.rows?.[0]?.c || 0),
      anomalyTriggers: Number(anomalyCntR.rows?.[0]?.c || 0),
      adminAlerts: Number(alertTodayR.rows?.[0]?.c || 0) + Number(hrmsAlertTodayR.rows?.[0]?.c || 0),
    },
    performanceRollup14d: {
      avgScore: perfRollupR.rows?.[0]?.avg_bi != null ? Number(perfRollupR.rows[0].avg_bi) : null,
      rowCount: Number(perfRollupR.rows?.[0]?.rollup_rows || 0),
    },
    adminAlerts: mergeAdminAlerts(alertsR.rows, hrmsAlertsR.rows, 35),
    cronRuns: (cronR.rows || []).map((row) => ({
      ...row,
      job_label_zh: cronJobLabelZh(row.job_key),
    })),
  };
}

/**
 * @param {import('pg').Pool} pool
 * @param {string} date
 * @param {string} tenantId
 */
export async function getActivityDetail(pool, date, tenantId) {
  const ymd =
    String(date || '').trim() || shanghaiYmd();
  const tenantIdQ = tenantId || 'default';
  const [taskR, rhythmR, anomalyR, mtR] = await Promise.all([
    pool
      .query(
        `SELECT t.agent, t.store, t.username,
                    COALESCE(NULLIF(TRIM(fu.name), ''), NULLIF(TRIM(t.username), ''), '—') AS display_name,
                    t.latency_ms, t.has_evidence, t.evidence_violation, t.created_at
             FROM agent_task_logs t
             LEFT JOIN LATERAL (
               SELECT name FROM feishu_users
               WHERE registered = true AND t.username IS NOT NULL
                 AND LOWER(TRIM(username)) = LOWER(TRIM(t.username))
               ORDER BY updated_at DESC NULLS LAST
               LIMIT 1
             ) fu ON true
             WHERE (t.created_at AT TIME ZONE 'Asia/Shanghai')::date = $1::date
               AND t.tenant_id = $2
             ORDER BY t.created_at DESC
             LIMIT 80`,
        [ymd, tenantIdQ]
      )
      .catch(() => ({ rows: [] })),
    pool
      .query(
        `SELECT rhythm_type, status, execution_date,
                    LEFT(COALESCE(result_summary::text, ''), 24000) AS result_summary,
                    LEFT(COALESCE(error_message, ''), 160) AS error_message, execution_time, created_at
             FROM rhythm_logs
             WHERE execution_date = $1::date
             ORDER BY created_at DESC
             LIMIT 40`,
        [ymd]
      )
      .catch(() => ({ rows: [] })),
    pool
      .query(
        `SELECT store, anomaly_key, severity, trigger_date, LEFT(COALESCE(status,''), 20) AS status, created_at
             FROM anomaly_triggers
             WHERE trigger_date = $1::date
             ORDER BY created_at DESC
             LIMIT 60`,
        [ymd]
      )
      .catch(() => ({ rows: [] })),
    pool
      .query(
        `SELECT m.task_id, m.title, m.store, m.priority, m.status,
                    m.assignee_username,
                    COALESCE(NULLIF(TRIM(fu.name), ''), m.assignee_username) AS assignee_name,
                    m.dispatched_at, m.created_at, m.resolved_at
             FROM master_tasks m
             LEFT JOIN LATERAL (
               SELECT name FROM feishu_users
               WHERE registered = true AND m.assignee_username IS NOT NULL
                 AND LOWER(TRIM(username)) = LOWER(TRIM(m.assignee_username))
               ORDER BY updated_at DESC NULLS LAST
               LIMIT 1
             ) fu ON true
             WHERE ((timezone('Asia/Shanghai', COALESCE(m.dispatched_at, m.created_at)))::date = $1::date
                OR (m.resolved_at IS NOT NULL AND (m.resolved_at AT TIME ZONE 'Asia/Shanghai')::date = $1::date))
               AND m.tenant_id = $2
             ORDER BY m.created_at DESC
             LIMIT 50`,
        [ymd, tenantIdQ]
      )
      .catch(() => ({ rows: [] })),
  ]);
  return {
    date: ymd,
    taskLogs: taskR.rows || [],
    rhythmLogs: rhythmR.rows || [],
    anomalyTriggers: anomalyR.rows || [],
    masterTasks: mtR.rows || [],
  };
}

/**
 * Resolve feishu user by username / exact name / ILIKE.
 * @returns {Promise<
 *   | { ok: true, username: string, resolvedName: string }
 *   | { ok: false, status: number, body: object }
 * >}
 */
export async function resolveFeishuUserFromQuery(pool, raw) {
  const q = String(raw || '').trim();
  if (!q) {
    return { ok: false, status: 400, body: { error: 'q or username required' } };
  }
  const byUser = await pool
    .query(
      `SELECT username, COALESCE(NULLIF(TRIM(name), ''), username) AS disp
           FROM feishu_users
           WHERE registered = true AND LOWER(TRIM(username)) = LOWER(TRIM($1))
           LIMIT 1`,
      [q]
    )
    .catch(() => ({ rows: [] }));
  if (byUser.rows?.length) {
    return { ok: true, username: byUser.rows[0].username, resolvedName: byUser.rows[0].disp };
  }
  const byExactName = await pool
    .query(
      `SELECT username, COALESCE(NULLIF(TRIM(name), ''), username) AS disp
             FROM feishu_users
             WHERE registered = true AND TRIM(name) = $1
             ORDER BY updated_at DESC NULLS LAST
             LIMIT 8`,
      [q]
    )
    .catch(() => ({ rows: [] }));
  if (byExactName.rows?.length === 1) {
    return {
      ok: true,
      username: byExactName.rows[0].username,
      resolvedName: byExactName.rows[0].disp,
    };
  }
  if (byExactName.rows?.length > 1) {
    return {
      ok: false,
      status: 409,
      body: {
        error: 'ambiguous_name',
        message: '存在多名同姓名用户，请改用飞书账号或补全区分信息',
        query: q,
        candidates: byExactName.rows.map((r) => ({ username: r.username, name: r.disp })),
      },
    };
  }
  const byLike = await pool
    .query(
      `SELECT username, COALESCE(NULLIF(TRIM(name), ''), username) AS disp
               FROM feishu_users
               WHERE registered = true AND name ILIKE $1
               ORDER BY updated_at DESC NULLS LAST
               LIMIT 8`,
      [`%${q}%`]
    )
    .catch(() => ({ rows: [] }));
  if (byLike.rows?.length === 1) {
    return { ok: true, username: byLike.rows[0].username, resolvedName: byLike.rows[0].disp };
  }
  if (byLike.rows?.length > 1) {
    return {
      ok: false,
      status: 409,
      body: {
        error: 'ambiguous_match',
        message: '匹配到多名用户，请缩小关键词或改用飞书账号',
        query: q,
        candidates: byLike.rows.map((r) => ({ username: r.username, name: r.disp })),
      },
    };
  }
  return {
    ok: false,
    status: 404,
    body: {
      error: 'not_found',
      message: '未找到匹配的飞书用户（可试姓名全称或账号）',
      query: q,
    },
  };
}

/**
 * @param {import('pg').Pool} pool
 * @param {{ query: string, tenantId: string, limit?: number|string }} opts
 */
export async function getScoreProvenance(pool, opts) {
  const raw = String(opts.query || '').trim();
  const lim = clampLimit(opts.limit, { min: 1, max: 60, fallback: 30 });
  const resolved = await resolveFeishuUserFromQuery(pool, raw);
  if (!resolved.ok) return resolved;

  const tenantIdQ = opts.tenantId || 'default';
  const scoresR = await pool
    .query(
      `SELECT period, score_model, total_score, summary,
                  LEFT(COALESCE(deductions::text, ''), 3500) AS deductions_preview,
                  updated_at, store, role
           FROM agent_scores
           WHERE LOWER(TRIM(username)) = LOWER(TRIM($1))
             AND tenant_id = $3
           ORDER BY updated_at DESC
           LIMIT $2`,
      [resolved.username, lim, tenantIdQ]
    )
    .catch(() => ({ rows: [] }));
  let notif = { rows: [] };
  try {
    notif = await pool.query(
      `SELECT title, type, LEFT(message, 800) AS message_preview, created_at
            FROM hrms_user_notifications
            WHERE target_username = $1
            ORDER BY created_at DESC
            LIMIT $2`,
      [resolved.username, lim]
    );
  } catch (_e) {
    notif = { rows: [] };
  }
  return {
    ok: true,
    body: {
      query: raw,
      username: resolved.username,
      resolvedName: resolved.resolvedName,
      scores: scoresR.rows || [],
      notifications: notif.rows || [],
    },
  };
}

export function resolvePeriodYm(period, todayYmd = shanghaiYmd()) {
  const p = String(period || '').trim();
  if (/^\d{4}-\d{2}$/.test(p)) return p;
  return String(todayYmd || '').slice(0, 7);
}

export function monthBoundsFromPeriod(period) {
  const [py, pm] = String(period || '').split('-');
  const monthStart = `${py}-${pm}-01`;
  const monthLastDay = String(new Date(Number(py), Number(pm), 0).getDate()).padStart(2, '0');
  const monthEnd = `${py}-${pm}-${monthLastDay}`;
  const monthKey = `${py}${String(pm).padStart(2, '0')}`;
  return { monthStart, monthEnd, monthKey, py, pm };
}

export function parseRollupBreakdown(bd) {
  if (bd == null) return {};
  if (typeof bd === 'string') {
    try {
      const o = JSON.parse(bd);
      return o && typeof o === 'object' ? o : {};
    } catch {
      return {};
    }
  }
  return bd && typeof bd === 'object' ? bd : {};
}

/**
 * Prefer「本月累计扣分」from latest rollup; else sum「本周扣分」across weeks.
 * @param {object|null|undefined} latestRollupRow
 * @param {Array<{breakdown?: unknown}>} weekRows
 */
export function computeMonthBiDeducted(latestRollupRow, weekRows) {
  let monthBiDeducted = null;
  if (latestRollupRow) {
    const b0 = parseRollupBreakdown(latestRollupRow.breakdown);
    const cum = Number(b0['本月累计扣分']);
    if (Number.isFinite(cum)) monthBiDeducted = cum;
  }
  if (monthBiDeducted == null || !Number.isFinite(monthBiDeducted)) {
    let sumWeek = 0;
    for (const rw of weekRows || []) {
      const b = parseRollupBreakdown(rw.breakdown);
      const w = Number(b['本周扣分']);
      if (Number.isFinite(w)) sumWeek += w;
    }
    monthBiDeducted = sumWeek;
  }
  if (!Number.isFinite(monthBiDeducted)) monthBiDeducted = 0;
  return monthBiDeducted;
}

const MONTH_ROLLUP_WHERE = `LOWER(TRIM(username)) = LOWER(TRIM($1))
       AND score_model = 'anomaly_rollups_v2'
       AND COALESCE(is_invalidated, false) = false
       AND period LIKE 'week_%'
       AND (
         (POSITION('__' IN period) = 0
           AND substring(period from 6 for 10)::date >= $2::date
           AND substring(period from 6 for 10)::date <= $3::date)
         OR
         (POSITION('__' IN period) > 0 AND split_part(period, '__', 2) = $4)
       )
       AND tenant_id = $5`;

/**
 * @param {import('pg').Pool} pool
 * @param {{ query: string, tenantId?: string, period?: string }} opts
 * @returns {Promise<{ ok: true, body: object } | { ok: false, status: number, body: object }>}
 */
export async function getEmployeeLiveDashboard(pool, opts) {
  const raw = String(opts.query || '').trim();
  const asOf = shanghaiYmd();
  const period = resolvePeriodYm(opts.period, asOf);
  const resolved = await resolveFeishuUserFromQuery(pool, raw);
  if (!resolved.ok) return resolved;

  const resolvedUsername = resolved.username;
  const tenantIdQ = opts.tenantId || 'default';
  const { monthStart, monthEnd, monthKey } = monthBoundsFromPeriod(period);

  const prof = await pool
    .query(
      `SELECT store, role
           FROM feishu_users
           WHERE registered = true AND LOWER(TRIM(username)) = LOWER(TRIM($1))
           ORDER BY updated_at DESC NULLS LAST
           LIMIT 1`,
      [resolvedUsername]
    )
    .catch(() => ({ rows: [] }));
  const store = String(prof.rows?.[0]?.store || '').trim();
  const feishuRole = String(prof.rows?.[0]?.role || '').trim();

  const latestRollupInMonth = await pool
    .query(
      `SELECT total_score, breakdown, period, updated_at
           FROM agent_scores
           WHERE ${MONTH_ROLLUP_WHERE}
           ORDER BY updated_at DESC NULLS LAST
           LIMIT 1`,
      [resolvedUsername, monthStart, monthEnd, monthKey, tenantIdQ]
    )
    .catch(() => ({ rows: [] }));

  const rollupHead = latestRollupInMonth.rows?.[0];
  let weekRows = [];
  const headCum = rollupHead
    ? Number(parseRollupBreakdown(rollupHead.breakdown)['本月累计扣分'])
    : NaN;
  if (!Number.isFinite(headCum)) {
    const allWeeks = await pool
      .query(
        `SELECT breakdown FROM agent_scores WHERE ${MONTH_ROLLUP_WHERE} ORDER BY period ASC`,
        [resolvedUsername, monthStart, monthEnd, monthKey, tenantIdQ]
      )
      .catch(() => ({ rows: [] }));
    weekRows = allWeeks.rows || [];
  }
  const monthBiDeducted = computeMonthBiDeducted(rollupHead, weekRows);
  const latestPerformanceScore = 100 - monthBiDeducted;

  const empR = await pool
    .query(
      `SELECT store, role, total_score, execution_rating, attitude_rating, ability_rating,
                  base_score, exception_bonus, exception_deduction, updated_at
           FROM employee_scores
           WHERE LOWER(TRIM(username)) = LOWER(TRIM($1)) AND period = $2
           ORDER BY updated_at DESC NULLS LAST`,
      [resolvedUsername, period]
    )
    .catch(() => ({ rows: [] }));

  const latestWeek = await pool
    .query(
      `SELECT period, total_score, updated_at, LEFT(COALESCE(summary, ''), 200) AS summary
           FROM agent_scores
           WHERE LOWER(TRIM(username)) = LOWER(TRIM($1))
             AND score_model = 'anomaly_rollups_v2'
             AND period LIKE 'week_%'
             AND tenant_id = $2
           ORDER BY updated_at DESC NULLS LAST
           LIMIT 1`,
      [resolvedUsername, tenantIdQ]
    )
    .catch(() => ({ rows: [] }));

  let executionFiling = 0;
  if (store) {
    executionFiling = await pgGetMonthlyExecutionFilingCount(pool, resolvedUsername, store, asOf);
  }
  const attitudeFiling = await pgGetMonthlyAttitudeFilingCount(pool, resolvedUsername, asOf);

  return {
    ok: true,
    body: {
      query: raw,
      period,
      as_of_shanghai: asOf,
      username: resolvedUsername,
      resolvedName: resolved.resolvedName,
      store,
      feishu_role: feishuRole,
      month_bi_deducted_total: monthBiDeducted,
      latest_performance_score: latestPerformanceScore,
      rollup_breakdown_source_period: rollupHead?.period || null,
      employee_scores_rows: empR.rows || [],
      latest_weekly_anomaly_row: latestWeek.rows?.[0] || null,
      execution_filing_count: executionFiling,
      attitude_filing_count: attitudeFiling,
      ability_filing_count: 0,
      ability_filing_note:
        '能力维度为毛利率/点评等指标评级，当前无与「能力」对应的独立备案任务计数（与飞书绩效卡一致仅统计执行力日评 + 态度任务备案）。',
    },
  };
}
