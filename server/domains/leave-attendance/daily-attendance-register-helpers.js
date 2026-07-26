/**
 * P4 peel: reconcileDailyReportAttendanceRegister orchestration helpers.
 */

export function sumHrmsStaffPersonDays(arr) {
  const list = Array.isArray(arr) ? arr : [];
  let sum = 0;
  for (const x of list) {
    const d = Number(x?.days);
    if (Number.isFinite(d) && d > 0) sum += d;
    else sum += 1;
  }
  return Math.round(sum * 100) / 100;
}

export function mergeDailyReportRestStaff(staffObj) {
  const so = staffObj && typeof staffObj === 'object' && !Array.isArray(staffObj) ? staffObj : {};
  const lists = [
    Array.isArray(so.restStaff) ? so.restStaff : [],
    Array.isArray(so.frontRestStaff) ? so.frontRestStaff : [],
    Array.isArray(so.kitchenRestStaff) ? so.kitchenRestStaff : []
  ];
  const seen = new Set();
  const out = [];
  for (const arr of lists) {
    for (const x of arr) {
      const u = String(x?.user || x?.username || '').trim().toLowerCase();
      const n = String(x?.name || '').trim();
      const key = u || n.toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(x);
    }
  }
  return out;
}

export function safeDateOnly(d) {
  const s = String(d || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
}

export function parseDailyReportStaffPayload(staffPayload) {
  const staffObj =
    staffPayload && typeof staffPayload === 'object' && !Array.isArray(staffPayload)
      ? staffPayload
      : {};
  const frontArr = Array.isArray(staffObj.front) ? staffObj.front : [];
  const kitchenArr = Array.isArray(staffObj.kitchen) ? staffObj.kitchen : [];
  const restMerged = mergeDailyReportRestStaff(staffObj);
  return {
    staffObj,
    frontArr,
    kitchenArr,
    restMerged,
    frontPersonDays: sumHrmsStaffPersonDays(frontArr),
    kitchenPersonDays: sumHrmsStaffPersonDays(kitchenArr),
    restPersonDays: sumHrmsStaffPersonDays(restMerged),
  };
}

export function collectNamesNeedResolve(frontArr, kitchenArr, restMerged) {
  const nameNeedResolve = [];
  for (const e of [...frontArr, ...kitchenArr, ...restMerged]) {
    const u = String(e?.user || e?.username || '').trim();
    const n = String(e?.name || '').trim();
    if (!u && n) nameNeedResolve.push(n);
  }
  return nameNeedResolve;
}

export function createUserResolver(nameMap) {
  const m = nameMap instanceof Map ? nameMap : new Map();
  return function resolveUser(e) {
    const raw = String(e?.user || e?.username || '').trim();
    if (raw) return raw.toLowerCase();
    const n = String(e?.name || '').trim();
    return String(m.get(n) || '').trim().toLowerCase();
  };
}

export function collectOnReportUserKeys(frontArr, kitchenArr, restMerged, resolveUser) {
  const onReportUsernames = new Set();
  const nameKeysOnReport = new Set();
  const allUsernames = [];
  for (const e of [...frontArr, ...kitchenArr, ...restMerged]) {
    const u = resolveUser(e);
    if (u) {
      allUsernames.push(u);
      onReportUsernames.add(u);
    }
    const n = String(e?.name || '').trim().toLowerCase();
    if (n) nameKeysOnReport.add(n);
  }
  return { onReportUsernames, nameKeysOnReport, allUsernames };
}

export async function resolveNamesToUsernames(pool, store, nameList, tenantId) {
  const names = [...new Set(nameList.map((n) => String(n || '').trim()).filter(Boolean))];
  const m = new Map();
  if (!names.length || !store) return m;
  try {
    const q = await pool.query(
      `SELECT LOWER(TRIM(username)) AS u, TRIM(name) AS name FROM employees
       WHERE TRIM(COALESCE(store, '')) ILIKE '%' || $1 || '%'
         AND TRIM(name) = ANY($2::text[])
         AND tenant_id = $3`,
      [store, names, tenantId || 'default']
    );
    for (const row of q.rows || []) {
      const nm = String(row.name || '').trim();
      if (nm && row.u) m.set(nm, String(row.u || '').trim());
    }
  } catch {
    /* employees 表缺失或非致命 */
  }
  return m;
}

export async function fetchStoreActiveEmployeesUsernames(pool, store, tenantId) {
  const st = String(store || '').trim();
  if (!st) return [];
  try {
    const q = await pool.query(
      `SELECT DISTINCT ON (LOWER(TRIM(username)))
          LOWER(TRIM(username)) AS u,
          TRIM(COALESCE(name, '')) AS name
       FROM employees
       WHERE TRIM(COALESCE(store, '')) ILIKE '%' || $1 || '%'
         AND TRIM(COALESCE(username, '')) <> ''
         AND (
           status IS NULL OR BTRIM(status) = ''
           OR LOWER(BTRIM(status)) NOT IN ('inactive', 'disabled', '离职', '禁用', '停用', 'left', 'resigned')
         )
         AND NOT COALESCE((extra_json->>'offboardingApproved')::boolean, false)
         AND tenant_id = $2
       ORDER BY LOWER(TRIM(username))`,
      [st, tenantId || 'default']
    );
    return (q.rows || []).map((r) => ({
      u: String(r.u || '').trim(),
      name: String(r.name || '').trim()
    }));
  } catch {
    return [];
  }
}

export async function fetchClockSetForUsers(pool, reportDate, uniqUsers) {
  const clockSet = new Set();
  if (!uniqUsers.length) return clockSet;
  try {
    const cr = await pool.query(
      `SELECT DISTINCT LOWER(TRIM(username)) AS u
         FROM checkin_records
        WHERE (timezone('Asia/Shanghai', check_time))::date = $1::date
          AND LOWER(TRIM(username)) = ANY($2::text[])`,
      [reportDate, uniqUsers]
    );
    for (const row of cr.rows || []) clockSet.add(String(row.u || '').trim());
  } catch {
    /* checkin 不可用时不阻断台账写入 */
  }
  return clockSet;
}

export async function fetchLeaveMapForUsers(pool, reportDate, uniqUsers, tenantId) {
  const leaveMap = new Map();
  if (!uniqUsers.length) return leaveMap;
  try {
    const lr = await pool.query(
      `SELECT LOWER(TRIM(username)) AS u, COUNT(*)::int AS c
         FROM hrms_leave_records
        WHERE status = 'approved'
          AND start_date <= $1::date AND end_date >= $1::date
          AND LOWER(TRIM(username)) = ANY($2::text[])
          AND tenant_id = $3
        GROUP BY LOWER(TRIM(username))`,
      [reportDate, uniqUsers, tenantId]
    );
    for (const row of lr.rows || []) leaveMap.set(String(row.u || '').trim(), Number(row.c || 0));
  } catch {
    /* 休假表不可用 */
  }
  return leaveMap;
}

export function buildWorkRegisterLine(segment, e, resolveUser, clockSet, leaveMap) {
  const displayName = String(e?.name || e?.user || e?.username || '').trim() || '—';
  const username = resolveUser(e);
  const declaredDays = Number(e?.days);
  const d = Number.isFinite(declaredDays) && declaredDays > 0 ? declaredDays : 1;
  const reasons = [];
  let status = 'verified';

  if (!username) {
    status = 'abnormal';
    reasons.push('缺少系统账号（无法在打卡与休假数据中比对）');
  } else if (d >= 0.5) {
    const leaveN = leaveMap.get(username) || 0;
    const hasClock = clockSet.has(username);
    if (leaveN > 0) {
      status = 'abnormal';
      reasons.push('日报填在职，但当日存在已通过休假记录');
    }
    if (!hasClock) {
      status = 'abnormal';
      reasons.push('日报填在职，当日无打卡记录');
    }
  }

  return {
    kind: 'work',
    role_segment: segment,
    username,
    display_name: displayName,
    declared_days: d,
    has_clock_in: username ? clockSet.has(username) : false,
    approved_leave_hits: username ? leaveMap.get(username) || 0 : 0,
    status,
    reasons
  };
}

export function buildRestRegisterLine(e, resolveUser, clockSet, leaveMap) {
  const displayName = String(e?.name || e?.user || e?.username || '').trim() || '—';
  const username = resolveUser(e);
  const declaredDays = Number(e?.days);
  const d = Number.isFinite(declaredDays) && declaredDays > 0 ? declaredDays : 1;

  return {
    kind: 'rest',
    role_segment: 'rest',
    username,
    display_name: displayName,
    declared_days: d,
    has_clock_in: username ? clockSet.has(username) : false,
    approved_leave_hits: username ? leaveMap.get(username) || 0 : 0,
    status: 'verified',
    reasons: []
  };
}

export function buildRosterGapRegisterLines({
  rosterRows,
  onReportUsernames,
  nameKeysOnReport,
  clockSet,
  leaveMap,
}) {
  const lineDetails = [];
  const rosterByU = new Map(rosterRows.map((r) => [r.u, r.name]));
  for (const row of rosterRows) {
    const u = row.u;
    if (!u || onReportUsernames.has(u)) continue;
    const nm = String(row.name || '').trim().toLowerCase();
    if (nm && nameKeysOnReport.has(nm)) continue;

    const displayName = String(rosterByU.get(u) || u || '').trim() || u;
    const leaveN = leaveMap.get(u) || 0;
    const hasClock = clockSet.has(u);
    if (leaveN > 0) {
      lineDetails.push({
        kind: 'leave_only',
        role_segment: 'roster',
        username: u,
        display_name: displayName,
        declared_days: 0,
        has_clock_in: hasClock,
        approved_leave_hits: leaveN,
        status: 'verified',
        reasons: ['未列入日报出勤/休息，但当日有已通过休假记录']
      });
    } else {
      const reasons = ['门店名册中有此人，但日报未列入出勤或休息；且无已通过休假记录，视为缺勤'];
      if (hasClock) reasons.push('当日有打卡记录，请核对是否漏填出勤');
      lineDetails.push({
        kind: 'absent',
        role_segment: 'roster',
        username: u,
        display_name: displayName,
        declared_days: 0,
        has_clock_in: hasClock,
        approved_leave_hits: 0,
        status: 'abnormal',
        reasons
      });
    }
  }
  return lineDetails;
}

export function buildAttendanceRegisterLineDetails({
  frontArr,
  kitchenArr,
  restMerged,
  resolveUser,
  clockSet,
  leaveMap,
  rosterRows,
  onReportUsernames,
  nameKeysOnReport,
}) {
  const lineDetails = [];
  for (const e of frontArr) lineDetails.push(buildWorkRegisterLine('front', e, resolveUser, clockSet, leaveMap));
  for (const e of kitchenArr) lineDetails.push(buildWorkRegisterLine('kitchen', e, resolveUser, clockSet, leaveMap));
  for (const e of restMerged) lineDetails.push(buildRestRegisterLine(e, resolveUser, clockSet, leaveMap));
  lineDetails.push(...buildRosterGapRegisterLines({
    rosterRows,
    onReportUsernames,
    nameKeysOnReport,
    clockSet,
    leaveMap,
  }));
  return lineDetails;
}

export function summarizeRegisterOverallStatus(lineDetails) {
  const anomalyCount = lineDetails.filter((x) => x.status !== 'verified').length;
  const overallStatus = anomalyCount === 0 ? 'verified' : 'abnormal';
  return { anomalyCount, overallStatus };
}

export async function upsertDailyReportAttendanceRegister(pool, row) {
  const {
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
  } = row;
  await pool.query(
    `INSERT INTO daily_report_attendance_register (
       store, brand, report_date, labor_total,
       front_person_days, kitchen_person_days, rest_person_days,
       staff_snapshot, line_details, overall_status, anomaly_count, updated_at, tenant_id
     ) VALUES (
       $1::text, $2::text, $3::date, $4,
       $5, $6, $7,
       $8::jsonb, $9::jsonb, $10, $11, NOW(), $12
     )
     ON CONFLICT (store, report_date, tenant_id) DO UPDATE SET
       brand = EXCLUDED.brand,
       labor_total = EXCLUDED.labor_total,
       front_person_days = EXCLUDED.front_person_days,
       kitchen_person_days = EXCLUDED.kitchen_person_days,
       rest_person_days = EXCLUDED.rest_person_days,
       staff_snapshot = EXCLUDED.staff_snapshot,
       line_details = EXCLUDED.line_details,
       overall_status = EXCLUDED.overall_status,
       anomaly_count = EXCLUDED.anomaly_count,
       updated_at = NOW()`,
    [
      store,
      brand || null,
      reportDate,
      Number.isFinite(laborTotal) ? laborTotal : null,
      frontPersonDays,
      kitchenPersonDays,
      restPersonDays,
      JSON.stringify(staffObj),
      JSON.stringify(lineDetails),
      overallStatus,
      anomalyCount,
      tenantId
    ]
  );
}
