/**
 * Training reminder + certification expiry schedulers.
 */
import { runForActiveTenants } from '../../utils/database.js';
import { childLogger } from '../../utils/logger.js';
import { beatHeartbeatSimple } from '../health/monitor-beat.js';
import {
  pool,
  getShanghaiDateKey,
  getShanghaiDateTimeText,
  parseReminderMeta,
  createTrainingUserNotification,
  sendTrainingFeishuMessage,
} from './shared.js';
import { createTrainingAssignment } from './service.js';

const log = childLogger({ domain: 'training', handler: 'scheduler' });
const TRAINING_REMINDER_INTERVAL_MS = Math.max(30 * 60 * 1000, Number(process.env.TRAINING_REMINDER_INTERVAL_MS || 60 * 60 * 1000));
let _trainingReminderSchedulerStarted = false;

export async function runTrainingReminderSweep() {
  const todayKey = getShanghaiDateKey();
  let preDueSent = 0;
  let overdueEscalated = 0;

  try {
    const result = await pool().query(`
      SELECT
        a.id,
        a.employee_username,
        a.assigned_by,
        a.topic_id,
        a.due_date,
        a.reminder_meta,
        t.title,
        COALESCE(e.name, a.employee_username) AS employee_name,
        COALESCE(assigner_emp.name, a.assigned_by, '管理员') AS assigner_name,
        COALESCE(s.status, 'not_started') AS session_status
      FROM training_assignments a
      JOIN training_topics t ON t.id = a.topic_id
      LEFT JOIN training_sessions s ON s.topic_id = a.topic_id AND s.employee_username = a.employee_username
      LEFT JOIN employees e ON e.username = a.employee_username
      LEFT JOIN employees assigner_emp ON assigner_emp.username = a.assigned_by
      WHERE a.due_date IS NOT NULL
        AND t.is_active = true
        AND COALESCE(s.status, 'not_started') != 'certified'
      ORDER BY a.due_date ASC, a.created_at ASC
    `);

    for (const row of result.rows || []) {
      const dueDate = String(row.due_date || '').slice(0, 10);
      if (!dueDate) continue;
      const reminderMeta = parseReminderMeta(row.reminder_meta);
      const topicTitle = String(row.title || '培训任务').trim();
      const assigneeName = String(row.employee_name || row.employee_username || '').trim() || '员工';
      const isOverdue = todayKey > dueDate;

      if (!isOverdue) {
        if (reminderMeta.last_pre_due_reminder_on === todayKey) continue;
        const message = `请在 ${dueDate} 前完成培训任务「${topicTitle}」。系统将每天提醒一次，当前仍未完成，请尽快登录 HRMS 完成学习。`;
        await createTrainingUserNotification(
          row.employee_username,
          '培训任务完成提醒',
          message,
          {
            assignment_id: row.id,
            topic_id: row.topic_id,
            due_date: dueDate,
            reminder_phase: 'pre_due',
            reminded_on: todayKey
          }
        );
        await sendTrainingFeishuMessage(
          row.employee_username,
          `📚 培训任务提醒\n\n你被指派的培训任务【${topicTitle}】尚未完成。\n截止日期：${dueDate}\n系统会在截止前每天提醒 1 次，请尽快登录 HRMS 完成学习。`
        );
        await pool().query(
          `UPDATE training_assignments
           SET reminder_meta = COALESCE(reminder_meta, '{}'::jsonb) || $1::jsonb
           WHERE id = $2`,
          [
            JSON.stringify({
              last_pre_due_reminder_on: todayKey,
              pre_due_reminder_count: Number(reminderMeta.pre_due_reminder_count || 0) + 1,
              last_pre_due_reminder_at: getShanghaiDateTimeText()
            }),
            row.id
          ]
        );
        preDueSent++;
        continue;
      }

      if (reminderMeta.last_overdue_reminder_on === todayKey) continue;
      const daysOverdue = Math.max(1, Math.floor((Date.parse(`${todayKey}T00:00:00+08:00`) - Date.parse(`${dueDate}T00:00:00+08:00`)) / 86400000));
      await sendTrainingFeishuMessage(
        row.employee_username,
        `⚠️ 培训任务已逾期\n\n培训任务【${topicTitle}】已超过截止日期 ${daysOverdue} 天（截止：${dueDate}）。请立即登录 HRMS 补完成，进度看板已标记为逾期。`
      );
      if (row.assigned_by) {
        await sendTrainingFeishuMessage(
          row.assigned_by,
          `🚨 培训任务逾期提醒\n\n${assigneeName} 的培训任务【${topicTitle}】已逾期 ${daysOverdue} 天（截止：${dueDate}），当前仍未完成。请在培训进度看板中查看并跟进。`
        );
        await createTrainingUserNotification(
          row.assigned_by,
          '培训任务逾期提醒',
          `${assigneeName} 的培训任务「${topicTitle}」已逾期 ${daysOverdue} 天，请及时跟进。`,
          {
            assignment_id: row.id,
            topic_id: row.topic_id,
            due_date: dueDate,
            assignee_username: row.employee_username,
            reminder_phase: 'overdue_escalation',
            reminded_on: todayKey
          }
        );
      }
      await pool().query(
        `UPDATE training_assignments
         SET reminder_meta = COALESCE(reminder_meta, '{}'::jsonb) || $1::jsonb
         WHERE id = $2`,
        [
          JSON.stringify({
            last_overdue_reminder_on: todayKey,
            overdue_reminder_count: Number(reminderMeta.overdue_reminder_count || 0) + 1,
            last_overdue_reminder_at: getShanghaiDateTimeText()
          }),
          row.id
        ]
      );
      overdueEscalated++;
    }
  } catch (e) {
    log.error({ msg: 'training_reminder_sweep_failed', err: e?.message || String(e) });
    return { ok: false, error: e?.message || String(e), preDueSent, overdueEscalated };
  }

  if (preDueSent || overdueEscalated) {
    log.info({
      msg: 'training_reminder_sweep_complete',
      pre_due_sent: preDueSent,
      overdue_escalated: overdueEscalated,
    });
  }
  return { ok: true, preDueSent, overdueEscalated };
}

// 认证到期前提前天数，触发复训指派
const RECERT_LEAD_DAYS = 14;

// 认证到期复训：每条知识点认证有效期到期（或即将到期）时，
// 自动将认证标记为过期，并指派一条复训任务（source='recert'）
export async function runCertificationExpirySweep() {
  let expired = 0;
  let recertAssigned = 0;

  try {
    const result = await pool().query(`
      SELECT c.id, c.employee_username, c.topic_id, c.valid_until, c.certified_at, c.status, c.tenant_id, t.title
      FROM training_certifications c
      JOIN training_topics t ON t.id = c.topic_id
      WHERE c.manager_verdict = 'passed'
        AND c.status IN ('valid', 'expired')
        AND c.valid_until IS NOT NULL
        AND c.valid_until <= CURRENT_DATE + INTERVAL '${RECERT_LEAD_DAYS} days'
        AND c.id = (
          SELECT c2.id FROM training_certifications c2
          WHERE c2.employee_username = c.employee_username AND c2.topic_id = c.topic_id
          ORDER BY c2.created_at DESC LIMIT 1
        )
      AND t.is_active = true
    `);

    for (const row of result.rows || []) {
      if (row.status === 'valid' && row.valid_until && getShanghaiDateKey() > String(row.valid_until).slice(0, 10)) {
        await pool().query(`UPDATE training_certifications SET status = 'expired' WHERE id = $1`, [row.id]);
        expired++;
      }

      const existing = await pool().query(
        `SELECT 1 FROM training_assignments
         WHERE employee_username = $1 AND topic_id = $2 AND source = 'recert' AND created_at > $3
         LIMIT 1`,
        [row.employee_username, row.topic_id, row.certified_at]
      );
      if (existing.rows.length) continue;

      // assigned_by 不能留空：审核队列按「谁派发谁审核」过滤，assigned_by=NULL 时
      // 非admin/hq_manager角色永远查不到这条待审——复训通知发了但没人能审核确认。
      // 这里回填为该员工所在门店的出品经理/店长（跟晋升派发同一套解法）。
      let recertAssignedBy = null;
      try {
        const empRow = await pool().query(
          `SELECT store FROM employees WHERE username = $1 AND tenant_id = $2 LIMIT 1`,
          [row.employee_username, row.tenant_id]
        );
        const store = String(empRow.rows[0]?.store || '').trim();
        if (store) {
          const mgrRow = await pool().query(
            `SELECT username, position FROM employees
             WHERE store = $1 AND tenant_id = $2 AND role IN ('store_production_manager','store_manager')
               AND COALESCE(status, '') NOT IN ('离职', 'inactive')
             ORDER BY CASE WHEN position ~ '出品经理|厨师长' THEN 0 ELSE 1 END
             LIMIT 1`,
            [store, row.tenant_id]
          );
          recertAssignedBy = mgrRow.rows[0]?.username || null;
        }
      } catch (e) {
        log.warn({ msg: 'training_recert_assigned_by_lookup_failed', err: e?.message });
      }

      await createTrainingAssignment({
        employeeUsername: row.employee_username,
        topicId: row.topic_id,
        assignedBy: recertAssignedBy,
        dueDate: row.valid_until,
        note: `认证「${row.title}」即将于 ${String(row.valid_until).slice(0, 10)} 到期，请完成复训重新认证。`,
        requirePractice: true,
        source: 'recert',
        tenantId: row.tenant_id
      });
      recertAssigned++;
    }
  } catch (e) {
    log.error({ msg: 'training_cert_expiry_sweep_failed', err: e?.message || String(e) });
    return { ok: false, error: e?.message || String(e), expired, recertAssigned };
  }

  if (expired || recertAssigned) {
    log.info({
      msg: 'training_cert_expiry_sweep_complete',
      expired,
      recert_assigned: recertAssigned,
    });
  }
  return { ok: true, expired, recertAssigned };
}

export function startTrainingReminderScheduler() {
  if (_trainingReminderSchedulerStarted) return;
  _trainingReminderSchedulerStarted = true;

  const tick = () => {
    runForActiveTenants(
      (tenantId) => runTrainingReminderSweep().then((value) => ({ tenantId, ...value })),
      {
        continueOnError: true,
        onError: ({ tenantId, error }) => {
          log.error({
            msg: 'training_reminder_scheduler_tick_failed',
            tenant_id: tenantId,
            err: error?.message || String(error),
          });
        }
      }
    ).catch((e) => {
      log.error({ msg: 'training_reminder_scheduler_bootstrap_failed', err: e?.message || String(e) });
    });
    runForActiveTenants(
      (tenantId) => runCertificationExpirySweep().then((value) => ({ tenantId, ...value })),
      {
        continueOnError: true,
        onError: ({ tenantId, error }) => {
          log.error({
            msg: 'training_cert_expiry_scheduler_tick_failed',
            tenant_id: tenantId,
            err: error?.message || String(error),
          });
        }
      }
    ).catch((e) => {
      log.error({ msg: 'training_cert_expiry_scheduler_bootstrap_failed', err: e?.message || String(e) });
    });
    beatHeartbeatSimple(pool(), 'training_reminder_scheduler_tick').catch(() => {});
  };

  setTimeout(tick, 90 * 1000);
  setInterval(tick, TRAINING_REMINDER_INTERVAL_MS);
  log.info({ msg: 'training_reminder_scheduler_started' });
}
