export function parseTimeRange(timeRange) {
  if (!timeRange) {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const today = `${y}-${m}-${d}`;
    return { start: today, end: today, label: '今天' };
  }
  if (/^\d{4}-\d{2}$/.test(timeRange)) {
    const [y, m] = timeRange.split('-');
    const start = `${y}-${m}-01`;
    const lastDay = new Date(Number(y), Number(m), 0).getDate();
    const end = `${y}-${m}-${String(lastDay).padStart(2, '0')}`;
    return { start, end, label: `${y}年${m}月` };
  }
  if (/^\d{4}-\d{2}-\d{2}~\d{4}-\d{2}-\d{2}$/.test(timeRange)) {
    const [start, end] = timeRange.split('~');
    return { start, end, label: `${start} 至 ${end}` };
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(timeRange)) {
    return { start: timeRange, end: timeRange, label: timeRange };
  }
  return { start: timeRange, end: timeRange, label: timeRange };
}

export function extractTimeRangeFromText(text) {
  const q = String(text || '').trim();
  const now = new Date();
  const ms = 86400000;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  function fmt(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  const rangePatterns = [
    /(\d{1,2})[月](\d{1,2})(?:[日号])?[-~至到](\d{1,2})[日号]/,
    /(\d{1,2})(?:[日号])?[-~至到](\d{1,2})[日号]/,
    /(\d{1,2})[月](\d{1,2})[日号][-~至到](\d{1,2})[月](\d{1,2})[日号]/,
  ];

  for (const pattern of rangePatterns) {
    const match = q.match(pattern);
    if (match) {
      let startMonth, startDay, endMonth, endDay;

      if (match.length === 4 && pattern.source.includes('月')) {
        startMonth = parseInt(match[1], 10);
        startDay = parseInt(match[2], 10);
        endMonth = startMonth;
        endDay = parseInt(match[3], 10);
      } else if (match.length === 5) {
        startMonth = parseInt(match[1], 10);
        startDay = parseInt(match[2], 10);
        endMonth = parseInt(match[3], 10);
        endDay = parseInt(match[4], 10);
      } else {
        startMonth = now.getMonth() + 1;
        startDay = parseInt(match[1], 10);
        endMonth = startMonth;
        endDay = parseInt(match[2], 10);
      }

      const year = now.getFullYear();
      const start = new Date(year, startMonth - 1, startDay);
      const end = new Date(year, endMonth - 1, endDay);

      return {
        timeRange: `${fmt(start)}~${fmt(end)}`,
        label: `${startMonth}月${startDay}日-${endMonth === startMonth ? '' : endMonth + '月'}${endDay}日`,
      };
    }
  }

  if (/今[天日]/.test(q)) {
    const s = fmt(today);
    return { timeRange: `${s}~${s}`, label: '今日' };
  }
  if (/昨[天日]/.test(q)) {
    const y = new Date(today - ms);
    const s = fmt(y);
    return { timeRange: `${s}~${s}`, label: '昨日' };
  }
  if (/前[天日]/.test(q)) {
    const d = new Date(today - 2 * ms);
    const s = fmt(d);
    return { timeRange: `${s}~${s}`, label: '前天' };
  }
  if (/上周/.test(q)) {
    const dow = today.getDay() || 7;
    const mon = new Date(+today - (dow - 1 + 7) * ms);
    const sun = new Date(+mon + 6 * ms);
    return { timeRange: `${fmt(mon)}~${fmt(sun)}`, label: '上周' };
  }
  if (/本周/.test(q)) {
    const dow = today.getDay() || 7;
    const mon = new Date(today - (dow - 1) * ms);
    return { timeRange: `${fmt(mon)}~${fmt(today)}`, label: '本周' };
  }
  if (/上[个]?月/.test(q)) {
    const firstThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastLastMonth = new Date(firstThisMonth - ms);
    const firstLastMonth = new Date(lastLastMonth.getFullYear(), lastLastMonth.getMonth(), 1);
    return { timeRange: `${fmt(firstLastMonth)}~${fmt(lastLastMonth)}`, label: '上月' };
  }
  if (/本月/.test(q)) {
    const s = fmt(new Date(now.getFullYear(), now.getMonth(), 1));
    return { timeRange: `${s}~${fmt(today)}`, label: '本月' };
  }
  const nm = q.match(/近\s*(\d+)\s*天/);
  if (nm) {
    const n = parseInt(nm[1], 10) || 7;
    return { timeRange: `${fmt(new Date(today - (n - 1) * ms))}~${fmt(today)}`, label: `近${n}天` };
  }
  const chMonthMap = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10, '十一': 11, '十二': 12 };
  const chMonthMatch = q.match(/(十[一二]|[一二三四五六七八九十])[月]/);
  if (chMonthMatch) {
    const mNum = chMonthMap[chMonthMatch[1]];
    if (mNum) {
      const y = now.getFullYear();
      const s = `${y}-${String(mNum).padStart(2, '0')}-01`;
      const lastDay = new Date(y, mNum, 0).getDate();
      const e = `${y}-${String(mNum).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
      return { timeRange: `${s}~${e}`, label: `${mNum}月` };
    }
  }
  const singleDayMatch = q.match(/(\d{1,2})[月](\d{1,2})[日号]/);
  if (singleDayMatch) {
    const mNum = parseInt(singleDayMatch[1], 10);
    const dNum = parseInt(singleDayMatch[2], 10);
    if (mNum >= 1 && mNum <= 12 && dNum >= 1 && dNum <= 31) {
      const y = now.getFullYear();
      const s = `${y}-${String(mNum).padStart(2, '0')}-${String(dNum).padStart(2, '0')}`;
      return { timeRange: `${s}~${s}`, label: `${mNum}月${dNum}日` };
    }
  }
  const numMonthMatch = q.match(/(\d{1,2})[月]/);
  if (numMonthMatch) {
    const mNum = parseInt(numMonthMatch[1], 10);
    if (mNum >= 1 && mNum <= 12) {
      const y = now.getFullYear();
      const s = `${y}-${String(mNum).padStart(2, '0')}-01`;
      const lastDay = new Date(y, mNum, 0).getDate();
      const e = `${y}-${String(mNum).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
      return { timeRange: `${s}~${e}`, label: `${mNum}月` };
    }
  }
  const defaultStart = fmt(new Date(today - 6 * ms));
  return { timeRange: `${defaultStart}~${fmt(today)}`, label: '近7天' };
}
