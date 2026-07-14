/**
 * 销售人员管理：花名册 + 每日行为汇总 + KPI目标/得分
 * 销售人员不登录后台，仅通过 rep_key 字符串与 sales_leads.owner_username / sales_tasks.assignee 关联。
 */

// final_score 三段权重，集中定义方便调整
const SCORE_WEIGHTS = { outcome: 0.5, behavior: 0.4, manager: 0.1 };

function toDateStr(d) {
  return d.toISOString().slice(0, 10);
}

function yesterdayStr() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return toDateStr(d);
}

// 解析 ISO 周 'YYYY-Www' -> 该周（周一至周日）的起止日期（含）
function isoWeekRange(periodKey) {
  const m = String(periodKey || '').match(/^(\d{4})-W(\d{2})$/);
  if (!m) throw new Error(`invalid week period_key: ${periodKey}`);
  const year = Number(m[1]);
  const week = Number(m[2]);
  // ISO周4号规则：该年第1周包含1月4日
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7; // 周一=1 ... 周日=7
  const week1Monday = new Date(jan4);
  week1Monday.setUTCDate(jan4.getUTCDate() - (jan4Day - 1));
  const start = new Date(week1Monday);
  start.setUTCDate(week1Monday.getUTCDate() + (week - 1) * 7);
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 6);
  return { start: toDateStr(start), end: toDateStr(end) };
}

// 解析月 'YYYY-MM' -> 该月起止日期（含）
function monthRange(periodKey) {
  const m = String(periodKey || '').match(/^(\d{4})-(\d{2})$/);
  if (!m) throw new Error(`invalid month period_key: ${periodKey}`);
  const year = Number(m[1]);
  const month = Number(m[2]);
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 0));
  return { start: toDateStr(start), end: toDateStr(end) };
}

function periodRange(periodType, periodKey) {
  if (periodType === 'week') return isoWeekRange(periodKey);
  if (periodType === 'month') return monthRange(periodKey);
  throw new Error(`invalid period_type: ${periodType}`);
}

export async function listSalesReps(pool, { status } = {}) {
  try {
    const st = String(status || '').trim();
    const r = await pool.query(
      `SELECT * FROM sales_reps WHERE ($1::text = '' OR status = $1) ORDER BY display_name ASC`,
      [st]
    );
    return r.rows || [];
  } catch (e) {
    console.error('[sales-rep] listSalesReps failed:', e?.message || e);
    throw e;
  }
}

export async function createOrUpdateSalesRep(pool, { repKey, displayName, role, status, hireDate }) {
  try {
    const r = await pool.query(
      `INSERT INTO sales_reps (rep_key, display_name, role, status, hire_date)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (rep_key) DO UPDATE SET
         display_name = EXCLUDED.display_name,
         role = COALESCE(EXCLUDED.role, sales_reps.role),
         status = COALESCE(EXCLUDED.status, sales_reps.status),
         hire_date = COALESCE(EXCLUDED.hire_date, sales_reps.hire_date),
         updated_at = NOW()
       RETURNING *`,
      [repKey, displayName, role || 'sales', status || 'active', hireDate || null]
    );
    return r.rows?.[0] || null;
  } catch (e) {
    console.error('[sales-rep] createOrUpdateSalesRep failed:', e?.message || e);
    throw e;
  }
}

/**
 * 计算某个销售在某一天的行为数据（不落库）。
 */
export async function computeDailyActivityForRep(pool, repKey, dateStr) {
  try {
    const [repliesRes, touchedRes, respTimeRes, completedRes, overdueRes, priceGuardRes] = await Promise.all([
      pool.query(
        `SELECT COUNT(*) AS cnt
           FROM sales_messages m
           JOIN sales_leads l ON l.id = m.lead_id
          WHERE m.direction = 'outbound' AND m.sender = 'human'
            AND l.owner_username = $1
            AND m.created_at::date = $2::date`,
        [repKey, dateStr]
      ),
      pool.query(
        `SELECT COUNT(DISTINCT m.lead_id) AS cnt
           FROM sales_messages m
           JOIN sales_leads l ON l.id = m.lead_id
          WHERE m.direction = 'outbound' AND m.sender = 'human'
            AND l.owner_username = $1
            AND m.created_at::date = $2::date`,
        [repKey, dateStr]
      ),
      // 应答对：当天某条 inbound 之后，该销售第一条 outbound(human) 回复的间隔分钟数
      pool.query(
        `SELECT AVG(EXTRACT(EPOCH FROM (reply.created_at - inbound.created_at)) / 60.0) AS avg_minutes
           FROM sales_messages inbound
           JOIN sales_leads l ON l.id = inbound.lead_id
           JOIN LATERAL (
             SELECT m2.created_at
               FROM sales_messages m2
              WHERE m2.conversation_id = inbound.conversation_id
                AND m2.direction = 'outbound' AND m2.sender = 'human'
                AND m2.created_at > inbound.created_at
              ORDER BY m2.created_at ASC
              LIMIT 1
           ) reply ON TRUE
          WHERE inbound.direction = 'inbound'
            AND l.owner_username = $1
            AND inbound.created_at::date = $2::date`,
        [repKey, dateStr]
      ),
      pool.query(
        `SELECT COUNT(*) AS cnt
           FROM sales_tasks
          WHERE assignee = $1 AND status = 'done'
            AND updated_at::date = $2::date`,
        [repKey, dateStr]
      ),
      pool.query(
        `SELECT COUNT(*) AS cnt
           FROM sales_tasks
          WHERE assignee = $1 AND status <> 'done'
            AND due_at IS NOT NULL AND due_at < NOW()`,
        [repKey]
      ),
      pool.query(
        `SELECT COUNT(*) AS cnt
           FROM sales_messages m
           JOIN sales_leads l ON l.id = m.lead_id
          WHERE m.meta->>'source' = 'handoff_template_price_guard'
            AND l.owner_username = $1
            AND m.created_at::date = $2::date`,
        [repKey, dateStr]
      ),
    ]);

    const avgMinutesRaw = respTimeRes.rows?.[0]?.avg_minutes;
    return {
      replies_sent: Number(repliesRes.rows?.[0]?.cnt || 0),
      avg_response_minutes: avgMinutesRaw != null ? Number(Number(avgMinutesRaw).toFixed(2)) : null,
      leads_touched: Number(touchedRes.rows?.[0]?.cnt || 0),
      tasks_completed: Number(completedRes.rows?.[0]?.cnt || 0),
      overdue_tasks: Number(overdueRes.rows?.[0]?.cnt || 0),
      price_guard_triggers: Number(priceGuardRes.rows?.[0]?.cnt || 0),
    };
  } catch (e) {
    console.error('[sales-rep] computeDailyActivityForRep failed:', e?.message || e);
    throw e;
  }
}

export async function runDailyActivityRollup(pool, { dateStr } = {}) {
  const day = dateStr || yesterdayStr();
  try {
    const reps = await listSalesReps(pool, { status: 'active' });
    const results = [];
    for (const rep of reps) {
      try {
        const activity = await computeDailyActivityForRep(pool, rep.rep_key, day);
        const r = await pool.query(
          `INSERT INTO sales_daily_activity
             (rep_id, activity_date, replies_sent, avg_response_minutes, leads_touched, tasks_completed, overdue_tasks, price_guard_triggers)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
           ON CONFLICT (rep_id, activity_date) DO UPDATE SET
             replies_sent = EXCLUDED.replies_sent,
             avg_response_minutes = EXCLUDED.avg_response_minutes,
             leads_touched = EXCLUDED.leads_touched,
             tasks_completed = EXCLUDED.tasks_completed,
             overdue_tasks = EXCLUDED.overdue_tasks,
             price_guard_triggers = EXCLUDED.price_guard_triggers
           RETURNING *`,
          [
            rep.id,
            day,
            activity.replies_sent,
            activity.avg_response_minutes,
            activity.leads_touched,
            activity.tasks_completed,
            activity.overdue_tasks,
            activity.price_guard_triggers,
          ]
        );
        results.push(r.rows?.[0] || null);
      } catch (e) {
        console.warn(`[sales-rep] rollup failed for rep ${rep.rep_key}:`, e?.message || e);
      }
    }
    return results;
  } catch (e) {
    console.error('[sales-rep] runDailyActivityRollup failed:', e?.message || e);
    throw e;
  }
}

export async function upsertKpiTarget(pool, { repId, periodType, periodKey, targetNewLeads, targetDemos, targetDeals, targetRevenueFen, createdBy }) {
  try {
    const r = await pool.query(
      `INSERT INTO sales_kpi_targets (rep_id, period_type, period_key, target_new_leads, target_demos, target_deals, target_revenue_fen, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (rep_id, period_type, period_key) DO UPDATE SET
         target_new_leads = EXCLUDED.target_new_leads,
         target_demos = EXCLUDED.target_demos,
         target_deals = EXCLUDED.target_deals,
         target_revenue_fen = EXCLUDED.target_revenue_fen,
         created_by = EXCLUDED.created_by,
         updated_at = NOW()
       RETURNING *`,
      [repId, periodType, periodKey, targetNewLeads || 0, targetDemos || 0, targetDeals || 0, targetRevenueFen || 0, createdBy || null]
    );
    return r.rows?.[0] || null;
  } catch (e) {
    console.error('[sales-rep] upsertKpiTarget failed:', e?.message || e);
    throw e;
  }
}

// 完成率封顶100，无目标时视为0（避免除0）
function pctOfTarget(actual, target) {
  if (!target) return 0;
  return Math.min(100, (actual / target) * 100);
}

/**
 * 行为分计算思路（0~100分，简单加权，便于后续调整）：
 * - 响应速度分（40%）：平均响应分钟数越低分越高。以30分钟为满分基准，>=180分钟记0分，线性插值。
 * - 逾期分（35%）：以当期最后一天的 overdue_tasks 快照为准，0条逾期=满分，每条逾期扣10分，封底0分。
 * - 价格拦截分（25%）：price_guard_triggers 越少越好，当期总触发数每次扣15分，封底0分（说明未遵守报价话术边界）。
 */
function computeBehaviorScore(dailyRows = []) {
  if (!dailyRows.length) return 0;
  const avgResponseMinutes = (() => {
    const withResp = dailyRows.filter((r) => r.avg_response_minutes != null);
    if (!withResp.length) return null;
    const sum = withResp.reduce((acc, r) => acc + Number(r.avg_response_minutes), 0);
    return sum / withResp.length;
  })();
  const responseScore = avgResponseMinutes == null
    ? 60 // 无数据时给中性分，不惩罚也不奖励
    : Math.max(0, Math.min(100, 100 - ((avgResponseMinutes - 30) / (180 - 30)) * 100));

  const latestOverdue = dailyRows[dailyRows.length - 1]?.overdue_tasks || 0;
  const overdueScore = Math.max(0, 100 - latestOverdue * 10);

  const totalPriceGuardTriggers = dailyRows.reduce((acc, r) => acc + (r.price_guard_triggers || 0), 0);
  const priceGuardScore = Math.max(0, 100 - totalPriceGuardTriggers * 15);

  return Number((responseScore * 0.4 + overdueScore * 0.35 + priceGuardScore * 0.25).toFixed(2));
}

export async function computeAndSaveKpiScore(pool, { repId, periodType, periodKey, managerScore, managerComment }) {
  try {
    const { start, end } = periodRange(periodType, periodKey);

    const [targetRes, actualRes, dailyRes] = await Promise.all([
      pool.query(
        `SELECT * FROM sales_kpi_targets WHERE rep_id=$1 AND period_type=$2 AND period_key=$3 LIMIT 1`,
        [repId, periodType, periodKey]
      ),
      pool.query(
        `SELECT rep_key FROM sales_reps WHERE id=$1 LIMIT 1`,
        [repId]
      ),
      pool.query(
        `SELECT * FROM sales_daily_activity WHERE rep_id=$1 AND activity_date BETWEEN $2 AND $3 ORDER BY activity_date ASC`,
        [repId, start, end]
      ),
    ]);

    const target = targetRes.rows?.[0] || null;
    const repKey = actualRes.rows?.[0]?.rep_key || null;

    let newLeads = 0;
    let demos = 0;
    let deals = 0;
    if (repKey) {
      const [newLeadsRes, demosRes, dealsRes] = await Promise.all([
        pool.query(
          `SELECT COUNT(*) AS cnt FROM sales_leads WHERE owner_username=$1 AND created_at::date BETWEEN $2 AND $3`,
          [repKey, start, end]
        ),
        pool.query(
          `SELECT COUNT(*) AS cnt FROM sales_leads WHERE owner_username=$1 AND demo_count > 0 AND updated_at::date BETWEEN $2 AND $3`,
          [repKey, start, end]
        ),
        pool.query(
          `SELECT COUNT(*) AS cnt FROM sales_leads WHERE owner_username=$1 AND stage='won' AND updated_at::date BETWEEN $2 AND $3`,
          [repKey, start, end]
        ),
      ]);
      newLeads = Number(newLeadsRes.rows?.[0]?.cnt || 0);
      demos = Number(demosRes.rows?.[0]?.cnt || 0);
      deals = Number(dealsRes.rows?.[0]?.cnt || 0);
    }

    // 结果分：三个子指标完成率的简单平均，各封顶100
    const outcomeParts = [
      pctOfTarget(newLeads, target?.target_new_leads),
      pctOfTarget(demos, target?.target_demos),
      pctOfTarget(deals, target?.target_deals),
    ];
    const outcomeScore = Number((outcomeParts.reduce((a, b) => a + b, 0) / outcomeParts.length).toFixed(2));

    const behaviorScore = computeBehaviorScore(dailyRes.rows || []);

    const finalScore = Number(
      (outcomeScore * SCORE_WEIGHTS.outcome + behaviorScore * SCORE_WEIGHTS.behavior + (managerScore || 0) * SCORE_WEIGHTS.manager).toFixed(2)
    );

    const r = await pool.query(
      `INSERT INTO sales_kpi_scores (rep_id, period_type, period_key, behavior_score, outcome_score, manager_score, final_score, manager_comment, computed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
       ON CONFLICT (rep_id, period_type, period_key) DO UPDATE SET
         behavior_score = EXCLUDED.behavior_score,
         outcome_score = EXCLUDED.outcome_score,
         manager_score = EXCLUDED.manager_score,
         final_score = EXCLUDED.final_score,
         manager_comment = EXCLUDED.manager_comment,
         computed_at = NOW(),
         updated_at = NOW()
       RETURNING *`,
      [repId, periodType, periodKey, behaviorScore, outcomeScore, managerScore ?? null, finalScore, managerComment || null]
    );
    return r.rows?.[0] || null;
  } catch (e) {
    console.error('[sales-rep] computeAndSaveKpiScore failed:', e?.message || e);
    throw e;
  }
}

export async function getRepScorecard(pool, repId, periodType, periodKey) {
  try {
    const { start, end } = periodRange(periodType, periodKey);
    const [repRes, targetRes, scoreRes, dailyRes] = await Promise.all([
      pool.query(`SELECT * FROM sales_reps WHERE id=$1 LIMIT 1`, [repId]),
      pool.query(`SELECT * FROM sales_kpi_targets WHERE rep_id=$1 AND period_type=$2 AND period_key=$3 LIMIT 1`, [repId, periodType, periodKey]),
      pool.query(`SELECT * FROM sales_kpi_scores WHERE rep_id=$1 AND period_type=$2 AND period_key=$3 LIMIT 1`, [repId, periodType, periodKey]),
      pool.query(`SELECT * FROM sales_daily_activity WHERE rep_id=$1 AND activity_date BETWEEN $2 AND $3 ORDER BY activity_date ASC`, [repId, start, end]),
    ]);
    return {
      ok: true,
      rep: repRes.rows?.[0] || null,
      target: targetRes.rows?.[0] || null,
      score: scoreRes.rows?.[0] || null,
      daily_activity: dailyRes.rows || [],
      period_range: { start, end },
    };
  } catch (e) {
    console.error('[sales-rep] getRepScorecard failed:', e?.message || e);
    throw e;
  }
}

export async function getTeamLeaderboard(pool, { periodType, periodKey } = {}) {
  try {
    const r = await pool.query(
      `SELECT r.id AS rep_id, r.rep_key, r.display_name, r.role,
              s.behavior_score, s.outcome_score, s.manager_score, s.final_score, s.manager_comment
         FROM sales_reps r
         JOIN sales_kpi_scores s ON s.rep_id = r.id
        WHERE s.period_type = $1 AND s.period_key = $2
        ORDER BY s.final_score DESC NULLS LAST`,
      [periodType, periodKey]
    );
    return r.rows || [];
  } catch (e) {
    console.error('[sales-rep] getTeamLeaderboard failed:', e?.message || e);
    throw e;
  }
}
