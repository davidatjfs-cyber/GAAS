/**
 * Bitable pipeline failure Feishu alerts (P2 peel from agents.js).
 */

/**
 * @param {object} deps
 * @param {() => { query: Function }} deps.pool
 * @param {Function} deps.sendLarkMessage
 * @param {{ warn: Function, error: Function }} deps.log
 * @returns {(scopeLabel: string, err: unknown, opts?: object) => Promise<void>}
 */
export function createNotifyBitablePipelineFailure(deps) {
  const { pool, sendLarkMessage, log } = deps;
  const alertLast = new Map();

  return async function notifyBitablePipelineFailure(scopeLabel, err, opts = {}) {
    try {
      const reason = String(err?.message || err || 'unknown').slice(0, 900);
      const stack = err?.stack ? String(err.stack).split('\n').slice(0, 8).join('\n').slice(0, 1500) : '';
      const dedupeKey = String(opts?.dedupeKey || scopeLabel || 'default');
      const minI = Number(opts?.minIntervalMs);
      if (Number.isFinite(minI) && minI > 0) {
        const k = `${scopeLabel}|${dedupeKey}`;
        const now = Date.now();
        const last = alertLast.get(k) || 0;
        if (now - last < minI) return;
        alertLast.set(k, now);
      }
      const r = await pool().query(
        `SELECT open_id FROM feishu_users
       WHERE registered = true AND open_id IS NOT NULL
         AND role IN ('admin', 'hq_manager')
         AND open_id NOT LIKE '%probe%'
       LIMIT 20`
      );
      const rows = r.rows || [];
      if (!rows.length) {
        log.warn('[bitable-alert] no admin/hq_manager open_id for Feishu alert:', scopeLabel, reason);
        return;
      }
      const timeStr = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }).replace('T', ' ');
      const extra = Array.isArray(opts?.extraLines) ? opts.extraLines.filter(Boolean).join('\n') : '';
      const msg =
        `【HRMS Bitable 实时链故障】\n范围：${scopeLabel}\n原因：${reason}\n时间：${timeStr}（上海）\n` +
        (extra ? `补充：\n${extra}\n` : '') +
        (stack ? `堆栈摘要：\n${stack}\n` : '') +
        `影响：多维表同步后的知识图谱 / 照片验证 / 巡店处理可能延迟；系统会 catchup、LISTEN 重连或回退飞书轮询。\n` +
        `请查 hrms-service 日志 [bitable]、[bitable-alert] 与 DATABASE_URL / PG 权限。`;
      await Promise.all(
        (rows || []).map((row) =>
          sendLarkMessage(row.open_id, msg, { skipDedup: true }).catch((e) =>
            log.error('[bitable-alert] sendLarkMessage failed:', e?.message)
          )
        )
      );
    } catch (e) {
      log.error('[bitable-alert] notifyBitablePipelineFailure failed:', e?.message);
    }
  };
}
