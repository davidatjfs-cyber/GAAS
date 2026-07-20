/**
 * 短信"引擎在跑但零产出"沉默故障监控。
 *
 * 解决的问题：2026-07-16~20 那次事故里，pm2 显示 online、runWinbackJobs 每2分钟正常触发、
 * 规则引擎日志没有 ERROR——所有"看起来健康"的指标全是绿的，但实际5天一条短信没发出去，
 * 只有去翻 growth_delivery_logs 的实际发送记录才发现。这里把"有待发任务却完全没有发送
 * 产出"这个信号自动化，不用再靠人去翻表。
 *
 * registerSmsHealthMonitor(pool) — 每30分钟检查一次，禁发时段(21:30-9:00)内跳过。
 */
import { inSmsQuietHours, getSendGrowthAlert } from './growth-api.js';
import { isAliyunSmsAutoSendEnabled } from './sms.js';

const STALE_HOURS = 2; // 有积压任务时，超过这个时长零发送就报警
const STALE_JOB_MIN_AGE_MIN = 30; // 任务冻结未处理超过这个时长才算"积压"(给正常处理留缓冲)

export async function checkSmsSilentFailure(pool) {
  if (inSmsQuietHours()) return { skipped: 'quiet_hours' };
  if (!isAliyunSmsAutoSendEnabled()) return { skipped: 'sms_disabled' };

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
  const lastSent = lastSentRes.rows?.[0]?.last_sent ? new Date(lastSentRes.rows[0].last_sent) : null;
  const hoursSinceLastSent = lastSent ? (Date.now() - lastSent.getTime()) / 3600000 : Infinity;

  if (hoursSinceLastSent > STALE_HOURS) {
    const msg =
      `🚨 短信自动发送疑似停摆：有 ${pendingCount} 条待发任务积压超过${STALE_JOB_MIN_AGE_MIN}分钟，` +
      `但最近一条成功发送记录是 ${lastSent ? lastSent.toISOString() : '(从未有过)'}，` +
      `已 ${Number.isFinite(hoursSinceLastSent) ? hoursSinceLastSent.toFixed(1) : '∞'} 小时零发送。` +
      `请检查 hrmsClient/runWinbackJobs 云函数、签名密钥、阿里云账户余额。`;
    console.warn('[sms-health]', msg);
    const sendAlert = getSendGrowthAlert();
    if (sendAlert) await sendAlert(msg).catch(() => null);
    return { ok: false, pending: pendingCount, hours_since_last_sent: hoursSinceLastSent };
  }
  return { ok: true, pending: pendingCount, hours_since_last_sent: hoursSinceLastSent };
}

export function registerSmsHealthMonitor(pool) {
  if (globalThis.__smsHealthMonitorTimer) return;
  globalThis.__smsHealthMonitorTimer = setInterval(() => {
    checkSmsSilentFailure(pool).catch((e) => console.warn('[sms-health] check failed:', e?.message));
  }, 30 * 60 * 1000);
  setTimeout(() => {
    checkSmsSilentFailure(pool).catch((e) => console.warn('[sms-health] initial check failed:', e?.message));
  }, 5 * 60 * 1000);
}
