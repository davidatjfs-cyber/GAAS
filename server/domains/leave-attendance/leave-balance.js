/** 月度假期余额 / 批准休假天数 / 累计池滚动 */

export function createLeaveBalanceHelpers({
  safeMonthOnly,
  hrmsNowISO,
  shiftMonth,
  leaveBalanceOverrideKey,
  getLeaveBalanceOverride,
  calcOverlapDaysWithinMonth,
  dailyReportHasRestForEmployee,
  calcEmployeeMonthlyActualRestFromDailyReports,
  getLockedOpeningCarryForMonth,
}) {
  function resolveEmployeeLeaveCalcStartMonth(state, employee, fallbackMonth) {
    const emp = employee && typeof employee === 'object' ? employee : {};
    const uname = String(emp?.username || '').trim().toLowerCase();
    const name = String(emp?.name || '').trim();
    const months = [];

    const reportList = Array.isArray(state?.dailyReports) ? state.dailyReports : [];
    reportList.forEach((rep) => {
      const repDate = String(rep?.date || '').trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(repDate)) return;
      const store = String(rep?.store || '').trim();
      if (!store) return;
      const data = rep?.data && typeof rep.data === 'object' ? rep.data : {};
      const hit = dailyReportHasRestForEmployee(data?.staff, uname, name);
      if (hit) months.push(repDate.slice(0, 7));
    });

    const leaveRecords = Array.isArray(state?.leaveRecords) ? state.leaveRecords : [];
    leaveRecords.forEach((lr) => {
      if (String(lr?.applicant || '').trim().toLowerCase() !== uname) return;
      const sd = String(lr?.startDate || '').trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(sd)) months.push(sd.slice(0, 7));
    });

    const overrides = state?.leaveBalanceOverrides && typeof state.leaveBalanceOverrides === 'object'
      ? state.leaveBalanceOverrides
      : {};
    Object.keys(overrides).forEach((key) => {
      const m = String(key || '').match(/^(.+)_([0-9]{4}-[0-9]{2})$/);
      if (!m) return;
      if (String(m[1] || '').trim().toLowerCase() !== uname) return;
      months.push(String(m[2] || '').trim());
    });

    const clean = months.filter(Boolean).sort();
    return clean[0] || safeMonthOnly(fallbackMonth) || hrmsNowISO().slice(0, 7);
  }

  /** 当月已批准休假在月内的天数合计（与薪资/累计假展示口径一致） */
  function calcEmployeeMonthlyApprovedLeaveDays(state, employee, month) {
    const m = safeMonthOnly(month);
    const emp = employee && typeof employee === 'object' ? employee : null;
    const uname = String(emp?.username || '').trim().toLowerCase();
    if (!m || !uname) return 0;
    const leaveRecords = Array.isArray(state?.leaveRecords) ? state.leaveRecords : [];
    let usedLeave = 0;
    leaveRecords.forEach((lr) => {
      if (String(lr?.applicant || '').toLowerCase() !== uname) return;
      if (String(lr?.status || '') !== 'approved') return;
      const sd = String(lr?.startDate || '').trim();
      const ed = String(lr?.endDate || '').trim();
      const rawDays = lr?.days != null && lr?.days !== '' ? Number(lr.days) : null;
      const overlapDays = calcOverlapDaysWithinMonth(sd, ed, m);
      let days = 0;
      if (overlapDays > 0) {
        const sameMonthRange = sd.startsWith(m) && ed.startsWith(m);
        days = (sameMonthRange && rawDays != null && Number.isFinite(rawDays) && rawDays > 0)
          ? rawDays
          : overlapDays;
      } else if (rawDays != null && Number.isFinite(rawDays) && rawDays > 0 && sd.startsWith(m)) {
        days = rawDays;
      }
      if (Number.isFinite(days) && days > 0) usedLeave += days;
    });
    return Number(usedLeave.toFixed(2));
  }

  /**
   * 滚动计算「目标月」月初累计池（不含目标月当月额度与消耗）。
   * @param {{ ignoreEndCarryoverOverride?: boolean }} opts 为 true 时忽略目标月 carryover 人工覆盖（用于次月1日快照，避免把尚未审的覆盖写入上月闭合值）
   */
  function calcEmployeeMonthlyCarryover(state, employee, month, opts) {
    const m = safeMonthOnly(month);
    const emp = employee && typeof employee === 'object' ? employee : null;
    const uname = String(emp?.username || '').trim();
    if (!m || !uname) return 0;
    const ignoreEnd = !!(opts && opts.ignoreEndCarryoverOverride);

    const startMonth = resolveEmployeeLeaveCalcStartMonth(state, emp, m);
    let cur = startMonth;
    let carry = 0;
    while (cur && cur < m) {
      // 上月及以前：若该月存在「累计假期（carryover）」手动校准，则以手动值为月初起点，否则沿用滚动计算
      const ov = getLeaveBalanceOverride(state, uname, cur);
      const monthQuota = 4;
      const restInfo = calcEmployeeMonthlyActualRestFromDailyReports(state, emp, cur);
      const usedRest = Number(restInfo?.total || 0);
      const usedLike = Number(usedRest.toFixed(2));
      const startCarry = ov && ov.mode === 'carryover' ? ov.value : carry;
      carry = Number((startCarry + monthQuota - usedLike).toFixed(2));
      cur = shiftMonth(cur, 1);
    }
    // 当月月初累计池：若本月已手动设置「截止上月累计假期」(mode=carryover)，以手动值为准；否则以系统滚动计算为准
    if (!ignoreEnd) {
      const currentOv = getLeaveBalanceOverride(state, uname, m);
      if (currentOv && currentOv.mode === 'carryover') return Number(currentOv.value.toFixed(2));
    }
    return Number(carry.toFixed(2));
  }

  function calcEmployeeMonthlyLeaveBalance(state, employee, month, opts = {}) {
    const m = safeMonthOnly(month);
    const emp = employee && typeof employee === 'object' ? employee : null;
    const uname = String(emp?.username || '').trim();
    if (!m || !uname) return null;

    const [yr, mo] = m.split('-').map(Number);
    const daysInMonth = new Date(yr, mo, 0).getDate();

    // Fixed entitlement: 4 rest days per month (not Sunday-count based)
    const MONTHLY_REST_DAYS = 4;
    const weekDetails = [];
    for (let d = 1; d <= daysInMonth; d += 7) {
      const startDay = d;
      const endDay = Math.min(daysInMonth, d + 6);
      // Proportional share of 4 days based on days in this week-segment
      const weekDays = endDay - startDay + 1;
      const entitled = Number((MONTHLY_REST_DAYS * weekDays / daysInMonth).toFixed(2));
      weekDetails.push({
        weekIndex: weekDetails.length + 1,
        range: `${m}-${String(startDay).padStart(2, '0')}~${m}-${String(endDay).padStart(2, '0')}`,
        entitled,
        used: 0,
        remaining: entitled
      });
    }

    const baseLeave = MONTHLY_REST_DAYS;
    const annualLeave = 0;

    // 优先用权威日结果：有按日明细则逐日展示；仅有汇总时回退日报按日明细
    const usedLeaveDetails = [];
    let usedLeave = 0;
    const attDetails = Array.isArray(opts?.attendanceRestDetails) ? opts.attendanceRestDetails : null;
    const attRest = opts && typeof opts === 'object' ? opts.attendanceRestDays : null;

    const addDetailToWeeks = (day, val) => {
      const n = Number(val || 0);
      if (!(Number.isFinite(n) && n > 0)) return;
      weekDetails.forEach((wk) => {
        const [ws, we] = String(wk?.range || '').split('~');
        if (!ws || !we) return;
        if (day < ws || day > we) return;
        wk.used = Number((Number(wk.used || 0) + n).toFixed(2));
      });
    };

    if (attDetails && attDetails.length) {
      for (const d of attDetails) {
        const day = String(d?.date || '').trim().slice(0, 10);
        const n = Number(d?.days);
        if (!day || !(Number.isFinite(n) && n > 0)) continue;
        usedLeaveDetails.push({
          date: day,
          days: n,
          type: String(d?.type || '休息').trim() || '休息',
          source: String(d?.source || '日结果').trim() || '日结果'
        });
        addDetailToWeeks(day, n);
      }
      usedLeave = usedLeaveDetails.reduce((s, x) => s + Number(x.days || 0), 0);
    } else if (attRest != null && Number.isFinite(Number(attRest))) {
      usedLeave = Number(Number(attRest).toFixed(2));
      const restStats = calcEmployeeMonthlyActualRestFromDailyReports(state, emp, m);
      const byDay = restStats?.byDay && typeof restStats.byDay === 'object' ? restStats.byDay : {};
      const dayEntries = Object.entries(byDay);
      if (dayEntries.length) {
        dayEntries.forEach(([day, val]) => {
          const n = Number(val || 0);
          if (!(Number.isFinite(n) && n > 0)) return;
          usedLeaveDetails.push({ date: day, days: n, type: '休息', source: '日报休息' });
          addDetailToWeeks(day, n);
        });
      } else if (usedLeave > 0) {
        usedLeaveDetails.push({ date: m, days: usedLeave, type: '休息', source: '日结果汇总' });
      }
    } else {
      const restStats = calcEmployeeMonthlyActualRestFromDailyReports(state, emp, m);
      usedLeave = Number(restStats?.total || 0);
      Object.entries(restStats?.byDay || {}).forEach(([day, val]) => {
        const n = Number(val || 0);
        if (!(Number.isFinite(n) && n > 0)) return;
        usedLeaveDetails.push({ date: day, days: n, type: '休息', source: '日报休息' });
        addDetailToWeeks(day, n);
      });
    }

    usedLeave = Number((Number(usedLeave || 0)).toFixed(2));

    // 考勤缺失扣假：有出勤(日报上班)但当天缺上班卡或下班卡，每缺勤1天扣1天休假（2026-06起）。
    // 由调用方异步算好后通过 opts.penalty 注入，计入已用假期并在「休息明细」展示。
    const penalty = opts && typeof opts === 'object' ? opts.penalty : null;
    const penaltyDays = Number(penalty?.days || 0);
    if (Number.isFinite(penaltyDays) && penaltyDays > 0) {
      usedLeave = Number((usedLeave + penaltyDays).toFixed(2));
      if (Array.isArray(penalty?.details)) {
        for (const d of penalty.details) usedLeaveDetails.push(d);
      }
    }

    // 月初「累计假期」池：人工 carryover > 上月闭合快照 > 实时滚动（与我的档案、欠休展示一致）
    const cumulativeLeaveDays = getLockedOpeningCarryForMonth(state, emp, m);
    const totalLeave = Number((baseLeave + annualLeave).toFixed(2));
    const monthRemaining = Number((totalLeave - usedLeave).toFixed(2));
    const computedRemaining = Number((cumulativeLeaveDays + totalLeave - usedLeave).toFixed(2));

    const override = getLeaveBalanceOverride(state, uname, m);
    const overridden = !!override;
    const overrideMode = override?.mode || null;
    const overrideValue = override?.value ?? null;
    const carryoverManualLock = !!(override && String(override.mode || '').trim().toLowerCase() === 'carryover');
    let remaining = computedRemaining;
    if (override && String(override.mode || '').trim().toLowerCase() === 'remaining' && Number.isFinite(Number(override.value))) {
      remaining = Number(Number(override.value).toFixed(2));
    }

    const adjustments = Array.isArray(state?.leaveBalanceAdjustments) ? state.leaveBalanceAdjustments : [];
    const overrideKeyNorm = leaveBalanceOverrideKey(uname, m);
    const lastAdjustment = adjustments.find((a) => {
      const k = String(a?.key || '');
      if (k && k.toLowerCase() === overrideKeyNorm) return true;
      const mo = String(a?.month || '').trim();
      const tu = String(a?.targetUsername || '').trim().toLowerCase();
      return mo === m && tu === String(uname || '').trim().toLowerCase();
    }) || null;

    weekDetails.forEach((wk) => {
      wk.remaining = Number((Number(wk.entitled || 0) - Number(wk.used || 0)).toFixed(2));
    });

    return {
      username: uname,
      month: m,
      baseLeave,
      annualLeave: Number(annualLeave.toFixed(2)),
      usedLeave: Number(usedLeave.toFixed(2)),
      totalLeave,
      cumulativeLeaveDays: Number(cumulativeLeaveDays.toFixed(2)),
      monthRemaining,
      computedRemaining,
      remaining: Number(remaining.toFixed(2)),
      overridden,
      overrideValue: overridden ? Number(overrideValue) : null,
      overrideMode: overridden ? overrideMode : null,
      usedLeaveDetails,
      /** 人事已手动校准「截止上月累计假期」：月初池以人工为准，当月内不按公式滚动重算该池（次月1日系统锁数后可对照核验） */
      cumulativeLeaveManualLock: carryoverManualLock,
      weeklyDetails: weekDetails,
      lastAdjustment
    };
  }

  return {
    resolveEmployeeLeaveCalcStartMonth,
    calcEmployeeMonthlyApprovedLeaveDays,
    calcEmployeeMonthlyCarryover,
    calcEmployeeMonthlyLeaveBalance,
  };
}
