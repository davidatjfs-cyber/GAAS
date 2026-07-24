/** 日报休息名单解析与月度实际休息天数 */

export function dailyReportRestStaffForLeaveCalc(staffObj) {
  const so = staffObj && typeof staffObj === 'object' && !Array.isArray(staffObj) ? staffObj : {};
  const lists = [
    Array.isArray(so.restStaff) ? so.restStaff : [],
    Array.isArray(so.frontRestStaff) ? so.frontRestStaff : [],
    Array.isArray(so.kitchenRestStaff) ? so.kitchenRestStaff : []
  ];
  const seen = new Set();
  const out = [];
  for (const arr of lists) {
    for (const it of arr) {
      const u = String(it?.user || it?.username || '').trim().toLowerCase();
      const n = String(it?.name || '').trim();
      const key = u || n.toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(it);
    }
  }
  return out;
}

export function dailyReportHasRestForEmployee(staffObj, unameLower, nameRaw) {
  const uname = String(unameLower || '').trim().toLowerCase();
  const name = String(nameRaw || '').trim();
  if (!uname && !name) return false;
  const restStaff = dailyReportRestStaffForLeaveCalc(staffObj);
  return restStaff.some((it) => {
    const u = String(it?.user || it?.username || '').trim().toLowerCase();
    const n = String(it?.name || '').trim();
    if (u && uname && u === uname) return true;
    if (!u && name && n && n === name) return true;
    return false;
  });
}

// 返回员工当日日报休息「天数」（支持半天 0.5），未命中返回 0。
// 与 dailyReportHasRestForEmployee 的布尔判定一致，但保留 days 精度。
export function dailyReportRestDaysForEmployee(staffObj, unameLower, nameRaw) {
  const uname = String(unameLower || '').trim().toLowerCase();
  const name = String(nameRaw || '').trim();
  if (!uname && !name) return 0;
  const restStaff = dailyReportRestStaffForLeaveCalc(staffObj);
  for (const it of restStaff) {
    const u = String(it?.user || it?.username || '').trim().toLowerCase();
    const n = String(it?.name || '').trim();
    if ((u && uname && u === uname) || (!u && name && n && n === name)) {
      const d = Number(it?.days);
      return Number.isFinite(d) && d > 0 ? d : 1;
    }
  }
  return 0;
}

export function createDailyReportRestHelpers({ safeMonthOnly }) {
  function calcEmployeeMonthlyActualRestFromDailyReports(state, employee, month) {
    const m = safeMonthOnly(month);
    const emp = employee && typeof employee === 'object' ? employee : null;
    const uname = String(emp?.username || '').trim().toLowerCase();
    const name = String(emp?.name || '').trim();
    if (!m || (!uname && !name)) return { total: 0, byDay: {} };

    const reportList = Array.isArray(state?.dailyReports) ? state.dailyReports : [];
    const byDay = {};

    const splitNameTokens = (raw) => String(raw || '')
      .split(/[，,、;；\n\r\t\s\/|]+/)
      .map(x => String(x || '').trim())
      .filter(Boolean);

    const getRestDaysForEmployee = (staffObj) => {
      const so = staffObj && typeof staffObj === 'object' && !Array.isArray(staffObj) ? staffObj : {};
      const lists = [
        Array.isArray(so.restStaff) ? so.restStaff : [],
        Array.isArray(so.frontRestStaff) ? so.frontRestStaff : [],
        Array.isArray(so.kitchenRestStaff) ? so.kitchenRestStaff : []
      ];
      for (const arr of lists) {
        for (const it of arr) {
          const u = String(it?.user || it?.username || '').trim().toLowerCase();
          const n = String(it?.name || '').trim();
          if ((u && uname && u === uname) || (!u && name && n && n === name)) {
            const d = Number(it?.days);
            return Number.isFinite(d) && d > 0 ? d : 1;
          }
        }
      }
      return null;
    };

    reportList.forEach((rep) => {
      const repDate = String(rep?.date || '').trim();
      if (!repDate || !repDate.startsWith(m + '-')) return;
      const data = rep?.data && typeof rep.data === 'object' ? rep.data : {};

      let days = getRestDaysForEmployee(data?.staff);

      // legacy fallback: comma-separated text names
      if (days == null) {
        const frontRest = String(data?.staff?.frontRest || '').trim();
        const kitchenRest = String(data?.staff?.kitchenRest || '').trim();
        const tokens = splitNameTokens(frontRest).concat(splitNameTokens(kitchenRest));
        const tokenSet = new Set(tokens.map(x => x.toLowerCase()));
        const hitByToken = (uname && tokenSet.has(uname)) || (!!name && tokenSet.has(name.toLowerCase()));
        const hitByRaw = (!!name && (frontRest.includes(name) || kitchenRest.includes(name)))
          || (uname && (frontRest.toLowerCase().includes(uname) || kitchenRest.toLowerCase().includes(uname)));
        if (hitByToken || hitByRaw) days = 1;
      }

      if (days != null && days > 0) {
        byDay[repDate] = Number(days);   // 半天休息=0.5，不再硬编码为整天
      }
    });

    const total = Number(Object.values(byDay).reduce((s, x) => {
      const n = Number(x || 0);
      return Number((s + (Number.isFinite(n) ? n : 0)).toFixed(2));
    }, 0).toFixed(2));

    return { total, byDay };
  }

  return {
    dailyReportRestStaffForLeaveCalc,
    dailyReportHasRestForEmployee,
    dailyReportRestDaysForEmployee,
    calcEmployeeMonthlyActualRestFromDailyReports,
  };
}
