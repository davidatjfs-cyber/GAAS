/**
 * BI function-tool period helpers (P2 peel from agents.js).
 * Pure: no pool / bitable deps.
 */

export function clampInt(v, min, max, fallback) {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return fallback;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

/**
 * Resolve query/tool args into { days, start, end, label }.
 * @param {object} [args]
 * @param {number} [fallbackDays=30]
 * @param {string} [originalQuery='']
 * @param {Date} [now=new Date()] injectable for tests
 */
export function resolveToolPeriod(args = {}, fallbackDays = 30, originalQuery = '', now = new Date()) {
  const fmt = (d) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
  };
  const semanticPeriod = String(args.period || '').trim();
  const q = String(originalQuery || '').trim();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const ms = 86400000;

  // ── 具体日期范围：优先解析，如 "2月15日-22日"、"2月15号到22号" ──
  {
    const rangeM = q.match(/(\d{1,2})[月](\d{1,2})[日号][\s]*[-到至~～][\s]*(?:(\d{1,2})[月])?(\d{1,2})[日号]/);
    if (rangeM) {
      const mStart = parseInt(rangeM[1], 10);
      const dStart = parseInt(rangeM[2], 10);
      const mEnd = rangeM[3] ? parseInt(rangeM[3], 10) : mStart;
      const dEnd = parseInt(rangeM[4], 10);
      const y = now.getFullYear();
      const s = `${y}-${String(mStart).padStart(2, '0')}-${String(dStart).padStart(2, '0')}`;
      const e = `${y}-${String(mEnd).padStart(2, '0')}-${String(dEnd).padStart(2, '0')}`;
      return { days: Math.round((new Date(e) - new Date(s)) / ms) + 1, start: s, end: e, label: `${mStart}月${dStart}日-${mEnd}月${dEnd}日` };
    }
    // "15-22号" 同月范围（无月份，取查询中出现的月份或当月）
    const sameMonthRange = q.match(/(\d{1,2})[月]?[\s]*(\d{1,2})[-到至](\d{1,2})[日号]/);
    if (sameMonthRange && !rangeM) {
      const mNum = sameMonthRange[1] ? parseInt(sameMonthRange[1], 10) : now.getMonth() + 1;
      const dS = parseInt(sameMonthRange[2], 10);
      const dE = parseInt(sameMonthRange[3], 10);
      const y = now.getFullYear();
      const s = `${y}-${String(mNum).padStart(2, '0')}-${String(dS).padStart(2, '0')}`;
      const e = `${y}-${String(mNum).padStart(2, '0')}-${String(dE).padStart(2, '0')}`;
      return { days: dE - dS + 1, start: s, end: e, label: `${mNum}月${dS}日-${dE}日` };
    }
  }

  // ── 具体单日：如 "2月15日"、"15号" ──
  {
    const singleM = q.match(/(\d{1,2})[月](\d{1,2})[日号]/);
    if (singleM) {
      const mNum = parseInt(singleM[1], 10);
      const dNum = parseInt(singleM[2], 10);
      const y = now.getFullYear();
      const s = `${y}-${String(mNum).padStart(2, '0')}-${String(dNum).padStart(2, '0')}`;
      return { days: 1, start: s, end: s, label: `${mNum}月${dNum}日` };
    }
    // "15号" 无月份，取当月
    const dayOnly = q.match(/(?<![0-9])(\d{1,2})[号日](?![-到至])/);
    if (dayOnly) {
      const dNum = parseInt(dayOnly[1], 10);
      if (dNum >= 1 && dNum <= 31) {
        const y = now.getFullYear();
        const mNum = now.getMonth() + 1;
        const s = `${y}-${String(mNum).padStart(2, '0')}-${String(dNum).padStart(2, '0')}`;
        return { days: 1, start: s, end: s, label: `${mNum}月${dNum}日` };
      }
    }
  }

  // ── 月份范围/单月：如 "1月"、"2026年2月"、"1月到2月"、"1月2月" ──
  {
    const makeMonthRange = (year, month) => {
      if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) return null;
      const first = new Date(year, month - 1, 1);
      const last = new Date(year, month, 0);
      return {
        start: fmt(first),
        end: fmt(last),
        days: Math.round((last - first) / ms) + 1,
      };
    };

    const monthRange = q.match(/(?:(\d{4})\s*年\s*)?(\d{1,2})\s*月\s*(?:到|至|~|～|-|—)\s*(?:(\d{4})\s*年\s*)?(\d{1,2})\s*月/);
    if (monthRange) {
      let startYear = parseInt(monthRange[1] || String(now.getFullYear()), 10);
      const startMonth = parseInt(monthRange[2], 10);
      let endYear = parseInt(monthRange[3] || String(startYear), 10);
      const endMonth = parseInt(monthRange[4], 10);
      if (!monthRange[3] && endMonth < startMonth) endYear += 1;
      const startR = makeMonthRange(startYear, startMonth);
      const endR = makeMonthRange(endYear, endMonth);
      if (startR && endR) {
        return {
          days: Math.round((new Date(endR.end) - new Date(startR.start)) / ms) + 1,
          start: startR.start,
          end: endR.end,
          label: `${startYear}年${startMonth}月-${endYear}年${endMonth}月`,
        };
      }
    }

    const dualMonth = q.match(/(?:(\d{4})\s*年\s*)?(\d{1,2})\s*月[^0-9]{0,8}(?:(\d{4})\s*年\s*)?(\d{1,2})\s*月/);
    if (dualMonth) {
      let startYear = parseInt(dualMonth[1] || String(now.getFullYear()), 10);
      const startMonth = parseInt(dualMonth[2], 10);
      let endYear = parseInt(dualMonth[3] || String(startYear), 10);
      const endMonth = parseInt(dualMonth[4], 10);
      if (startMonth !== endMonth) {
        if (!dualMonth[3] && endMonth < startMonth) endYear += 1;
        const startR = makeMonthRange(startYear, startMonth);
        const endR = makeMonthRange(endYear, endMonth);
        if (startR && endR) {
          return {
            days: Math.round((new Date(endR.end) - new Date(startR.start)) / ms) + 1,
            start: startR.start,
            end: endR.end,
            label: `${startYear}年${startMonth}月-${endYear}年${endMonth}月`,
          };
        }
      }
    }

    const singleMonth = q.match(/(?:(\d{4})\s*年\s*)?(\d{1,2})\s*月/);
    if (singleMonth && !/上[个]?月|本月/.test(q)) {
      const year = parseInt(singleMonth[1] || String(now.getFullYear()), 10);
      const month = parseInt(singleMonth[2], 10);
      const mr = makeMonthRange(year, month);
      if (mr) {
        return {
          days: mr.days,
          start: mr.start,
          end: mr.end,
          label: `${year}年${month}月`,
        };
      }
    }
  }

  if (semanticPeriod === 'today' || /今[天日]/.test(q)) {
    return { days: 1, start: fmt(today), end: fmt(today), label: '今日' };
  }
  if (semanticPeriod === 'yesterday' || /昨[天日]/.test(q)) {
    const y = new Date(today - ms);
    return { days: 1, start: fmt(y), end: fmt(y), label: '昨日' };
  }
  if (semanticPeriod === 'last_week' || /上周/.test(q)) {
    const dow = today.getDay() || 7;
    const mon = new Date(today - (dow + 6) * ms);
    return { days: 7, start: fmt(mon), end: fmt(new Date(+mon + 6 * ms)), label: '上周' };
  }
  if (semanticPeriod === 'this_week' || /本周/.test(q)) {
    const dow = today.getDay() || 7;
    const mon = new Date(today - (dow - 1) * ms);
    return { days: dow, start: fmt(mon), end: fmt(today), label: '本周' };
  }
  if (semanticPeriod === 'last_month' || /上[个]?月/.test(q)) {
    const firstThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastOfPrev = new Date(firstThisMonth - ms);
    const firstOfPrev = new Date(lastOfPrev.getFullYear(), lastOfPrev.getMonth(), 1);
    return { days: Math.round((lastOfPrev - firstOfPrev) / ms) + 1, start: fmt(firstOfPrev), end: fmt(lastOfPrev), label: '上月' };
  }
  if (semanticPeriod === 'this_month' || /本月/.test(q)) {
    const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const d = Math.round((today - firstOfMonth) / ms) + 1;
    return { days: d, start: fmt(firstOfMonth), end: fmt(today), label: '本月' };
  }
  const nm = q.match(/近\s*(\d+)\s*天/);
  if (nm) {
    const n = parseInt(nm[1], 10) || fallbackDays;
    return { days: n, start: fmt(new Date(today - (n - 1) * ms)), end: fmt(today), label: `近${n}天` };
  }
  const days = clampInt(args.period_days, 1, 90, fallbackDays);
  const end = new Date(now);
  const start = new Date(end);
  start.setDate(start.getDate() - (days - 1));
  return { days, start: fmt(start), end: fmt(end), label: `近${days}天` };
}
