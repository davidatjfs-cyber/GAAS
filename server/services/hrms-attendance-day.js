/**
 * 考勤日结果：营业日报排班 + 完整打卡(上/下班) + 休假审批 → 权威日结果
 *
 * 规则（洪潮/马己仙默认，可配置覆盖）：
 * - 已批事假/病假/还休：以审批为准 → approved_leave
 * - 日报休息名单：周休 → weekly_rest（无需审批）
 * - 有排班 + 上/下班齐全 → work
 * - 有排班 + 无完整打卡 → auto_rest
 * - 无排班 + 完整打卡 → abnormal（店长确认 work/rest）
 */
import { randomUUID } from 'crypto';
import { pool as getPool } from '../utils/database.js';
import { ensurePayrollRulesTables, resolveAttendancePayrollRules } from './hrms-payroll-rules.js';

function safeDateOnly(d) {
  const s = String(d || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
}

function datesInRange(start, end) {
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

function leaveTypeNeedsApproval(leaveType, rules) {
  const t = String(leaveType || '').trim().toLowerCase();
  if (!t) return true;
  const list = Array.isArray(rules?.approvedLeaveTypesRequireApproval)
    ? rules.approvedLeaveTypesRequireApproval
    : [];
  return list.some((x) => String(x).trim().toLowerCase() === t || String(x).trim() === leaveType);
}

/**
 * 从营业日报 staff 提取某人当天是否在职排班 / 休息
 */
export function classifyFromDailyReportStaff(staffObj, username, name) {
  const uname = String(username || '').trim().toLowerCase();
  const nm = String(name || '').trim();
  const so = staffObj && typeof staffObj === 'object' && !Array.isArray(staffObj) ? staffObj : {};
  const workLists = [
    ...(Array.isArray(so.front) ? so.front : []),
    ...(Array.isArray(so.kitchen) ? so.kitchen : [])
  ];
  const restLists = [
    ...(Array.isArray(so.restStaff) ? so.restStaff : []),
    ...(Array.isArray(so.frontRestStaff) ? so.frontRestStaff : []),
    ...(Array.isArray(so.kitchenRestStaff) ? so.kitchenRestStaff : [])
  ];

  const hit = (arr) => {
    for (const it of arr) {
      const u = String(it?.user || it?.username || '').trim().toLowerCase();
      const n = String(it?.name || '').trim();
      if ((u && uname && u === uname) || (!u && nm && n === nm)) {
        const d = Number(it?.days);
        return { hit: true, days: Number.isFinite(d) && d > 0 ? d : 1 };
      }
    }
    return { hit: false, days: 0 };
  };

  const w = hit(workLists);
  const r = hit(restLists);
  return {
    onSchedule: w.hit,
    onWeeklyRest: r.hit,
    scheduleDays: w.days,
    restDays: r.days
  };
}

/**
 * 重算某店某日（或日期区间）的日结果并 upsert
 */
export async function reconcileAttendanceDays({
  tenantId = 'default',
  store,
  startDate,
  endDate,
  db = getPool(),
  getSharedState
} = {}) {
  await ensurePayrollRulesTables(db);
  const tid = String(tenantId || 'default').trim() || 'default';
  const st = String(store || '').trim();
  const start = safeDateOnly(startDate);
  const end = safeDateOnly(endDate || startDate);
  if (!st || !start || !end) return { ok: false, error: 'missing_store_or_range' };

  const { rules } = await resolveAttendancePayrollRules({ tenantId: tid, store: st, db });

  let state = {};
  if (typeof getSharedState === 'function') {
    try { state = (await getSharedState(tid)) || {}; } catch (_) { state = {}; }
  }

  // 在职员工
  const emps = Array.isArray(state.employees) ? state.employees : [];
  let people = emps.filter((e) => {
    const es = String(e?.store || '').trim();
    if (es !== st && !es.includes(st) && !st.includes(es)) return false;
    const status = String(e?.status || '').trim().toLowerCase();
    if (status === '离职' || status === 'inactive' || status === 'disabled') return false;
    return !!String(e?.username || '').trim();
  });
  if (!people.length) {
    try {
      const er = await db.query(
        `SELECT username, name, store, status, join_date AS "joinDate"
           FROM employees
          WHERE tenant_id = $1
            AND TRIM(COALESCE(store,'')) ILIKE '%' || $2 || '%'
            AND COALESCE(status,'') NOT IN ('离职','inactive','disabled')`,
        [tid, st]
      );
      people = er.rows || [];
    } catch (_) {}
  }

  // 日报
  const reportsByDate = new Map();
  const dailyReports = Array.isArray(state.dailyReports) ? state.dailyReports : [];
  for (const rep of dailyReports) {
    const d = safeDateOnly(rep?.date);
    if (!d || d < start || d > end) continue;
    const rs = String(rep?.store || '').trim();
    if (rs !== st && !rs.includes(st) && !st.includes(rs)) continue;
    const data = rep?.data && typeof rep.data === 'object' ? rep.data : {};
    reportsByDate.set(d, data?.staff || {});
  }
  // DB 日报兜底
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
      if (!d || reportsByDate.has(d)) continue;
      let snap = row.staff_snapshot;
      if (typeof snap === 'string') {
        try { snap = JSON.parse(snap); } catch { snap = {}; }
      }
      reportsByDate.set(d, snap && typeof snap === 'object' ? snap : {});
    }
  } catch (_) {}

  // 打卡：按人按日聚合 in/out
  const punchMap = new Map(); // key: user|date -> {in,out}
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
  } catch (_) {}

  // 已批休假覆盖日
  const leaveByUserDate = new Map(); // user|date -> {id, type}
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
  } catch (_) {}
  // state leaveRecords 兜底
  const stateLeaves = Array.isArray(state.leaveRecords) ? state.leaveRecords : [];
  for (const lr of stateLeaves) {
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

  // 已有确认
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
  } catch (_) {}

  const allDates = datesInRange(start, end);
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
      const requireBoth = rules.requireClockInAndOut !== false;
      const complete = requireBoth ? (punch.in && punch.out) : (punch.in || punch.out);
      const leave = leaveByUserDate.get(`${ulower}|${d}`) || null;

      let result = 'unknown';
      let approvedLeaveId = null;
      let leaveType = null;

      // 1) 需审批的休假以审批为准
      if (leave && (rules.approvedLeaveAuthoritative !== false) && leaveTypeNeedsApproval(leave.type, rules)) {
        result = 'approved_leave';
        approvedLeaveId = leave.id || null;
        leaveType = leave.type;
      } else if (cls.onWeeklyRest) {
        // 2) 日报周休
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
          abnormals.push({ username: uname, name, store: st, work_date: d });
        }
      } else {
        // 无排班无打卡：若不在名册出勤期望中，跳过或记 unknown——在职但未上日报视为需关注
        // 保守：不写 absence，写 unknown 避免误扣；月结时再暴露
        result = 'unknown';
      }

      const evidence = {
        onSchedule: cls.onSchedule,
        onWeeklyRest: cls.onWeeklyRest,
        punchIn: !!punch.in,
        punchOut: !!punch.out,
        leaveType: leaveType || leave?.type || null
      };

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
      upserted += 1;
    }
  }

  return { ok: true, upserted, abnormalCount: abnormals.length, abnormals: abnormals.slice(0, 200), rulesApplied: rules };
}

export async function confirmAttendanceDayAbnormal({
  tenantId = 'default',
  username,
  workDate,
  choice,
  confirmedBy,
  note,
  db = getPool()
} = {}) {
  await ensurePayrollRulesTables(db);
  const tid = String(tenantId || 'default').trim() || 'default';
  const u = String(username || '').trim();
  const d = safeDateOnly(workDate);
  const ch = String(choice || '').trim().toLowerCase();
  if (!u || !d || !['work', 'rest'].includes(ch)) {
    return { ok: false, error: 'invalid_params' };
  }
  const result = ch === 'work' ? 'confirmed_work' : 'confirmed_rest';
  const r = await db.query(
    `UPDATE hrms_attendance_day
        SET result = $4,
            confirm_choice = $5,
            confirmed_by = $6,
            confirmed_at = NOW(),
            updated_at = NOW()
      WHERE tenant_id = $1 AND LOWER(username) = LOWER($2) AND work_date = $3::date
        AND locked_at IS NULL
      RETURNING id, store, username, work_date, result`,
    [tid, u, d, result, ch, String(confirmedBy || '').trim()]
  );
  const row = r.rows?.[0];
  if (!row) return { ok: false, error: 'not_found_or_locked' };
  await db.query(
    `INSERT INTO hrms_attendance_day_confirmations
       (id, tenant_id, attendance_day_id, username, store, work_date, choice, confirmed_by, note)
     VALUES ($1,$2,$3,$4,$5,$6::date,$7,$8,$9)`,
    [randomUUID(), tid, row.id, row.username, row.store || '', d, ch, String(confirmedBy || '').trim(), String(note || '').trim() || null]
  );
  return { ok: true, row };
}

export async function listAbnormalAttendanceDays({
  tenantId = 'default',
  store,
  startDate,
  endDate,
  db = getPool()
} = {}) {
  const tid = String(tenantId || 'default').trim() || 'default';
  const args = [tid];
  let sql = `SELECT * FROM hrms_attendance_day WHERE tenant_id = $1 AND result = 'abnormal'`;
  if (store) {
    args.push(String(store).trim());
    sql += ` AND TRIM(store) = TRIM($${args.length})`;
  }
  if (startDate) {
    args.push(safeDateOnly(startDate));
    sql += ` AND work_date >= $${args.length}::date`;
  }
  if (endDate) {
    args.push(safeDateOnly(endDate));
    sql += ` AND work_date <= $${args.length}::date`;
  }
  sql += ` ORDER BY work_date DESC, username ASC LIMIT 500`;
  const r = await db.query(sql, args);
  return r.rows || [];
}

/** 月汇总：出勤天、周休、审批假、自动休息等 */
export async function summarizeAttendanceDaysForMonth({
  tenantId = 'default',
  username,
  month,
  db = getPool()
} = {}) {
  const tid = String(tenantId || 'default').trim() || 'default';
  const u = String(username || '').trim();
  const m = String(month || '').trim();
  if (!u || !/^\d{4}-\d{2}$/.test(m)) return null;
  const r = await db.query(
    `SELECT result, COUNT(*)::int AS c
       FROM hrms_attendance_day
      WHERE tenant_id = $1 AND LOWER(username) = LOWER($2)
        AND to_char(work_date, 'YYYY-MM') = $3
      GROUP BY result`,
    [tid, u, m]
  );
  const counts = {};
  for (const row of r.rows || []) counts[row.result] = Number(row.c || 0);
  const workDays = (counts.work || 0) + (counts.confirmed_work || 0);
  const restDays =
    (counts.weekly_rest || 0) +
    (counts.approved_leave || 0) +
    (counts.auto_rest || 0) +
    (counts.confirmed_rest || 0);
  return { username: u, month: m, counts, workDays, restDays, abnormalDays: counts.abnormal || 0 };
}

const REST_DAY_RESULTS = new Set(['weekly_rest', 'approved_leave', 'auto_rest', 'confirmed_rest']);

function restResultToDetailType(result, leaveType) {
  const r = String(result || '').trim();
  if (r === 'approved_leave') {
    const lt = String(leaveType || '').trim();
    if (lt && lt !== 'leave') return lt;
    return '休假';
  }
  return '休息';
}

/** 月内每日休息明细（供欠休/档案展示具体日期） */
export async function listAttendanceRestDaysForMonth({
  tenantId = 'default',
  username,
  month,
  db = getPool()
} = {}) {
  const tid = String(tenantId || 'default').trim() || 'default';
  const u = String(username || '').trim();
  const m = String(month || '').trim();
  if (!u || !/^\d{4}-\d{2}$/.test(m)) return [];
  try {
    const r = await db.query(
      `SELECT work_date::text AS d, result, leave_type
         FROM hrms_attendance_day
        WHERE tenant_id = $1 AND LOWER(username) = LOWER($2)
          AND to_char(work_date, 'YYYY-MM') = $3
          AND result = ANY($4::text[])
        ORDER BY work_date ASC`,
      [tid, u, m, Array.from(REST_DAY_RESULTS)]
    );
    const out = [];
    for (const row of r.rows || []) {
      const date = String(row.d || '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      out.push({
        date,
        days: 1,
        type: restResultToDetailType(row.result, row.leave_type),
        source: '日结果',
        result: String(row.result || '').trim()
      });
    }
    return out;
  } catch (_) {
    return [];
  }
}

export async function notifyStoreManagersAttendanceAbnormals({
  abnormals,
  appendNotifications,
  makeNotif,
  getSharedState,
  tenantId = 'default'
}) {
  if (!Array.isArray(abnormals) || !abnormals.length) return 0;
  if (typeof appendNotifications !== 'function' || typeof makeNotif !== 'function') return 0;
  let state = {};
  try { state = (await getSharedState(tenantId)) || {}; } catch (_) {}
  const byStore = new Map();
  for (const a of abnormals) {
    const s = String(a.store || '').trim();
    if (!byStore.has(s)) byStore.set(s, []);
    byStore.get(s).push(a);
  }
  const emps = Array.isArray(state.employees) ? state.employees : [];
  let n = 0;
  for (const [store, list] of byStore) {
    const managers = emps.filter((e) => {
      const role = String(e?.role || '').toLowerCase();
      const es = String(e?.store || '').trim();
      return role === 'store_manager' && (es === store || es.includes(store));
    });
    const sample = list.slice(0, 5).map((x) => `${x.name || x.username}(${x.work_date})`).join('、');
    const msg = `${store} 有 ${list.length} 条「有打卡无排班」考勤异常待确认：${sample}${list.length > 5 ? '…' : ''}。请在报表/考勤异常中选择记为出勤或休息。`;
    for (const m of managers) {
      const u = String(m.username || '').trim();
      if (!u) continue;
      await appendNotifications([makeNotif(u, '考勤异常待确认', msg, { type: 'attendance_abnormal' })]);
      n += 1;
    }
  }
  return n;
}
