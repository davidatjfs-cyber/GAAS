/**
 * notifyAdminsDualWriteFailure
 * (behavior-preserving extract from index.js)
 *
 * 双写失败告警（系统底线）：任何 hrms_state ↔ PostgreSQL 不同步风险必须调用本函数。
 * - 先入运维结构化日志（pino），再尽最大努力发飞书。
 * - 飞书接收人：feishu_users 中 admin / hq_manager（及常见中文管理员别名），避免仅有英文 admin 导致漏告。
 *
 * 已接入范围见仓库内对此函数的引用（遗漏新增双写时请同步调用）。
 */
import { childLogger } from '../../utils/logger.js';

const log = childLogger({ domain: 'notifications', handler: 'dual-write-alert' });

export function createNotifyAdminsDualWriteFailure({ pool, sendLarkMessage }) {
  return async function notifyAdminsDualWriteFailure(scopeLabel, err) {
    const reason = String(err?.message || err || 'unknown').slice(0, 500);
    const timeStr = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }).replace('T', ' ');
    log.error({
      msg: 'dual_write_critical',
      scope: scopeLabel,
      err: reason,
      time: timeStr,
    });

    try {
      const r = await pool.query(
        `SELECT DISTINCT open_id
         FROM feishu_users
         WHERE registered = true
           AND open_id IS NOT NULL
           AND open_id NOT LIKE '%probe%'
           AND (
             TRIM(LOWER(role)) IN ('admin', 'hq_manager')
             OR TRIM(role) IN ('管理员', '系统管理员', '总部经理', '总部营运')
           )
         LIMIT 35`
      );
      const rows = r.rows || [];
      if (!rows.length) {
        log.error({
          msg: 'dual_write_no_feishu_recipients',
          scope: scopeLabel,
        });
        return;
      }
      const msg =
        `【HRMS 双写失败告警】\n范围：${scopeLabel}\n原因：${reason}\n时间：${timeStr}（上海）\n` +
        `说明：营业日报若 PG 失败，接口会返回 **502（pg_sync_failed）** 且 **不会** 写入 hrms_state，避免「前端已提交、库表无行」。\n` +
        `请检查 DATABASE_URL、表约束、字段类型；可用 POST /api/admin/sync-submitted-daily-reports-pg 从 state 补写 daily_reports。\n` +
        `请核对 hrms_state 与独立表一致性。`;
      const sends = (rows || []).map((row) =>
        sendLarkMessage(row.open_id, msg, { skipDedup: true }).catch((e) => ({ err: e?.message || e }))
      );
      const settled = await Promise.all(sends);
      const failed = settled.filter((x) => x && x.err);
      if (failed.length) {
        log.error({
          msg: 'dual_write_feishu_partial_fail',
          failed: failed.length,
          err: failed[0]?.err || null,
        });
      }
    } catch (e) {
      log.error({
        msg: 'dual_write_notify_failed',
        scope: scopeLabel,
        err: e?.message,
      });
    }
  };
}
