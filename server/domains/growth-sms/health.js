/**
 * SMS silent-failure health monitor.
 * Signature preserved: checkSmsSilentFailure(pool) / registerSmsHealthMonitor(pool).
 */
import { inSmsQuietHours, getSendGrowthAlert } from '../../growth-api.js';
import { isAliyunSmsAutoSendEnabled } from '../../sms.js';
import { childLogger } from '../../utils/logger.js';
import {
  STALE_HOURS,
  STALE_JOB_MIN_AGE_MIN,
  buildSilentFailureMessage,
} from './helpers.js';
import { beatHeartbeatSimple } from '../health/monitor-beat.js';

const log = childLogger({ domain: 'growth-sms', handler: 'health' });

/**
 * @param {any} pool
 * @param {{ inSmsQuietHours?: Function, isAliyunSmsAutoSendEnabled?: Function, getSendGrowthAlert?: Function, now?: () => number }} [deps]
 */
export async function checkSmsSilentFailure(pool, deps = {}) {
  const quiet = deps.inSmsQuietHours || inSmsQuietHours;
  const smsEnabled = deps.isAliyunSmsAutoSendEnabled || isAliyunSmsAutoSendEnabled;
  const getAlert = deps.getSendGrowthAlert || getSendGrowthAlert;
  const nowMs = deps.now ? deps.now() : Date.now();

  if (quiet()) return { skipped: 'quiet_hours' };
  if (!smsEnabled()) return { skipped: 'sms_disabled' };

  const pendingRes = await pool.query(
    `SELECT count(*) AS n FROM growth_campaign_jobs
       WHERE kind <> 'stored_value_remind' AND status IN ('pending', 'running')
         AND created_at < now() - interval '${STALE_JOB_MIN_AGE_MIN} minutes'`
  );
  const pendingCount = Number(pendingRes.rows?.[0]?.n || 0);
  if (pendingCount === 0) return { ok: true, pending: 0 };

  const lastSentRes = await pool.query(
    `SELECT max(created_at) AS last_sent FROM growth_delivery_logs WHERE channel = 'sms' AND status = 'sent'`
  );
  const lastSent = lastSentRes.rows?.[0]?.last_sent
    ? new Date(lastSentRes.rows[0].last_sent)
    : null;
  const hoursSinceLastSent = lastSent ? (nowMs - lastSent.getTime()) / 3600000 : Infinity;

  if (hoursSinceLastSent > STALE_HOURS) {
    const msg = buildSilentFailureMessage(pendingCount, lastSent, hoursSinceLastSent);
    log.warn({ msg: 'sms_silent_failure', detail: msg, pending: pendingCount });
    const sendAlert = getAlert();
    if (sendAlert) await sendAlert(msg).catch(() => null);
    return { ok: false, pending: pendingCount, hours_since_last_sent: hoursSinceLastSent };
  }
  return { ok: true, pending: pendingCount, hours_since_last_sent: hoursSinceLastSent };
}

export function registerSmsHealthMonitor(pool) {
  if (globalThis.__smsHealthMonitorTimer) return;
  globalThis.__smsHealthMonitorTimer = setInterval(() => {
    checkSmsSilentFailure(pool)
      .then(() => beatHeartbeatSimple(pool, 'sms_health_monitor'))
      .catch((e) =>
        log.warn({ msg: 'sms_health_check_failed', err: e?.message || String(e) })
      );
  }, 30 * 60 * 1000);
  setTimeout(() => {
    checkSmsSilentFailure(pool).catch((e) =>
      log.warn({ msg: 'sms_health_initial_check_failed', err: e?.message || String(e) })
    );
  }, 5 * 60 * 1000);
}
