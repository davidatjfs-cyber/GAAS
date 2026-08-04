/**
 * makeNotif / addStateNotification / uniqUsernames
 * (behavior-preserving extract from index.js)
 */

export function uniqUsernames(list) {
  const seen = new Set();
  const out = [];
  (list || []).forEach((u) => {
    const v = String(u || '').trim();
    if (!v) return;
    const k = v.toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    out.push(v);
  });
  return out;
}

/**
 * blob 里 notifications 的保留上限。权威数据在 hrms_user_notifications 表，
 * blob 这份只是历史遗留镜像，读路径由 hydrateNotificationsFromTable 用表数据覆盖。
 *
 * 2026-08-04：这个数组曾涨到 16,888 条 / 4.6MB，把 state blob 撑到 9.5MB，导致
 * getSharedState 每次都要解析这个巨型对象，2 核机器 GC 追不上 → 堆到 2GB → pm2 反复重启
 * （详见 startup-tenant-reconcile-steps.js#reconcileNotificationsOnStartup 的根因说明）。
 * 这里是所有 blob 追加的唯一入口，在这封顶就能治住全部调用方（排班/生日/审批/信箱等）。
 */
const STATE_NOTIF_MAX = 500;

export function addStateNotification(state, notif) {
  const s = state && typeof state === 'object' ? state : {};
  const list = Array.isArray(s.notifications) ? s.notifications.slice() : [];
  list.push(notif);
  // 只保留最近 STATE_NOTIF_MAX 条（数组尾部为最新）
  return { ...s, notifications: list.length > STATE_NOTIF_MAX ? list.slice(-STATE_NOTIF_MAX) : list };
}

export function createMakeNotif({ hrmsNowISO }) {
  return function makeNotif(targetUser, title, message, extra) {
    return {
      id: 'NOTIF-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
      type: String(extra?.type || 'notice'),
      targetUser: String(targetUser || '').trim(),
      title: String(title || '').trim() || '通知',
      message: String(message || '').trim(),
      createdAt: hrmsNowISO(),
      ...(extra && typeof extra === 'object' ? extra : {}),
    };
  };
}
