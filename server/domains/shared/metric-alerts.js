/**
 * Metric → Feishu admin alerts (slow approval / LLM failure).
 * Dual-write failures already alert via dual-write-alert.js.
 */
import { childLogger } from '../../utils/logger.js';

const log = childLogger({ domain: 'shared', handler: 'metric-alerts' });

const DEFAULT_SLOW_APPROVE_MS = Number(process.env.APPROVAL_SLOW_ALERT_MS) || 5000;

/**
 * @param {{ sendAdminSystemAlert?: (msg: string, opts?: object) => Promise<unknown> }} deps
 */
export function createMetricAlerts(deps = {}) {
  const send = typeof deps.sendAdminSystemAlert === 'function' ? deps.sendAdminSystemAlert : null;
  const slowMs = Number(deps.slowApproveMs) > 0 ? Number(deps.slowApproveMs) : DEFAULT_SLOW_APPROVE_MS;

  async function fire(msg, meta = {}) {
    if (!send) return;
    try {
      await send(msg, {
        persistToHrms: false,
        notificationType: 'metric_alert',
        meta,
      });
    } catch (e) {
      log.error({ msg: 'metric_alert_feishu_failed', err: e?.message || String(e) });
    }
  }

  return {
    /**
     * @param {number} durationMs
     * @param {{ status?: string, type?: string, id?: string|number }} [tags]
     */
    onApprovalDecide(durationMs, tags = {}) {
      const ms = Number(durationMs);
      if (!Number.isFinite(ms) || ms < slowMs) return;
      const timeStr = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }).replace('T', ' ');
      void fire(
        `【HRMS 审批耗时告警】\n审批 ID：${tags.id ?? '-'}\n类型：${tags.type || '-'}\n结果：${tags.status || '-'}\n耗时：${Math.round(ms)}ms（阈值 ${slowMs}ms）\n时间：${timeStr}（上海）`,
        { kind: 'approval_slow', ...tags, durationMs: Math.round(ms), thresholdMs: slowMs }
      );
    },

    /**
     * @param {{ provider?: string, reason?: string, durationMs?: number }} [tags]
     */
    onLlmFailure(tags = {}) {
      const timeStr = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }).replace('T', ' ');
      void fire(
        `【HRMS LLM 调用失败】\n提供商：${tags.provider || '-'}\n原因：${tags.reason || '-'}\n耗时：${tags.durationMs != null ? `${Math.round(Number(tags.durationMs))}ms` : '-'}\n时间：${timeStr}（上海）`,
        { kind: 'llm_failure', ...tags }
      );
    },
  };
}

/** Process-wide default; wired from index.js once sendAdminSystemAlert exists. */
let _defaultAlerts = createMetricAlerts({});

export function getMetricAlerts() {
  return _defaultAlerts;
}

export function setMetricAlerts(alerts) {
  if (alerts && typeof alerts === 'object') _defaultAlerts = alerts;
}
