/**
 * Performance invalidation — pure business logic (no req/res).
 * Returns { ok, status?, error?, message?, success?, data? }.
 */
import {
  formatShanghaiYmdChinese,
  isWithin3DaysAndSameMonth,
  buildFilingInvalidationAssigneeCard,
  buildFilingInvalidationAdminCard,
  buildWeeklyScoreInvalidationCard,
  buildChangeCard,
} from './helpers.js';
import { childLogger } from '../../utils/logger.js';

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

    // 备案任务失效：专业飞书卡片 + 档案通知（不写「绩效数据变更」）
    if (source_type === 'master_tasks_filing' && filingDispatchedAt) {
      const ymdZh = formatShanghaiYmdChinese(filingDispatchedAt);
      let countAfter = 0;
      try {
        countAfter = await getIncompleteTaskCount(username, period);
      } catch (e) {
        log.warn({ msg: 'performance_invalidate_getincompletetaskcount_after', err: e?.message });
      }
      const countBefore =
        typeof filingMonthlyCountBefore === 'number' && !Number.isNaN(filingMonthlyCountBefore)
          ? filingMonthlyCountBefore
          : countAfter;
      const taskIdStr = String(source_id);
      const empName = String(fuRow.rows?.[0]?.display_name || username).trim() || username;

      const cardAssignee = buildFilingInvalidationAssigneeCard({
        empName,
        username,
        empStore,
        empRole,
        period,
        ymdZh,
        taskIdStr,
        countBefore,
        countAfter
      });
      const cardAdmin = buildFilingInvalidationAdminCard({
        adminUser,
        empName,
        username,
        empStore,
        empRole,
        period,
        ymdZh,
        taskIdStr,
        countBefore,
        countAfter
      });

      const inAppMsgAssignee =
        `【工作态度备案已撤销】${empName}（${username}）· ${empStore || '—'} · 任务 ${taskIdStr} · ${ymdZh}。` +
        `本月工作态度备案次数：${countBefore}次 → ${countAfter}次。疑问请咨询总部营运。`;
      const inAppMsgAdmin =
        `【抄送·备案撤销】操作人 ${adminUser} · 责任人 ${empName}（${username}）· ${empStore || '—'} · ${taskIdStr}。` +
        `备案次数：${countBefore}次 → ${countAfter}次。`;

      try {
        await p.query(
          `INSERT INTO hrms_user_notifications (target_username, title, message, type, meta, tenant_id)
             VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
          [
            username,
            `工作态度备案已取消｜${taskIdStr}`,
            inAppMsgAssignee,
            'master_tasks_filing_invalidation',
            JSON.stringify({
              period,
              source_id: taskIdStr,
              attitude_filing_count_before: countBefore,
              attitude_filing_count_after: countAfter,
              dispatched_date_zh: ymdZh,
              display_name: empName,
              store: empStore
            }),
            tenantIdQ
          ]
        );
      } catch (e) {
        log.warn({ msg: 'performance_invalidate_filing_notification_insert_failed', err: e?.message });
      }

      const openFiling = await p.query(
        `SELECT open_id FROM feishu_users
           WHERE LOWER(TRIM(username)) = LOWER(TRIM($1)) AND registered = TRUE AND open_id IS NOT NULL AND open_id <> ''
           LIMIT 1`,
        [username]
      );
      if (openFiling.rows?.[0]?.open_id) {
        const oid = openFiling.rows[0].open_id;
        sendLarkCard(oid, cardAssignee)
          .then((r) => {
            if (!r?.ok) {
              return sendLarkMessage(oid, inAppMsgAssignee, { skipDedup: true });
            }
            return r;
          })
          .catch(() => sendLarkMessage(oid, inAppMsgAssignee, { skipDedup: true }))
          .catch((e) => log.warn({ msg: 'performance_invalidate_filing_assignee_lark_failed', err: e?.message }));
      }

      try {
        await p.query(
          `INSERT INTO hrms_user_notifications (target_username, title, message, type, meta, tenant_id)
             VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
          [
            adminUser,
            `抄送｜工作态度备案已取消｜${taskIdStr}→${username}`,
            inAppMsgAdmin,
            'master_tasks_filing_invalidation_admin_cc',
            JSON.stringify({
              period,
              source_id: taskIdStr,
              assignee_username: username,
              operator: adminUser,
              attitude_filing_count_before: countBefore,
              attitude_filing_count_after: countAfter,
              display_name: empName,
              store: empStore
            }),
            tenantIdQ
          ]
        );
      } catch (e) {
        log.warn({ msg: 'performance_invalidate_admin_in_app_copy_failed', err: e?.message });
      }
      const admOpen = await p.query(
        `SELECT open_id FROM feishu_users
           WHERE LOWER(TRIM(username)) = LOWER(TRIM($1)) AND registered = TRUE AND open_id IS NOT NULL AND open_id <> ''
             AND open_id NOT LIKE '%probe%'
           ORDER BY updated_at DESC LIMIT 1`,
        [adminUser]
      );
      if (admOpen.rows?.[0]?.open_id) {
        const oidA = admOpen.rows[0].open_id;
        sendLarkCard(oidA, cardAdmin)
          .then((r) => {
            if (!r?.ok) {
              return sendLarkMessage(oidA, inAppMsgAdmin, { skipDedup: true });
            }
            return r;
          })
          .catch(() => sendLarkMessage(oidA, inAppMsgAdmin, { skipDedup: true }))
          .catch((e) => log.warn({ msg: 'performance_invalidate_admin_lark_failed', err: e?.message }));
      }
    }

    // ── Phase 3: 周度 agent_scores 失效 — 专业卡片（替代橙色「绩效数据变更」主展示）
    if (source_type === 'agent_scores_weekly') {
      const nameRow = await p.query(
        `SELECT COALESCE(NULLIF(TRIM(name), ''), username) AS name FROM feishu_users
           WHERE LOWER(TRIM(username)) = LOWER(TRIM($1)) AND registered = TRUE LIMIT 1`,
        [username]
      );
      const empNameW = nameRow.rows?.[0]?.name || username;
      let recordSummary = '';
      try {
        const wk = await p.query(
          `SELECT summary, deductions FROM agent_scores WHERE id::text = $1 AND tenant_id = $2 LIMIT 1`,
          [String(source_id), tenantIdQ]
        );
        const wr = wk.rows?.[0];
        if (wr) {
          const s = String(wr.summary || '').trim();
          let d = '';
          try {
            d = wr.deductions != null ? JSON.stringify(wr.deductions) : '';
          } catch {
            d = String(wr.deductions || '');
          }
          recordSummary = (s || d).replace(/\s+/g, ' ').slice(0, 280);
        }
      } catch (e) {
        log.warn({ msg: 'performance_invalidate_weekly_record_summary', err: e?.message });
      }

      const weeklyPayload = {
        empName: empNameW,
        username,
        empStore,
        empRole,
        period,
        sourceId: String(source_id),
        recordSummary,
        before: beforeData,
        after: safeAfter,
        adminUser
      };
      const wCardA = buildWeeklyScoreInvalidationCard(weeklyPayload, 'assignee');
      const wCardAd = buildWeeklyScoreInvalidationCard(weeklyPayload, 'admin');
      const wPlainA = `【周度扣分已失效】${empNameW}（${username}）· ${empStore || '—'} · 记录 ${source_id}。` +
        `月度演算参考：得分 ${beforeData.total_score ?? '—'} → ${safeAfter.total_score ?? '—'}。`;
      const wPlainAd = `【抄送·周度扣分已失效】${adminUser} · 责任人 ${empNameW}（${username}）· ${empStore || '—'} · 记录 ${source_id}。`;

      if (hasChange) {
        try {
          await p.query(
            `INSERT INTO hrms_user_notifications (target_username, title, message, type, meta, tenant_id)
               VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
            [
              username,
              `周度扣分记录已失效｜${period}`,
              wPlainA,
              'performance_invalidation_change',
              JSON.stringify({ period, source_type, source_id: String(source_id), before: beforeData, after: safeAfter }),
              tenantIdQ
            ]
          );
        } catch (e) {
          log.warn({ msg: 'performance_invalidate_weekly_assignee_notification', err: e?.message });
        }
      }

      const openIdRowW = await p.query(
        `SELECT open_id FROM feishu_users
           WHERE LOWER(TRIM(username)) = LOWER(TRIM($1)) AND registered = TRUE AND open_id IS NOT NULL AND open_id <> ''
           LIMIT 1`,
        [username]
      );
      if (openIdRowW.rows?.[0]?.open_id) {
        const oidW = openIdRowW.rows[0].open_id;
        sendLarkCard(oidW, wCardA)
          .then((r) => {
            if (!r?.ok) {
              return sendLarkMessage(oidW, hasChange ? wPlainA : `【周度扣分已失效】${empNameW} · 记录 ${source_id} 已由管理员标记失效。`, { skipDedup: true });
            }
            return r;
          })
          .catch(() =>
            sendLarkMessage(
              oidW,
              hasChange ? wPlainA : `【周度扣分已失效】${empNameW} · 记录 ${source_id} 已由管理员标记失效。`,
              { skipDedup: true }
            )
          )
          .catch((e) => log.warn({ msg: 'performance_invalidate_weekly_card_assignee_failed', err: e?.message }));
      }

      try {
        await p.query(
          `INSERT INTO hrms_user_notifications (target_username, title, message, type, meta, tenant_id)
             VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
          [
            adminUser,
            `抄送｜周度扣分已失效｜${source_id}→${username}`,
            wPlainAd,
            'agent_scores_weekly_invalidation_admin_cc',
            JSON.stringify({ period, source_id: String(source_id), assignee_username: username, operator: adminUser }),
            tenantIdQ
          ]
        );
      } catch (e) {
        log.warn({ msg: 'performance_invalidate_weekly_admin_in_app', err: e?.message });
      }

      const adminOpenIdW = await p.query(
        `SELECT open_id FROM feishu_users
           WHERE LOWER(TRIM(username)) = LOWER(TRIM($1)) AND registered = TRUE AND open_id IS NOT NULL AND open_id <> ''
             AND open_id NOT LIKE '%probe%'
           ORDER BY updated_at DESC LIMIT 1`,
        [adminUser]
      );
      if (adminOpenIdW.rows?.[0]?.open_id) {
        const oidAd = adminOpenIdW.rows[0].open_id;
        sendLarkCard(oidAd, wCardAd)
          .then((r) => {
            if (!r?.ok) {
              return sendLarkMessage(oidAd, wPlainAd, { skipDedup: true });
            }
            return r;
          })
          .catch(() => sendLarkMessage(oidAd, wPlainAd, { skipDedup: true }))
          .catch((e) => log.warn({ msg: 'performance_invalidate_weekly_card_admin_failed', err: e?.message }));
      }
    } else if (hasChange && source_type !== 'master_tasks_filing') {
      const nameRow = await p.query(
        `SELECT COALESCE(NULLIF(TRIM(name), ''), username) AS name FROM feishu_users
           WHERE LOWER(TRIM(username)) = LOWER(TRIM($1)) AND registered = TRUE LIMIT 1`,
        [username]
      );
      const empName = nameRow.rows?.[0]?.name || username;

      await p.query(
        `INSERT INTO hrms_user_notifications (target_username, title, message, type, meta, tenant_id)
           VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
        [
          username,
          `绩效数据变更通知｜${period}`,
          `您的${period}月绩效数据已变更。绩效得分：${beforeData.total_score ?? '—'} → ${safeAfter.total_score ?? '—'}；执行力：${beforeData.execution_rating ?? '—'} → ${safeAfter.execution_rating ?? '—'}；态度：${beforeData.attitude_rating ?? '—'} → ${safeAfter.attitude_rating ?? '—'}；能力：${beforeData.ability_rating ?? '—'} → ${safeAfter.ability_rating ?? '—'}`,
          'performance_invalidation_change',
          JSON.stringify({ period, source_type, source_id: String(source_id), before: beforeData, after: safeAfter }),
          tenantIdQ
        ]
      );

      const card = buildChangeCard(beforeData, safeAfter, username, empName, empStore, empRole, period);
      if (card) {
        const openIdRow = await p.query(
          `SELECT open_id FROM feishu_users
             WHERE LOWER(TRIM(username)) = LOWER(TRIM($1)) AND registered = TRUE AND open_id IS NOT NULL AND open_id <> ''
             LIMIT 1`,
          [username]
        );
        if (openIdRow.rows?.[0]?.open_id) {
          sendLarkCard(openIdRow.rows[0].open_id, card).catch((e) =>
            log.warn({ msg: 'performance_invalidate_feishu_card_to_user_failed', err: e?.message })
          );
        }

        const adminOpenId = await p.query(
          `SELECT open_id FROM feishu_users
             WHERE LOWER(TRIM(username)) = LOWER(TRIM($1)) AND registered = TRUE AND open_id IS NOT NULL AND open_id <> ''
               AND open_id NOT LIKE '%probe%'
             ORDER BY updated_at DESC LIMIT 1`,
          [adminUser]
        );
        if (adminOpenId.rows?.[0]?.open_id) {
          sendLarkCard(adminOpenId.rows[0].open_id, card).catch((e) =>
            log.warn({ msg: 'performance_invalidate_feishu_card_to_admin_failed', err: e?.message })
          );
        }
      }
    }

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
