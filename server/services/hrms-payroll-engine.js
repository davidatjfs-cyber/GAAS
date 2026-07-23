/**
 * 薪资引擎：读规则 + 日结果 + 底薪时间线 + 账本 → 应发明细
 */
import { randomUUID } from 'crypto';
import { pool as getPool } from '../utils/database.js';
import {
  ensurePayrollRulesTables,
  resolveAttendancePayrollRules,
  workDaysPerMonthFromRules,
  nextMonthFirstFromDate,
  safeBizMonth
} from './hrms-payroll-rules.js';
import { summarizeAttendanceDaysForMonth, reconcileAttendanceDays } from './hrms-attendance-day.js';

function safeDateOnly(d) {
  const s = String(d || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
}

function daysInMonth(month) {
  const [y, mo] = String(month).split('-').map(Number);
  return new Date(y, mo, 0).getDate();
}

function monthDateRange(month) {
  const dim = daysInMonth(month);
  return { start: `${month}-01`, end: `${month}-${String(dim).padStart(2, '0')}`, dim };
}

/** 在职日历天（含首尾） */
export function countActiveCalendarDaysInMonth({ month, joinDate, resignDate }) {
  const { start, end } = monthDateRange(month);
  let from = start;
  let to = end;
  const jd = safeDateOnly(joinDate);
  const rd = safeDateOnly(resignDate);
  if (jd && jd > from) from = jd;
  if (rd && rd < to) to = rd;
  if (from > to) return 0;
  const a = new Date(from + 'T00:00:00');
  const b = new Date(to + 'T00:00:00');
  return Math.floor((b - a) / 86400000) + 1;
}

export function isMidMonthEmployment({ month, joinDate, resignDate }) {
  const { start, end } = monthDateRange(month);
  const jd = safeDateOnly(joinDate);
  const rd = safeDateOnly(resignDate);
  const joinedMid = jd && jd > start && jd <= end;
  const leftMid = rd && rd >= start && rd < end;
  return !!(joinedMid || leftMid);
}

/** 查询某人在计薪月生效的底薪（次月生效规则下，取 effective_from <= 月初 的最近一条） */
export async function getSalaryForMonth({ tenantId, username, month, fallbackSalary, db = getPool() }) {
  await ensurePayrollRulesTables(db);
  const tid = String(tenantId || 'default').trim() || 'default';
  const u = String(username || '').trim();
  const m = String(month || '').trim();
  const asOf = `${m}-01`;
  try {
    const r = await db.query(
      `SELECT amount, effective_from, source
         FROM hrms_salary_timeline
        WHERE tenant_id = $1 AND LOWER(username) = LOWER($2)
          AND effective_from <= $3::date
        ORDER BY effective_from DESC
        LIMIT 1`,
      [tid, u, asOf]
    );
    if (r.rows?.[0]) {
      return {
        amount: Number(r.rows[0].amount),
        effectiveFrom: String(r.rows[0].effective_from).slice(0, 10),
        source: r.rows[0].source
      };
    }
  } catch (_) { /* ignore */ }
  const fb = Number(fallbackSalary);
  return Number.isFinite(fb) ? { amount: fb, effectiveFrom: asOf, source: 'profile_fallback' } : { amount: null, effectiveFrom: null, source: null };
}

export async function insertSalaryTimeline({
  tenantId = 'default',
  username,
  amount,
  effectiveFrom,
  source = 'manual',
  approvalId,
  note,
  createdBy,
  db = getPool()
} = {}) {
  await ensurePayrollRulesTables(db);
  const tid = String(tenantId || 'default').trim() || 'default';
  const u = String(username || '').trim();
  const amt = Number(amount);
  const eff = safeDateOnly(effectiveFrom);
  if (!u || !Number.isFinite(amt) || amt <= 0 || !eff) return { ok: false, error: 'invalid' };
  const r = await db.query(
    `INSERT INTO hrms_salary_timeline (id, tenant_id, username, amount, effective_from, source, approval_id, note, created_by)
     VALUES ($1,$2,$3,$4,$5::date,$6,$7,$8,$9)
     ON CONFLICT (tenant_id, username, effective_from, source) DO UPDATE SET
       amount = EXCLUDED.amount,
       approval_id = COALESCE(EXCLUDED.approval_id, hrms_salary_timeline.approval_id),
       note = COALESCE(EXCLUDED.note, hrms_salary_timeline.note)
     RETURNING *`,
    [randomUUID(), tid, u, amt, eff, String(source || 'manual'), approvalId || null, note || null, createdBy || null]
  );
  return { ok: true, row: r.rows?.[0] };
}

/** 晋升：审批通过日 → 次月1日写入时间线（档案薪资可立即更新供展示，计薪按时间线） */
export async function applyPromotionSalaryNextMonth({
  tenantId,
  username,
  newSalary,
  approvalId,
  approvedAt,
  createdBy,
  db = getPool()
}) {
  const eff = nextMonthFirstFromDate(approvedAt || new Date().toISOString().slice(0, 10));
  return insertSalaryTimeline({
    tenantId,
    username,
    amount: newSalary,
    effectiveFrom: eff,
    source: 'promotion',
    approvalId,
    note: `晋升调薪，${eff} 起整月生效`,
    createdBy,
    db
  });
}

export async function upsertPayrollLedgerEntry({
  tenantId = 'default',
  username,
  store = '',
  bizMonth,
  entryType,
  amount,
  points,
  title,
  reason,
  approvalId,
  sourceRef,
  meta,
  createdBy,
  db = getPool()
} = {}) {
  await ensurePayrollRulesTables(db);
  const tid = String(tenantId || 'default').trim() || 'default';
  const u = String(username || '').trim();
  const bm = safeBizMonth(bizMonth);
  const et = String(entryType || '').trim();
  if (!u || !bm || !et) return { ok: false, error: 'invalid' };
  const amt = Number(amount) || 0;

  if (approvalId) {
    const existing = await db.query(
      `SELECT id FROM hrms_payroll_ledger
        WHERE tenant_id = $1 AND approval_id = $2 AND entry_type = $3
        LIMIT 1`,
      [tid, approvalId, et]
    );
    if (existing.rows?.[0]?.id) {
      const r = await db.query(
        `UPDATE hrms_payroll_ledger SET
           username = $2, store = $3, biz_month = $4, amount = $5, points = $6,
           title = $7, reason = $8, source_ref = $9, meta = $10::jsonb, updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [
          existing.rows[0].id, u, String(store || '').trim(), bm, amt,
          points != null ? Number(points) : null,
          title || null, reason || null, sourceRef || null, JSON.stringify(meta || {})
        ]
      );
      return { ok: true, row: r.rows?.[0] };
    }
  }

  const r = await db.query(
    `INSERT INTO hrms_payroll_ledger (
       id, tenant_id, username, store, biz_month, entry_type, amount, points,
       title, reason, approval_id, source_ref, meta, created_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14)
     RETURNING *`,
    [
      randomUUID(), tid, u, String(store || '').trim(), bm, et, amt,
      points != null ? Number(points) : null,
      title || null, reason || null, approvalId || null, sourceRef || null,
      JSON.stringify(meta || {}), createdBy || null
    ]
  );
  return { ok: true, row: r.rows?.[0] };
}

export async function listPayrollLedgerForMonth({
  tenantId = 'default',
  month,
  store,
  username,
  db = getPool()
} = {}) {
  const tid = String(tenantId || 'default').trim() || 'default';
  const m = safeBizMonth(month);
  if (!m) return [];
  const args = [tid, m];
  let sql = `SELECT * FROM hrms_payroll_ledger WHERE tenant_id = $1 AND biz_month = $2`;
  if (store) {
    args.push(String(store).trim());
    sql += ` AND TRIM(store) = TRIM($${args.length})`;
  }
  if (username) {
    args.push(String(username).trim());
    sql += ` AND LOWER(username) = LOWER($${args.length})`;
  }
  sql += ` ORDER BY username, entry_type, created_at`;
  const r = await db.query(sql, args);
  return r.rows || [];
}

export async function getOrCreateMonthRun({
  tenantId = 'default',
  store = '',
  month,
  db = getPool()
} = {}) {
  await ensurePayrollRulesTables(db);
  const tid = String(tenantId || 'default').trim() || 'default';
  const m = safeBizMonth(month);
  const st = String(store || '').trim();
  if (!m) return null;
  await db.query(
    `INSERT INTO hrms_payroll_month_runs (id, tenant_id, store, biz_month, status)
     VALUES ($1,$2,$3,$4,'open')
     ON CONFLICT (tenant_id, store, biz_month) DO NOTHING`,
    [randomUUID(), tid, st, m]
  );
  const r = await db.query(
    `SELECT * FROM hrms_payroll_month_runs WHERE tenant_id = $1 AND store = $2 AND biz_month = $3`,
    [tid, st, m]
  );
  return r.rows?.[0] || null;
}

export async function setMonthRunStatus({
  tenantId = 'default',
  store = '',
  month,
  status,
  by,
  snapshot,
  db = getPool()
} = {}) {
  const allowed = ['open', 'attendance_locked', 'payroll_locked', 'paid'];
  const stStatus = String(status || '').trim();
  if (!allowed.includes(stStatus)) return { ok: false, error: 'invalid_status' };
  await getOrCreateMonthRun({ tenantId, store, month, db });
  const tid = String(tenantId || 'default').trim() || 'default';
  const m = safeBizMonth(month);
  const st = String(store || '').trim();
  const who = String(by || '').trim() || null;
  const patches = { status: stStatus, updated_at: new Date() };
  let sql = `UPDATE hrms_payroll_month_runs SET status = $4, updated_at = NOW()`;
  const args = [tid, st, m, stStatus];
  if (stStatus === 'attendance_locked') {
    sql += `, attendance_locked_at = NOW(), attendance_locked_by = $5`;
    args.push(who);
  } else if (stStatus === 'payroll_locked') {
    sql += `, payroll_locked_at = NOW(), payroll_locked_by = $5`;
    args.push(who);
  } else if (stStatus === 'paid') {
    sql += `, paid_at = NOW(), paid_by = $5`;
    args.push(who);
  } else if (stStatus === 'open') {
    sql += `, attendance_locked_at = NULL, attendance_locked_by = NULL, payroll_locked_at = NULL, payroll_locked_by = NULL, paid_at = NULL, paid_by = NULL`;
  }
  if (snapshot != null) {
    args.push(JSON.stringify(snapshot));
    sql += `, snapshot = $${args.length}::jsonb`;
  }
  sql += ` WHERE tenant_id = $1 AND store = $2 AND biz_month = $3 RETURNING *`;
  const r = await db.query(sql, args);
  return { ok: true, row: r.rows?.[0], patches };
}

/**
 * 计算单人单月薪资行
 * @param leaveBalanceRemaining 剩余假（正=公司欠员工；负=员工欠公司）
 */
export function computePayrollLine({
  rules,
  month,
  monthlySalary,
  attendanceSummary,
  leaveRemaining,
  ledgerItems,
  joinDate,
  resignDate
}) {
  const denom = workDaysPerMonthFromRules(month, rules);
  const dailyRate = monthlySalary != null && Number.isFinite(Number(monthlySalary))
    ? Number(monthlySalary) / denom
    : null;

  const workDays = Number(attendanceSummary?.workDays || 0);
  const mid = isMidMonthEmployment({ month, joinDate, resignDate });
  let payableAttendanceDays;
  let baseAmount;
  let prorationMode = 'attendance';

  if (mid && String(rules.midMonthProration || '') === 'active_calendar_days') {
    const calDays = countActiveCalendarDaysInMonth({ month, joinDate, resignDate });
    payableAttendanceDays = calDays;
    prorationMode = 'active_calendar_days';
    baseAmount = dailyRate != null ? Number((dailyRate * calDays).toFixed(2)) : null;
  } else {
    const missing = Math.max(0, Number((denom - workDays).toFixed(2)));
    let remaining = Number(leaveRemaining);
    if (!Number.isFinite(remaining)) remaining = 0;

    // 倒欠公司假期 → 仍算全勤
    if (rules.oweLeaveStillFullAttendance !== false && remaining < 0) {
      payableAttendanceDays = denom;
    } else if (rules.offsetMissingWithRemainingLeave !== false) {
      const leaveOffset = Math.min(missing, Math.max(0, remaining));
      payableAttendanceDays = Number(Math.min(denom, workDays + leaveOffset).toFixed(2));
    } else {
      payableAttendanceDays = Number(Math.min(denom, workDays).toFixed(2));
    }
    baseAmount = dailyRate != null ? Number((dailyRate * payableAttendanceDays).toFixed(2)) : null;
  }

  const items = Array.isArray(ledgerItems) ? ledgerItems : [];
  let pointsAmt = 0;
  let rewardAmt = 0;
  let punishAmt = 0;
  let manualSubsidy = 0;
  let otherAmt = 0;
  for (const it of items) {
    const t = String(it.entry_type || it.entryType || '').toLowerCase();
    const a = Number(it.amount) || 0;
    if (t === 'points') pointsAmt += a;
    else if (t === 'reward') rewardAmt += a;
    else if (t === 'punishment') punishAmt += a;
    else if (t === 'manual_subsidy') manualSubsidy += a;
    else otherAmt += a;
  }

  // 人工补贴与积分相加（规则默认）
  const subsidy = rules.manualSubsidyAddsWithPoints !== false
    ? Number((pointsAmt + manualSubsidy).toFixed(2))
    : Number(Math.max(pointsAmt, manualSubsidy).toFixed(2));

  const rewardPunishmentAdj = Number((rewardAmt + punishAmt).toFixed(2));
  const amount = baseAmount != null
    ? Number((baseAmount + rewardPunishmentAdj + subsidy + otherAmt).toFixed(2))
    : Number((rewardPunishmentAdj + subsidy + otherAmt).toFixed(2));

  return {
    monthlySalary: monthlySalary != null ? Number(monthlySalary) : null,
    dailyRate: dailyRate != null ? Number(dailyRate.toFixed(4)) : null,
    workDaysPerMonth: denom,
    attendanceDays: workDays,
    payableAttendanceDays,
    prorationMode,
    leaveRemaining: Number.isFinite(Number(leaveRemaining)) ? Number(leaveRemaining) : null,
    baseAmount,
    pointsAmount: Number(pointsAmt.toFixed(2)),
    manualSubsidy: Number(manualSubsidy.toFixed(2)),
    subsidy,
    rewardPunishmentAdj,
    ledgerItems: items,
    amount
  };
}

/**
 * 构建整月薪资（可先 reconcile 日结果）
 */
export async function buildPayrollForMonth({
  tenantId = 'default',
  month,
  store,
  people,
  leaveBalanceByUser,
  getSharedState,
  findUserSalary,
  state,
  reconcile = true,
  db = getPool()
} = {}) {
  await ensurePayrollRulesTables(db);
  const tid = String(tenantId || 'default').trim() || 'default';
  const m = safeBizMonth(month);
  if (!m) return { ok: false, error: 'missing_month' };
  const st = String(store || '').trim();
  const { start, end } = monthDateRange(m);

  const { rules, resolvedFrom } = await resolveAttendancePayrollRules({
    tenantId: tid,
    store: st || (people?.[0]?.store || ''),
    db
  });

  if (reconcile) {
    const storesToReconcile = new Set();
    if (st) storesToReconcile.add(st);
    else {
      for (const p of people || []) {
        const ps = String(p?.store || '').trim();
        if (ps) storesToReconcile.add(ps);
      }
    }
    for (const storeName of storesToReconcile) {
      try {
        await reconcileAttendanceDays({
          tenantId: tid,
          store: storeName,
          startDate: start,
          endDate: end,
          db,
          getSharedState
        });
      } catch (e) {
        console.warn('[payroll] reconcile attendance_day failed:', storeName, e?.message);
      }
    }
  }

  const ledgerAll = await listPayrollLedgerForMonth({ tenantId: tid, month: m, store: st || undefined, db });
  const ledgerByUser = new Map();
  for (const row of ledgerAll) {
    const k = String(row.username || '').trim().toLowerCase();
    if (!ledgerByUser.has(k)) ledgerByUser.set(k, []);
    ledgerByUser.get(k).push(row);
  }

  const monthRun = await getOrCreateMonthRun({ tenantId: tid, store: st, month: m, db });
  const rows = [];

  for (const p of people || []) {
    const uname = String(p.username || '').trim();
    if (!uname) continue;
    const ulower = uname.toLowerCase();
    const att = await summarizeAttendanceDaysForMonth({ tenantId: tid, username: uname, month: m, db });
    const salInfo = await getSalaryForMonth({
      tenantId: tid,
      username: uname,
      month: m,
      fallbackSalary: typeof findUserSalary === 'function' ? findUserSalary(state || {}, uname) : p.salary,
      db
    });
    const leaveRem = leaveBalanceByUser?.get?.(ulower) ?? leaveBalanceByUser?.[ulower] ?? p.leaveRemaining ?? 0;
    const line = computePayrollLine({
      rules,
      month: m,
      monthlySalary: salInfo.amount,
      attendanceSummary: att || { workDays: 0 },
      leaveRemaining: leaveRem,
      ledgerItems: ledgerByUser.get(ulower) || [],
      joinDate: p.joinDate || p.join_date,
      resignDate: p.offboardingDate || p.resignedAt || p.resignDate
    });
    rows.push({
      store: String(p.store || st || '').trim(),
      username: uname,
      name: String(p.name || uname).trim(),
      salarySource: salInfo.source,
      salaryEffectiveFrom: salInfo.effectiveFrom,
      attendanceSummary: att,
      ...line
    });
  }

  rows.sort((a, b) =>
    String(a.store).localeCompare(String(b.store), 'zh-Hans-CN') ||
    String(a.name).localeCompare(String(b.name), 'zh-Hans-CN')
  );

  const totalAmount = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  return {
    ok: true,
    month: m,
    store: st,
    workDaysPerMonth: workDaysPerMonthFromRules(m, rules),
    monthDays: daysInMonth(m),
    rules,
    resolvedFrom,
    monthRun,
    rows,
    totalAmount
  };
}
