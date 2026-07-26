/**
 * P4 peel: reconcileAttendanceDays orchestration helpers.
 */
import { SHARED_TABLES } from '@gaas/shared';

export function safeDateOnly(d) {
  const s = String(d || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
}

export function datesInRange(start, end) {
  const a = safeDateOnly(start);
  const b = safeDateOnly(end);
  if (!a || !b || a > b) return [];
  const out = [];
  let cur = new Date(a + 'T00:00:00');
  const last = new Date(b + 'T00:00:00');
  while (cur <= last) {
    const y = cur.getFullYear();
    const m = String(cur.getMonth() + 1).padStart(2, '0');
    const d = String(cur.getDate()).padStart(2, '0');
    out.push(`${y}-${m}-${d}`);
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

export function leaveTypeNeedsApproval(leaveType, rules) {
  const t = String(leaveType || '').trim().toLowerCase();
  if (!t) return true;
  const list = Array.isArray(rules?.approvedLeaveTypesRequireApproval)
    ? rules.approvedLeaveTypesRequireApproval
    : [];
  return list.some((x) => String(x).trim().toLowerCase() === t || String(x).trim() === leaveType);
}

export function filterStorePeopleFromState(emps, st) {
  const list = Array.isArray(emps) ? emps : [];
  return list.filter((e) => {
    const es = String(e?.store || '').trim();
    if (es !== st && !es.includes(st) && !st.includes(es)) return false;
    const status = String(e?.status || '').trim().toLowerCase();
    if (status === '离职' || status === 'inactive' || status === 'disabled') return false;
    return !!String(e?.username || '').trim();
  });
}

export async function loadReconcilePeople({ db, tid, st, state }) {
  let people = filterStorePeopleFromState(state?.employees, st);
  if (people.length) return people;
  try {
    const er = await db.query(
      `SELECT username, name, store, status, join_date AS "joinDate"
         FROM ${SHARED_TABLES.EMPLOYEES}
        WHERE tenant_id = $1
          AND TRIM(COALESCE(store,'')) ILIKE '%' || $2 || '%'
          AND COALESCE(status,'') NOT IN ('离职','inactive','disabled')`,
      [tid, st]
    );
    people = er.rows || [];
  } catch (_) { /* ignore */ }
  return people;
}

export function loadReportsByDateFromState(dailyReports, { st, start, end }) {
  const reportsByDate = new Map();
  const list = Array.isArray(dailyReports) ? dailyReports : [];
  for (const rep of list) {
    const d = safeDateOnly(rep?.date);
    if (!d || d < start || d > end) continue;
    const rs = String(rep?.store || '').trim();
    if (rs !== st && !rs.includes(st) && !st.includes(rs)) continue;
    const data = rep?.data && typeof rep.data === 'object' ? rep.data : {};
    reportsByDate.set(d, data?.staff || {});
  }
  return reportsByDate;
}

export async function mergeReportsByDateFromRegister({ db, tid, st, start, end, reportsByDate }) {
  const out = new Map(reportsByDate);
  try {
    const dr = await db.query(
      `SELECT report_date::text AS d, staff_snapshot
         FROM daily_report_attendance_register
        WHERE tenant_id = $1
          AND TRIM(store) = TRIM($2)
          AND report_date >= $3::date AND report_date <= $4::date`,
      [tid, st, start, end]
    );
    for (const row of dr.rows || []) {
      const d = safeDateOnly(String(row.d || '').slice(0, 10));
      if (!d || out.has(d)) continue;
      let snap = row.staff_snapshot;
      if (typeof snap === 'string') {
        try { snap = JSON.parse(snap); } catch { snap = {}; }
      }
      out.set(d, snap && typeof snap === 'object' ? snap : {});
    }
  } catch (_) { /* ignore */ }
  return out;
}

export async function loadPunchMapForReconcile({ db, tid, st, start, end }) {
  const punchMap = new Map();
  try {
    const cr = await db.query(
      `SELECT LOWER(TRIM(username)) AS u,
              (timezone('Asia/Shanghai', check_time))::date::text AS d,
              type,
              COUNT(*)::int AS c
         FROM checkin_records
        WHERE tenant_id = $1
          AND (timezone('Asia/Shanghai', check_time))::date >= $2::date
          AND (timezone('Asia/Shanghai', check_time))::date <= $3::date
          AND (TRIM(COALESCE(store,'')) = TRIM($4) OR TRIM(COALESCE(store,'')) = '')
        GROUP BY 1, 2, 3`,
      [tid, start, end, st]
    );
    for (const row of cr.rows || []) {
      const key = `${row.u}|${String(row.d).slice(0, 10)}`;
      const prev = punchMap.get(key) || { in: false, out: false };
      const tp = String(row.type || '').toLowerCase();
      if (tp.includes('out') || tp === 'clock_out' || tp === 'checkout') prev.out = true;
      else prev.in = true;
      punchMap.set(key, prev);
    }
  } catch (_) { /* ignore */ }
  return punchMap;
}

export function mergeLeaveByUserDateFromState(stateLeaves, { start, end }) {
  const leaveByUserDate = new Map();
  const list = Array.isArray(stateLeaves) ? stateLeaves : [];
  for (const lr of list) {
    if (String(lr?.status || '').toLowerCase() === 'rejected') continue;
    const u = String(lr?.applicant || lr?.username || '').trim().toLowerCase();
    const days = datesInRange(lr?.startDate, lr?.endDate);
    for (const d of days) {
      if (d < start || d > end) continue;
      const key = `${u}|${d}`;
      if (leaveByUserDate.has(key)) continue;
      leaveByUserDate.set(key, { id: lr?.id || null, type: String(lr?.type || 'leave').trim() });
    }
  }
  return leaveByUserDate;
}

export async function loadLeaveByUserDateForReconcile({ db, tid, start, end, stateLeaves }) {
  const leaveByUserDate = new Map();
  try {
    const lr = await db.query(
      `SELECT id, LOWER(TRIM(username)) AS u, start_date::text AS sd, end_date::text AS ed, type
         FROM hrms_leave_records
        WHERE tenant_id = $1 AND status = 'approved'
          AND start_date <= $3::date AND end_date >= $2::date`,
      [tid, start, end]
    );
    for (const row of lr.rows || []) {
      const days = datesInRange(String(row.sd).slice(0, 10), String(row.ed).slice(0, 10));
      for (const d of days) {
        if (d < start || d > end) continue;
        leaveByUserDate.set(`${row.u}|${d}`, {
          id: row.id,
          type: String(row.type || 'leave').trim()
        });
      }
    }
  } catch (_) { /* ignore */ }

  const stateMap = mergeLeaveByUserDateFromState(stateLeaves, { start, end });
  for (const [key, val] of stateMap) {
    if (!leaveByUserDate.has(key)) leaveByUserDate.set(key, val);
  }
  return leaveByUserDate;
}

export async function loadConfirmMapForReconcile({ db, tid, start, end }) {
  const confirmMap = new Map();
  try {
    const cf = await db.query(
      `SELECT LOWER(TRIM(username)) AS u, work_date::text AS d, choice, confirmed_by
         FROM hrms_attendance_day_confirmations
        WHERE tenant_id = $1 AND work_date >= $2::date AND work_date <= $3::date`,
      [tid, start, end]
    );
    for (const row of cf.rows || []) {
      confirmMap.set(`${row.u}|${String(row.d).slice(0, 10)}`, row);
    }
  } catch (_) { /* ignore */ }
  return confirmMap;
}

export function classifyAttendanceDayResult({
  cls,
  punch,
  leave,
  rules,
  confirmMap,
  ulower,
  d,
  uname,
  name,
  st,
}) {
  const requireBoth = rules.requireClockInAndOut !== false;
  const complete = requireBoth ? (punch.in && punch.out) : (punch.in || punch.out);

  let result = 'unknown';
  let approvedLeaveId = null;
  let leaveType = null;
  let abnormalEntry = null;

  if (leave && (rules.approvedLeaveAuthoritative !== false) && leaveTypeNeedsApproval(leave.type, rules)) {
    result = 'approved_leave';
    approvedLeaveId = leave.id || null;
    leaveType = leave.type;
  } else if (cls.onWeeklyRest) {
    result = 'weekly_rest';
  } else if (cls.onSchedule && complete) {
    result = 'work';
  } else if (cls.onSchedule && !complete) {
    result = String(rules.noPunchWithSchedule || 'auto_rest') === 'auto_rest' ? 'auto_rest' : 'absence';
  } else if (!cls.onSchedule && complete) {
    const conf = confirmMap.get(`${ulower}|${d}`);
    if (conf?.choice === 'work') result = 'confirmed_work';
    else if (conf?.choice === 'rest') result = 'confirmed_rest';
    else {
      result = 'abnormal';
      abnormalEntry = { username: uname, name, store: st, work_date: d };
    }
  } else {
    result = 'unknown';
  }

  const evidence = {
    onSchedule: cls.onSchedule,
    onWeeklyRest: cls.onWeeklyRest,
    punchIn: !!punch.in,
    punchOut: !!punch.out,
    leaveType: leaveType || leave?.type || null
  };

  return { result, approvedLeaveId, leaveType, complete, evidence, abnormalEntry };
}

export async function upsertAttendanceDayRow({
  db,
  randomUUID,
  tid,
  st,
  uname,
  d,
  result,
  cls,
  punch,
  complete,
  approvedLeaveId,
  leaveType,
  evidence,
}) {
  await db.query(
    `INSERT INTO hrms_attendance_day (
       id, tenant_id, store, username, work_date, result,
       has_schedule, has_clock_in, has_clock_out, has_complete_punch,
       approved_leave_id, leave_type, evidence, updated_at
     ) VALUES (
       $1,$2,$3,$4,$5::date,$6,
       $7,$8,$9,$10,
       $11,$12,$13::jsonb, NOW()
     )
     ON CONFLICT (tenant_id, username, work_date) DO UPDATE SET
       store = EXCLUDED.store,
       result = CASE
         WHEN hrms_attendance_day.locked_at IS NOT NULL THEN hrms_attendance_day.result
         WHEN hrms_attendance_day.result IN ('confirmed_work','confirmed_rest')
           AND EXCLUDED.result = 'abnormal' THEN hrms_attendance_day.result
         ELSE EXCLUDED.result
       END,
       has_schedule = EXCLUDED.has_schedule,
       has_clock_in = EXCLUDED.has_clock_in,
       has_clock_out = EXCLUDED.has_clock_out,
       has_complete_punch = EXCLUDED.has_complete_punch,
       approved_leave_id = COALESCE(EXCLUDED.approved_leave_id, hrms_attendance_day.approved_leave_id),
       leave_type = COALESCE(EXCLUDED.leave_type, hrms_attendance_day.leave_type),
       evidence = EXCLUDED.evidence,
       updated_at = NOW()
     WHERE hrms_attendance_day.locked_at IS NULL`,
    [
      randomUUID(), tid, st, uname, d, result,
      !!cls.onSchedule, !!punch.in, !!punch.out, !!complete,
      approvedLeaveId, leaveType, JSON.stringify(evidence)
    ]
  );
}

export async function runReconcileAttendanceDaysLoop({
  db,
  randomUUID,
  tid,
  st,
  people,
  allDates,
  reportsByDate,
  punchMap,
  leaveByUserDate,
  confirmMap,
  rules,
  classifyFromDailyReportStaff,
}) {
  let upserted = 0;
  const abnormals = [];

  for (const person of people) {
    const uname = String(person.username || '').trim();
    const ulower = uname.toLowerCase();
    const name = String(person.name || '').trim();
    const joinDate = safeDateOnly(person.joinDate || person.join_date || '');
    const resignDate = safeDateOnly(person.offboardingDate || person.resignedAt || '');

    for (const d of allDates) {
      if (joinDate && d < joinDate) continue;
      if (resignDate && d > resignDate) continue;

      const staff = reportsByDate.get(d) || {};
      const cls = classifyFromDailyReportStaff(staff, uname, name);
      const punch = punchMap.get(`${ulower}|${d}`) || { in: false, out: false };
      const leave = leaveByUserDate.get(`${ulower}|${d}`) || null;

      const classified = classifyAttendanceDayResult({
        cls,
        punch,
        leave,
        rules,
        confirmMap,
        ulower,
        d,
        uname,
        name,
        st,
      });

      if (classified.abnormalEntry) abnormals.push(classified.abnormalEntry);

      await upsertAttendanceDayRow({
        db,
        randomUUID,
        tid,
        st,
        uname,
        d,
        result: classified.result,
        cls,
        punch,
        complete: classified.complete,
        approvedLeaveId: classified.approvedLeaveId,
        leaveType: classified.leaveType,
        evidence: classified.evidence,
      });
      upserted += 1;
    }
  }

  return { upserted, abnormals };
}
