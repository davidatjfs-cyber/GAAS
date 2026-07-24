/**
 * Pure date / number helpers shared by DI sites in index.js
 * (points routes, notifications, inventory forecast, leave/attendance, etc.).
 * Named exports — no factory.
 */

export function safeNumber(input) {
  const n = Number(input);
  return Number.isFinite(n) ? n : null;
}

export function toNullableUuid(input) {
  const value = String(input || '').trim();
  return value ? value : null;
}

export function hrmsNowISO() {
  // Force Asia/Shanghai wall-clock time regardless of server timezone.
  const fmt = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  const parts = fmt.formatToParts(new Date());
  const pick = (t) => parts.find(p => p.type === t)?.value || '';
  const y = pick('year');
  const m = pick('month');
  const d = pick('day');
  const h = pick('hour');
  const mi = pick('minute');
  const s = pick('second');
  return `${y}-${m}-${d}T${h}:${mi}:${s}+08:00`;
}

export function inDateRange(date, start, end) {
  const d = String(date || '').trim();
  if (!d) return false;
  const s = start ? String(start).trim() : '';
  const e = end ? String(end).trim() : '';
  if (s && d < s) return false;
  if (e && d > e) return false;
  return true;
}

export function parseMonth(input) {
  const v = String(input || '').trim();
  if (!/^\d{4}-\d{2}$/.test(v)) return null;
  return v;
}

export function clampNum(n, d = 0) {
  const v = Number(n);
  return Number.isFinite(v) ? v : d;
}

export function normalizeStoreKey(v) {
  return String(v || '').trim().toLowerCase().replace(/\s+/g, '');
}

export function safeDateOnly(input) {
  const v = String(input || '').trim();
  if (!v) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  return v;
}

export function safeMonthOnly(input) {
  const v = String(input || '').trim();
  if (!v) return null;
  if (!/^\d{4}-\d{2}$/.test(v)) return null;
  return v;
}
