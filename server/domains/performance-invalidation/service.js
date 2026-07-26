/**
 * Performance invalidation — pure business logic (no req/res).
 * Returns { ok, status?, error?, message?, success?, data? }.
 */
import { isWithin3DaysAndSameMonth } from './helpers.js';
import { childLogger } from '../../utils/logger.js';
import { notifyFilingInvalidation, notifyWeeklyOrChangeInvalidation } from './invalidate-notify.js';

const log = childLogger({ domain: 'performance-invalidation', handler: 'service' });


function resolvePool(ctx) {
  return typeof ctx.pool === 'function' ? ctx.pool() : ctx.pool;
}

/**
 * GET /api/admin/performance-records
 */
export async function listPerformanceRecords(ctx, { username, period, tenantId }) {
  if (!period) return { ok: false, status: 400, error: 'period_required' };

  const p = resolvePool(ctx);
  const tenantIdQ = tenantId || 'default';

  try {
    const weeklyParams = [];
    let weeklyWhere = `WHERE period LIKE 'week_%'
        AND score_model = 'anomaly_rollups_v2'`;
    if (username) {
      weeklyWhere += ` AND LOWER(TRIM(username)) = LOWER(TRIM($${weeklyParams.length + 1}))`;
      weeklyParams.push(username);
    }
    weeklyWhere += ` AND tenant_id = $${weeklyParams.length + 1}`;
    weeklyParams.push(tenantIdQ);
    const weekEnd = period.includes('-') ? `${period}-${String(new Date(Number(period.split('-')[0]), Number(period.split('-')[1]), 0).getDate()).padStart(2, '0')}` : period;
    const monthKey = period.replace('-', '');
    if (period.match(/^\d{4}-\d{2}$/)) {
      weeklyWhere += ` AND (
          (POSITION('__' IN period) = 0
            AND substring(period from 6 for 10)::date >= $${weeklyParams.length + 1}::date
            AND substring(period from 6 for 10)::date <= $${weeklyParams.length + 2}::date)
          OR
          (POSITION('__' IN period) > 0 AND split_part(period, '__', 2) = $${weeklyParams.length + 3})
        )`;
      weeklyParams.push(`${period}-01`, weekEnd, monthKey);
    }

    const weekly = await p.query(
      `SELECT id, brand, store, username, name, role, period, total_score, deductions, breakdown, summary,
                COALESCE(is_invalidated, false) AS is_invalidated,
                invalidated_at, created_at
         FROM agent_scores ${weeklyWhere}
         ORDER BY created_at DESC`,
      weeklyParams
    );

    const mtSources = ['random_inspection', 'scheduled_inspection', 'bi_anomaly', 'auto_collab', 'data_auditor'];
    let mtWhere = `WHERE mt.source = ANY($1::text[])
        AND COALESCE(mt.hr_performance_recorded, false) = true
        AND (mt.dispatched_at AT TIME ZONE 'Asia/Shanghai')::date >= $2::date
        AND (mt.dispatched_at AT TIME ZONE 'Asia/Shanghai')::date <= $3::date`;
    const mtParams = [mtSources, `${period}-01`, weekEnd];
    if (username) {
      mtWhere += ` AND LOWER(TRIM(COALESCE(mt.assignee_username, ''))) = LOWER(TRIM($${mtParams.length + 1}))`;
      mtParams.push(username);
    }
    mtWhere += ` AND mt.tenant_id = $${mtParams.length + 1}`;
    mtParams.push(tenantIdQ);

    const filings = await p.query(
      `SELECT mt.task_id, mt.store, mt.assignee_username, mt.assignee_role, mt.source, mt.category, mt.title, mt.detail,
                mt.dispatched_at,
                COALESCE(NULLIF(TRIM(fu.name), ''), mt.assignee_username) AS assignee_name,
                EXISTS (
                  SELECT 1 FROM performance_invalidation_records pir
                  WHERE pir.source_type = 'master_tasks_filing' AND pir.source_id = mt.task_id
                ) AS is_invalidated
         FROM master_tasks mt
         LEFT JOIN feishu_users fu ON LOWER(TRIM(fu.username)) = LOWER(TRIM(mt.assignee_username))
         ${mtWhere}
         ORDER BY mt.dispatched_at DESC`,
      mtParams
    );

    const invalidations = await p.query(
      `SELECT * FROM performance_invalidation_records
         WHERE period = $1 ${username ? 'AND LOWER(TRIM(username)) = LOWER(TRIM($2))' : ''}
         ORDER BY invalidated_at DESC`,
      username ? [period, username] : [period]
    );

    let dailyBi = { rows: [] };
    if (/^\d{4}-\d{2}$/.test(String(period || '').trim())) {
      const monthStart = `${period}-01`;
      const monthEnd = weekEnd;
      const dailyParams = [monthStart, monthEnd];
      let dailyWhere = `WHERE at.trigger_date >= $1::date AND at.trigger_date <= $2::date`;
      if (username) {
        dailyWhere += ` AND at.store IN (
              SELECT DISTINCT TRIM(store)
              FROM feishu_users
              WHERE LOWER(TRIM(username)) = LOWER(TRIM($3))
                AND TRIM(COALESCE(store, '')) <> ''
            )`;
        dailyParams.push(username);
      }
      const dailyLimit = username ? 800 : 300;
      dailyBi = await p.query(
        `SELECT at.id, at.anomaly_key, at.store, at.severity, at.trigger_date, at.status, at.created_at
           FROM anomaly_triggers at
           ${dailyWhere}
           ORDER BY at.trigger_date DESC, at.created_at DESC
           LIMIT ${dailyLimit}`,
        dailyParams
      );
    }

    let employeeMonthlyScores = [];
    if (username && /^\d{4}-\d{2}$/.test(String(period || '').trim())) {
      const em = await p.query(
        `SELECT store, role, total_score, execution_rating, attitude_rating, ability_rating, updated_at
           FROM employee_scores
           WHERE LOWER(TRIM(username)) = LOWER(TRIM($1)) AND period = $2
           ORDER BY updated_at DESC NULLS LAST`,
        [username, period]
      );
      employeeMonthlyScores = em.rows;
    }

    return {
      ok: true,
      success: true,
      data: {
        weekly_scores: weekly.rows,
        filings: filings.rows,
        invalidations: invalidations.rows,
        daily_bi_triggers: dailyBi.rows,
        employee_monthly_scores: employeeMonthlyScores
      }
    };
  } catch (e) {
    log.error({ msg: 'performance_records_error', err: e?.message });
    return { ok: false, status: 500, error: String(e?.message || e) };
  }
}

/**
 * POST /api/admin/performance-invalidate
 */
export async function invalidatePerformanceRecord(ctx, {
  source_type,
  source_id,
  username,
  store,
  period,
  reason: _reason,
  actorUsername,
  tenantId,
}) {
  if (!source_type || !source_id || !username || !period) {
    return { ok: false, status: 400, error: 'missing_fields' };
  }

  if (!/^\d{4}-\d{2}$/.test(period)) {
    return { ok: false, status: 400, error: 'invalid_period_format' };
  }

  const adminUser = String(actorUsername || '').trim();
  const tenantIdQ = tenantId || 'default';
  const p = resolvePool(ctx);
  const {
    calculateEmployeeScore,
    getIncompleteTaskCount,
    sendLarkCard,
    sendLarkMessage,
  } = ctx;

  try {
    // ── Phase 1: Commit invalidation (own transaction) ──
    let beforeData = {};
    let empStore = store || '';
    let empRole = '';
    /** @type {Date|string|null} */
    let filingDispatchedAt = null;

    await p.query('BEGIN');

    // 3-day + same-month check
    let createdAt;
    if (source_type === 'agent_scores_weekly') {
      const chk = await p.query(
        `SELECT id, created_at FROM agent_scores WHERE id::text = $1 AND tenant_id = $2 LIMIT 1`,
        [String(source_id), tenantIdQ]
      );
      if (!chk.rows?.length) {
        await p.query('ROLLBACK');
        return { ok: false, status: 404, error: 'record_not_found' };
      }
      createdAt = chk.rows[0].created_at;
      if (!isWithin3DaysAndSameMonth(createdAt)) {
        await p.query('ROLLBACK');
        return { ok: false, status: 400, error: 'out_of_invalidation_window', message: '只能失效3天内且同月的记录' };
      }
    } else if (source_type === 'master_tasks_filing') {
      const chk = await p.query(
        `SELECT task_id, dispatched_at FROM master_tasks WHERE task_id = $1 AND tenant_id = $2 LIMIT 1`,
        [String(source_id), tenantIdQ]
      );
      if (!chk.rows?.length) {
        await p.query('ROLLBACK');
        return { ok: false, status: 404, error: 'record_not_found' };
      }
      filingDispatchedAt = chk.rows[0].dispatched_at;
      createdAt = chk.rows[0].dispatched_at;
      if (!isWithin3DaysAndSameMonth(createdAt)) {
        await p.query('ROLLBACK');
        return { ok: false, status: 400, error: 'out_of_invalidation_window', message: '只能失效3天内且同月的记录' };
      }
    } else {
      await p.query('ROLLBACK');
      return { ok: false, status: 400, error: 'unsupported_source_type' };
    }

    // Check already invalidated
    const dupChk = await p.query(
      `SELECT 1 FROM performance_invalidation_records
         WHERE source_type = $1 AND source_id = $2 LIMIT 1`,
      [source_type, String(source_id)]
    );
    if (dupChk.rows?.length) {
      await p.query('ROLLBACK');
      return { ok: false, status: 409, error: 'already_invalidated' };
    }

    /** 备案失效前当月态度备案次数（本条仍计入；COMMIT 后重算为 after） */
    let filingMonthlyCountBefore = null;
    if (source_type === 'master_tasks_filing') {
      try {
        filingMonthlyCountBefore = await getIncompleteTaskCount(username, period);
      } catch (e) {
        log.warn({ msg: 'performance_invalidate_filingmonthlycountbefore', err: e?.message });
      }
    }

    // Capture before state
    const empBefore = await p.query(
      `SELECT total_score, execution_rating, attitude_rating, ability_rating
         FROM employee_scores
         WHERE LOWER(TRIM(username)) = LOWER(TRIM($1)) AND period = $2
         LIMIT 1`,
      [username, period]
    );
    beforeData = empBefore.rows?.[0] || {};

    // Mark invalidation
    if (source_type === 'agent_scores_weekly') {
      await p.query(
        `UPDATE agent_scores SET is_invalidated = TRUE, invalidated_at = NOW() WHERE id::text = $1 AND tenant_id = $2`,
        [String(source_id), tenantIdQ]
      );
    }

    await p.query(
      `INSERT INTO performance_invalidation_records (source_type, source_id, username, store, period, invalidated_by, tenant_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (source_type, source_id, tenant_id) DO NOTHING`,
      [source_type, String(source_id), username, store || null, period, adminUser, tenantIdQ]
    );

    // Resolve employee store / role / 展示姓名
    const fuRow = await p.query(
      `SELECT store, role,
                COALESCE(NULLIF(TRIM(name), ''), username) AS display_name
         FROM feishu_users
         WHERE LOWER(TRIM(username)) = LOWER(TRIM($1)) AND registered = TRUE LIMIT 1`,
      [username]
    );
    if (!empStore) empStore = fuRow.rows?.[0]?.store || '';
    empRole = fuRow.rows?.[0]?.role || '';

    // COMMIT the invalidation so pool() queries can see it
    await p.query('COMMIT');

    // ── Phase 2: Recalculate (pool connections now see committed invalidation) ──
    let afterData = null;
    if (empStore && empRole) {
      try {
        afterData = await calculateEmployeeScore(empStore, username, empRole, period);
      } catch (calcErr) {
        log.error({ msg: 'performance_invalidate_recalc_error', err: calcErr?.message });
      }
    }

    // B2 fix: guard against null afterData
    const safeAfter = afterData || {};
    const calcSucceeded = afterData !== null && typeof afterData.total_score !== 'undefined';

    const hasChange = calcSucceeded && (
      beforeData.total_score !== safeAfter.total_score
      || beforeData.execution_rating !== safeAfter.execution_rating
      || beforeData.attitude_rating !== safeAfter.attitude_rating
      || beforeData.ability_rating !== safeAfter.ability_rating
    );


    await notifyFilingInvalidation(ctx, {
      pool: p, source_type, source_id, username, period, tenantIdQ, adminUser, empStore, empRole,
      filingDispatchedAt, filingMonthlyCountBefore, getIncompleteTaskCount, sendLarkCard, sendLarkMessage, fuRow,
    });
    await notifyWeeklyOrChangeInvalidation(ctx, {
      pool: p, source_type, source_id, username, period, tenantIdQ, adminUser, empStore, empRole,
      beforeData, safeAfter, hasChange, sendLarkCard, sendLarkMessage,
    });

    return {
      ok: true,
      success: true,
      data: {
        invalidated: { source_type, source_id, username, period },
        before: beforeData,
        after: safeAfter,
        changed: hasChange,
        recalc_failed: !calcSucceeded
      }
    };
  } catch (e) {
    log.error({ msg: 'performance_invalidate_error', err: e?.message });
    return { ok: false, status: 500, error: String(e?.message || e) };
  }
}
