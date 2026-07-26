/**
 * P4 peel: getAttendanceOverview helpers.
 */

export function parseDateOnly(s) {
  const v = String(s || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(v + 'T00:00:00');
  return Number.isFinite(d.getTime()) ? d : null;
}

export function toDateOnly(d) {
  if (!(d instanceof Date) || !Number.isFinite(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function shiftDate(s, delta) {
  const d = parseDateOnly(s);
  if (!d) return '';
  d.setDate(d.getDate() + delta);
  return toDateOnly(d);
}

export function splitNameTokens(raw) {
  return String(raw || '')
    .split(/[，,、;；\n\r\t\s\/|]+/)
    .map((x) => String(x || '').trim())
    .filter(Boolean);
}

export function normalizeStaffUser(item) {
  return String(item?.user || item?.username || '').trim().toLowerCase();
}

export function normalizeStaffName(item) {
  return String(item?.name || '').trim();
}

export function monthBounds(month) {
  const [yearNum, monthNum] = month.split('-').map(Number);
  const monthStart = `${month}-01`;
  const monthEnd = `${month}-${String(new Date(yearNum, monthNum, 0).getDate()).padStart(2, '0')}`;
  return { monthStart, monthEnd };
}

export function buildCheckinByDay(checkinRows, month, hrmsDateKeyInShanghai) {
  const checkinByDay = new Map();
  checkinRows.forEach((row) => {
    const t = new Date(row.check_time);
    if (!Number.isFinite(t.getTime())) return;
    const dayKey = hrmsDateKeyInShanghai(t);
    if (!dayKey || !dayKey.startsWith(month)) return;
    const list = checkinByDay.get(dayKey) || [];
    list.push({
      type: String(row?.type || '').trim(),
      date: t,
    });
    checkinByDay.set(dayKey, list);
  });
  return checkinByDay;
}

export function buildScheduleAndRestMaps({
  reportList,
  myStore,
  meLower,
  myName,
  monthStart,
  monthEnd,
  dailyReportRestDaysForEmployee,
}) {
  const scheduleByDay = new Map();
  const restByDay = new Map();

  reportList.forEach((rep) => {
    const repStore = String(rep?.store || '').trim();
    if (myStore && repStore && repStore !== myStore) return;

    const repDate = String(rep?.date || '').trim();
    if (!repDate) return;
    const data = rep?.data && typeof rep.data === 'object' ? rep.data : {};

    if (repDate >= monthStart && repDate <= monthEnd) {
      let restedDays = dailyReportRestDaysForEmployee(data?.staff, meLower, myName);

      if (!(restedDays > 0)) {
        const frontRest = String(data?.staff?.frontRest || '').trim();
        const kitchenRest = String(data?.staff?.kitchenRest || '').trim();
        const tokens = splitNameTokens(frontRest).concat(splitNameTokens(kitchenRest));
        const tokenSet = new Set(tokens.map((x) => x.toLowerCase()));
        const hitByToken = tokenSet.has(meLower) || (!!myName && tokenSet.has(myName.toLowerCase()));
        const hitByRaw = (!!myName && (frontRest.includes(myName) || kitchenRest.includes(myName)))
          || frontRest.toLowerCase().includes(meLower)
          || kitchenRest.toLowerCase().includes(meLower);
        if (hitByToken || hitByRaw) restedDays = 1;
      }

      if (restedDays > 0) {
        restByDay.set(repDate, Number(restedDays));
      }
    }

    const targetDate = shiftDate(repDate, 1);
    if (!targetDate || targetDate < monthStart || targetDate > monthEnd) return;
    const next = data?.scheduleNextDay && typeof data.scheduleNextDay === 'object' ? data.scheduleNextDay : {};
    const planAll = Array.isArray(next?.staff) ? next.staff : [];
    const planMorning = Array.isArray(next?.morningStaff) ? next.morningStaff : [];
    const planAfternoon = Array.isArray(next?.afternoonStaff) ? next.afternoonStaff : [];

    const hasMatch = (list) => list.some((it) => {
      const u = normalizeStaffUser(it);
      const n = normalizeStaffName(it);
      if (u && u === meLower) return true;
      if (n && myName && n === myName) return true;
      return false;
    });

    const dayPlan = scheduleByDay.get(targetDate) || { planned: false, morning: false, afternoon: false };
    dayPlan.planned = dayPlan.planned || hasMatch(planAll) || hasMatch(planMorning) || hasMatch(planAfternoon);
    dayPlan.morning = dayPlan.morning || hasMatch(planMorning) || hasMatch(planAll);
    dayPlan.afternoon = dayPlan.afternoon || hasMatch(planAfternoon) || hasMatch(planAll);
    scheduleByDay.set(targetDate, dayPlan);
  });

  return { scheduleByDay, restByDay };
}

export function computeAttendanceCounts({
  scheduleByDay,
  checkinByDay,
  attWin,
  hrmsClockMinutesInShanghai,
}) {
  let absentCount = 0;
  let lateCount = 0;
  let earlyLeaveCount = 0;

  scheduleByDay.forEach((plan, dayKey) => {
    if (!plan?.planned) return;
    const logs = checkinByDay.get(dayKey) || [];
    if (!logs.length) {
      absentCount += 1;
      return;
    }

    const clockInTimes = logs
      .filter((x) => x.type === 'clock_in')
      .map((x) => x.date)
      .filter((d) => d instanceof Date && Number.isFinite(d.getTime()));
    const clockOutTimes = logs
      .filter((x) => x.type === 'clock_out')
      .map((x) => x.date)
      .filter((d) => d instanceof Date && Number.isFinite(d.getTime()));

    if (plan.morning && clockInTimes.length) {
      const firstIn = clockInTimes.reduce((a, b) => (a.getTime() <= b.getTime() ? a : b));
      const lateMin = hrmsClockMinutesInShanghai(firstIn);
      if (Number.isFinite(lateMin) && lateMin > attWin.startMinutes) lateCount += 1;
    }

    if (plan.afternoon && clockOutTimes.length) {
      const lastOut = clockOutTimes.reduce((a, b) => (a.getTime() >= b.getTime() ? a : b));
      const outMin = hrmsClockMinutesInShanghai(lastOut);
      if (Number.isFinite(outMin) && outMin < attWin.endMinutes) earlyLeaveCount += 1;
    }
  });

  return { absentCount, lateCount, earlyLeaveCount };
}

export function sumRestDays(restByDay) {
  let restDays = 0;
  restByDay.forEach((v) => {
    const n = Number(v || 0);
    if (Number.isFinite(n) && n > 0) restDays += n;
  });
  return Number(restDays.toFixed(2));
}

export function buildAttendanceOverviewPayload({
  month,
  username,
  myName,
  leaveBalance,
  absentCount,
  lateCount,
  earlyLeaveCount,
  restDays,
}) {
  const monthRestRemaining = leaveBalance
    ? Number(leaveBalance.monthRemaining || 0)
    : Number((4 - restDays).toFixed(2));
  const cumulativeLeaveDays = leaveBalance ? Number(leaveBalance.cumulativeLeaveDays || 0) : 0;

  return {
    ok: true,
    month,
    username,
    name: myName || username,
    cumulativeLeaveDays: Number(cumulativeLeaveDays.toFixed(1)),
    cumulativeLeaveManualLock: !!leaveBalance?.cumulativeLeaveManualLock,
    absentCount,
    lateCount,
    earlyLeaveCount,
    restDays,
    monthRestRemaining,
    leave: leaveBalance ? {
      baseLeave: leaveBalance.baseLeave,
      annualLeave: leaveBalance.annualLeave,
      usedLeave: leaveBalance.usedLeave,
      totalLeave: leaveBalance.totalLeave,
      cumulativeLeaveDays: leaveBalance.cumulativeLeaveDays,
      monthRemaining: leaveBalance.monthRemaining,
      computedRemaining: leaveBalance.computedRemaining,
      remaining: leaveBalance.remaining,
      overridden: !!leaveBalance.overridden,
      cumulativeLeaveManualLock: !!leaveBalance.cumulativeLeaveManualLock,
      weeklyDetails: Array.isArray(leaveBalance.weeklyDetails) ? leaveBalance.weeklyDetails : [],
      lastAdjustment: leaveBalance.lastAdjustment || null,
    } : null,
  };
}
