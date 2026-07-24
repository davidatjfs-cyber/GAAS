import { resolveTenantIdDefault } from '../../utils/database.js';
import { getBrandForStoreSync } from '../../utils/brand-config-loader.js';

/** 打卡时刻在上海时区的「时×60+分」，用于迟到/早退判断 */
export function hrmsClockMinutesInShanghai(d) {
  if (!(d instanceof Date) || !Number.isFinite(d.getTime())) return NaN;
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d);
  const hh = Number(parts.find((x) => x.type === 'hour')?.value);
  const mm = Number(parts.find((x) => x.type === 'minute')?.value);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return NaN;
  return hh * 60 + mm;
}

/** 打卡记录归属的「上海日历日」YYYY-MM-DD */
export function hrmsDateKeyInShanghai(d) {
  if (!(d instanceof Date) || !Number.isFinite(d.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
  const gv = (t) => parts.find((x) => x.type === t)?.value || '';
  return `${gv('year')}-${gv('month')}-${gv('day')}`;
}

/**
 * 迟到/早退比对用的门店班次窗口（上海墙钟）。
 * 洪潮大宁久光店：9:15 上班 – 21:00 下班；时段外打卡计迟到/早退。马己仙等未单独配置：9:00–22:00。
 */
export function hrmsAttendanceWindowMinutesForStore(storeRaw) {
  const s = String(storeRaw || '').trim();
  const db = getBrandForStoreSync(s, resolveTenantIdDefault());
  if (db && Number.isFinite(db.punchStartMinutes) && Number.isFinite(db.punchEndMinutes)) {
    return { startMinutes: db.punchStartMinutes, endMinutes: db.punchEndMinutes };
  }
  const hongJiuguang = s.includes('洪潮大宁久光')
    || (s.includes('洪潮') && (s.includes('久光') || s.includes('大宁')));
  if (hongJiuguang) return { startMinutes: 9 * 60 + 15, endMinutes: 21 * 60 };
  return { startMinutes: 9 * 60, endMinutes: 22 * 60 };
}
