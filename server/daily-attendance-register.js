/**
 * 营业日报「今日实际出勤」台账：在职与打卡、已通过休假比对；休息以日报为准；名册缺口检缺勤。
 */
import {
  safeDateOnly,
  parseDailyReportStaffPayload,
  collectNamesNeedResolve,
  createUserResolver,
  collectOnReportUserKeys,
  resolveNamesToUsernames,
  fetchStoreActiveEmployeesUsernames,
  fetchClockSetForUsers,
  fetchLeaveMapForUsers,
  buildAttendanceRegisterLineDetails,
  summarizeRegisterOverallStatus,
  upsertDailyReportAttendanceRegister,
} from './domains/leave-attendance/daily-attendance-register-helpers.js';

export function normalizeRegisterLineDetails(row) {
  let ld = row?.line_details;
  if (ld == null) return [];
  if (typeof ld === 'string') {
    try {
      ld = JSON.parse(ld);
    } catch {
      return [];
    }
  }
  return Array.isArray(ld) ? ld : [];
}

export function parseRegisterRowDateKey(row) {
  const v = row?.report_date;
  if (!v && v !== 0) return '';
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  return String(v).trim().slice(0, 10);
}

function employeeTokenMatchesLine(ln, qLower) {
  if (!qLower) return true;
  const name = String(ln?.display_name || '').trim().toLowerCase();
  const user = String(ln?.username || '').trim().toLowerCase();
  return (name && name.includes(qLower)) || (user && user.includes(qLower));
}

/** GET 出勤表：按姓名关键词汇总在职/休息日历天数与人日 */
export function summarizeDailyRegisterForEmployee(rows, employeeRaw) {
  const q = String(employeeRaw || '').trim().toLowerCase();
  if (!q) return null;
  const workDates = new Set();
  const restDates = new Set();
  let workPd = 0;
  let restPd = 0;
  for (const row of rows || []) {
    const dateKey = parseRegisterRowDateKey(row);
    if (!dateKey) continue;
    const lines = normalizeRegisterLineDetails(row);
    for (const ln of lines) {
      if (!employeeTokenMatchesLine(ln, q)) continue;
      const kind = String(ln.kind || '');
      const d = Number(ln.declared_days);
      const pd = Number.isFinite(d) && d > 0 ? d : 1;
      if (kind === 'work') {
        workDates.add(dateKey);
        workPd += pd;
      } else if (kind === 'rest') {
        restDates.add(dateKey);
        restPd += pd;
      }
    }
  }
  const round2 = (x) => Math.round(x * 100) / 100;
  return {
    employee_query: String(employeeRaw || '').trim(),
    attendance_days: workDates.size,
    rest_days: restDates.size,
    attendance_person_days: round2(workPd),
    rest_person_days: round2(restPd),
    matched: workDates.size > 0 || restDates.size > 0
  };
}

/** 仅保留姓名匹配的明细行；无匹配行的日期整行剔除 */
export function filterDailyRegisterRowsByEmployee(rows, employeeRaw) {
  const q = String(employeeRaw || '').trim().toLowerCase();
  if (!q) return rows || [];
  const out = [];
  for (const row of rows || []) {
    const lines = normalizeRegisterLineDetails(row).filter((ln) => employeeTokenMatchesLine(ln, q));
    if (!lines.length) continue;
    out.push({ ...row, line_details: lines });
  }
  return out;
}

/**
 * @param {import('pg').Pool} pool
 * @param {{ store: string, brand?: string, reportDate: string, staffPayload?: object, laborTotal?: number }} opts
 */
export async function reconcileDailyReportAttendanceRegister(pool, opts) {
  const store = String(opts.store || '').trim();
  const reportDate = safeDateOnly(opts.reportDate);
  if (!store || !reportDate) return { ok: false, skipped: true };

  const brand = String(opts.brand || '').trim();
  const laborTotal = Number(opts.laborTotal || 0);
  const tenantId = String(opts.tenantId || '').trim() || 'default';

  const {
    staffObj,
    frontArr,
    kitchenArr,
    restMerged,
    frontPersonDays,
    kitchenPersonDays,
    restPersonDays,
  } = parseDailyReportStaffPayload(opts.staffPayload);

  const nameNeedResolve = collectNamesNeedResolve(frontArr, kitchenArr, restMerged);
  const nameMap = await resolveNamesToUsernames(pool, store, nameNeedResolve, tenantId);
  const resolveUser = createUserResolver(nameMap);

  const { onReportUsernames, nameKeysOnReport } = collectOnReportUserKeys(
    frontArr,
    kitchenArr,
    restMerged,
    resolveUser
  );

  const rosterRows = await fetchStoreActiveEmployeesUsernames(pool, store, tenantId);
  const rosterUsernames = [...new Set(rosterRows.map((r) => r.u).filter(Boolean))];
  const uniqUsers = [...new Set([...onReportUsernames, ...rosterUsernames])];

  const clockSet = await fetchClockSetForUsers(pool, reportDate, uniqUsers);
  const leaveMap = await fetchLeaveMapForUsers(pool, reportDate, uniqUsers, tenantId);

  const lineDetails = buildAttendanceRegisterLineDetails({
    frontArr,
    kitchenArr,
    restMerged,
    resolveUser,
    clockSet,
    leaveMap,
    rosterRows,
    onReportUsernames,
    nameKeysOnReport,
  });

  const { anomalyCount, overallStatus } = summarizeRegisterOverallStatus(lineDetails);

  await upsertDailyReportAttendanceRegister(pool, {
    store,
    brand,
    reportDate,
    laborTotal,
    frontPersonDays,
    kitchenPersonDays,
    restPersonDays,
    staffObj,
    lineDetails,
    overallStatus,
    anomalyCount,
    tenantId,
  });

  return {
    ok: true,
    store,
    reportDate,
    overallStatus,
    anomalyCount,
    lines: lineDetails.length
  };
}

/**
 * 根据 PostgreSQL daily_reports 补缺 daily_report_attendance_register。
 * 上线前已写入 daily_reports、但当时未跑 reconcile 的历史行，会通过本函数补台账。
 *
 * @param {import('pg').Pool} pool
 * @param {{ maxRows?: number, start?: string, end?: string, store?: string, refreshExisting?: boolean }} [opts]
 */
export async function backfillDailyAttendanceRegisterMissing(pool, opts = {}) {
  const maxRows = Math.min(5000, Math.max(1, Number(opts.maxRows) || 800));
  const start = safeDateOnly(opts.start);
  const end = safeDateOnly(opts.end);
  const storeFilter = String(opts.store || '').trim();
  const refreshExisting = !!opts.refreshExisting;

  const params = [];
  let idx = 1;
  let extra = '';
  if (start && end) {
    extra += ` AND dr.date >= $${idx}::date AND dr.date <= $${idx + 1}::date`;
    params.push(start, end);
    idx += 2;
  } else if (start) {
    extra += ` AND dr.date >= $${idx}::date`;
    params.push(start);
    idx += 1;
  } else if (end) {
    extra += ` AND dr.date <= $${idx}::date`;
    params.push(end);
    idx += 1;
  } else {
    extra += ` AND dr.date >= (CURRENT_DATE - INTERVAL '550 days')`;
  }
  if (storeFilter) {
    extra += ` AND TRIM(dr.store) = TRIM($${idx}::text)`;
    params.push(storeFilter);
    idx += 1;
  }
  const limPlaceholder = idx;
  params.push(maxRows);

  const missingOrAll = refreshExisting ? 'TRUE' : 'ar.store IS NULL';

  const sql = `
    SELECT dr.store, dr.brand, dr.date::text AS report_date, dr.staff, dr.labor_total
    FROM daily_reports dr
    LEFT JOIN daily_report_attendance_register ar
      ON TRIM(dr.store) = TRIM(ar.store) AND dr.date::date = ar.report_date
    WHERE (${missingOrAll})${extra}
    ORDER BY dr.date DESC
    LIMIT $${limPlaceholder}`;

  const r = await pool.query(sql, params);
  let reconciled = 0;
  const errors = [];

  for (const row of r.rows || []) {
    try {
      let staffPayload = row.staff;
      if (staffPayload == null || staffPayload === '') staffPayload = {};
      else if (typeof staffPayload === 'string') {
        try {
          staffPayload = JSON.parse(staffPayload);
        } catch {
          staffPayload = {};
        }
      }
      if (typeof staffPayload !== 'object' || Array.isArray(staffPayload)) staffPayload = {};

      await reconcileDailyReportAttendanceRegister(pool, {
        store: String(row.store || '').trim(),
        brand: String(row.brand || '').trim(),
        reportDate: String(row.report_date || '').slice(0, 10),
        staffPayload,
        laborTotal: row.labor_total,
        tenantId: opts.tenantId
      });
      reconciled++;
    } catch (e) {
      errors.push({
        store: row.store,
        date: row.report_date,
        message: String(e?.message || e)
      });
    }
  }

  return { scanned: (r.rows || []).length, reconciled, errors: errors.slice(0, 50) };
}
