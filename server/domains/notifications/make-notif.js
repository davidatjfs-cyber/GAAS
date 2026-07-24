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

export function addStateNotification(state, notif) {
  const s = state && typeof state === 'object' ? state : {};
  const list = Array.isArray(s.notifications) ? s.notifications.slice() : [];
  list.push(notif);
  return { ...s, notifications: list };
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
