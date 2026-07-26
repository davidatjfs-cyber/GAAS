import { getPreviousWeekRange, shanghaiYesterdayYmd, toDateOnly } from './run-data-auditor.js';

export function resolveAuditorPeriod(checkMode, now = new Date()) {
  const isWeekly = checkMode === 'weekly';
  const isDaily = checkMode === 'daily';
  let nowDate;
  let weekAgoDate;
  let periodLabel;
  if (isWeekly) {
    const wr = getPreviousWeekRange(now);
    weekAgoDate = wr.weekStart;
    nowDate = wr.weekEnd;
    periodLabel = wr.weekLabel;
  } else if (isDaily) {
    const y = shanghaiYesterdayYmd(now);
    nowDate = y;
    weekAgoDate = y;
    periodLabel = y;
  } else {
    nowDate = toDateOnly(now.toISOString());
    weekAgoDate = toDateOnly(new Date(now.getTime() - 7 * 86400000).toISOString());
    periodLabel = nowDate;
  }
  return { nowDate, weekAgoDate, periodLabel, isWeekly, isDaily };
}
