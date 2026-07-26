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
import {
  safeDateOnly,
  datesInRange,
  loadReconcilePeople,
  loadReportsByDateFromState,
  mergeReportsByDateFromRegister,
  loadPunchMapForReconcile,
  loadLeaveByUserDateForReconcile,
  loadConfirmMapForReconcile,
  runReconcileAttendanceDaysLoop,
} from '../domains/leave-attendance/reconcile-attendance-days-helpers.js';

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

  const people = await loadReconcilePeople({ db, tid, st, state });

  const reportsFromState = loadReportsByDateFromState(state.dailyReports, { st, start, end });
  const reportsByDate = await mergeReportsByDateFromRegister({
    db,
    tid,
    st,
    start,
    end,
    reportsByDate: reportsFromState,
  });

  const punchMap = await loadPunchMapForReconcile({ db, tid, st, start, end });
  const leaveByUserDate = await loadLeaveByUserDateForReconcile({
    db,
    tid,
    start,
    end,
    stateLeaves: state.leaveRecords,
  });
  const confirmMap = await loadConfirmMapForReconcile({ db, tid, start, end });

  const allDates = datesInRange(start, end);
  const { upserted, abnormals } = await runReconcileAttendanceDaysLoop({
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
  });

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
  try { state = (await getSharedState(tenantId)) || { /* ignore */ }; } catch (_) { /* ignore */ }
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
