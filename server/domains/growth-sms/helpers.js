export function cleanText(value, max = 255) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

/** Normalize SMS template body for Aliyun vs DB compare. */
export function normalizeSmsContent(s) {
  return String(s || '').replace(/\s+/g, '').trim();
}

export const STALE_HOURS = 2;
export const STALE_JOB_MIN_AGE_MIN = 30;

export function buildSilentFailureMessage(pendingCount, lastSent, hoursSinceLastSent) {
  return (
    `🚨 短信自动发送疑似停摆：有 ${pendingCount} 条待发任务积压超过${STALE_JOB_MIN_AGE_MIN}分钟，` +
    `但最近一条成功发送记录是 ${lastSent ? lastSent.toISOString() : '(从未有过)'}，` +
    `已 ${Number.isFinite(hoursSinceLastSent) ? hoursSinceLastSent.toFixed(1) : '∞'} 小时零发送。` +
    `请检查 hrmsClient/runWinbackJobs 云函数、签名密钥、阿里云账户余额。`
  );
}
