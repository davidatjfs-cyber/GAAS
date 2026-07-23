/**
 * 增长 Phase 日期工具（A/B 域；cron 从 service 再导出）。
 */
import { cleanText } from '../growth-phase-auth.js';

export function safeDateOnly(value) {
  const s = cleanText(value, 32);
  if (!s) return '';
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return s;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

export function ymdAddDays(ymd, delta) {
  const d = new Date(`${ymd}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return '';
  d.setUTCDate(d.getUTCDate() + Number(delta || 0));
  return d.toISOString().slice(0, 10);
}

export function todayShanghaiYmd() {
  return new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
}

export function diffDaysInclusive(startYmd, endYmd) {
  const s = new Date(`${startYmd}T00:00:00Z`);
  const e = new Date(`${endYmd}T00:00:00Z`);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime()) || e < s) return 0;
  return Math.floor((e.getTime() - s.getTime()) / 86400000) + 1;
}
