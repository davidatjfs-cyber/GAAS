/**
 * Notify helpers for performance invalidation (extracted — keep invalidatePerformanceRecord thin).
 */
import {
  formatShanghaiYmdChinese,
  buildFilingInvalidationAssigneeCard,
  buildFilingInvalidationAdminCard,
  buildWeeklyScoreInvalidationCard,
  buildChangeCard,
} from './helpers.js';
import { childLogger } from '../../utils/logger.js';

const log = childLogger({ domain: 'performance-invalidation', handler: 'invalidate-notify' });

export async function notifyFilingInvalidation(ctx, {
  pool: p,
  source_type,
  source_id,
  username,
  period,
  tenantIdQ,
  adminUser,
  empStore,
  empRole,
  filingDispatchedAt,
  filingMonthlyCountBefore,
  getIncompleteTaskCount,
  sendLarkCard,
  sendLarkMessage,
  fuRow,
}) {
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

}

export async function notifyWeeklyOrChangeInvalidation(ctx, {
  pool: p,
  source_type,
  source_id,
  username,
  period,
  tenantIdQ,
  adminUser,
  empStore,
  empRole,
  beforeData,
  safeAfter,
  hasChange,
  sendLarkCard,
  sendLarkMessage,
}) {
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

}
