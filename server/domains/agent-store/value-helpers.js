/**
 * Agent 门店/指标数值 helpers（P2 peel from agents.js）。
 */

export function toNum(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function toDateOnly(v) {
  const s = String(v || '').trim();
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  try {
    const d = new Date(s);
    if (!Number.isFinite(d.getTime())) return '';
    return d.toISOString().slice(0, 10);
  } catch {
    return '';
  }
}

export function inDateRangeInclusive(v, start, end) {
  const d = toDateOnly(v);
  if (!d) return false;
  const s = toDateOnly(start);
  const e = toDateOnly(end);
  if (s && d < s) return false;
  if (e && d > e) return false;
  return true;
}

export function normProductKey(v) {
  return String(v || '').trim().toLowerCase().replace(/\s+/g, '');
}
