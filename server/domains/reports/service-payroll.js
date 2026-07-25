/**
 * Payroll report / audit / adjustment — pure logic (no req/res).
 */
import { childLogger } from '../../utils/logger.js';
import { isEmployeeDepartedForPayroll } from './helpers.js';

const log = childLogger({ domain: 'reports', handler: 'payroll' });

/**
 * @param {object} ctx
 * @param {object} opts
 * @returns {Promise<{ ok: true, payload: object } | { ok: false, status: number, error: string, message?: string }>}
 */
export async function getPayrollReportPayload(ctx, {
  month,
  storeQ,
  role,
  username,
  tenantId,
  allowedStores,
  currentStore,
}) {
  const {
    pool,
    getSharedState,
    pickMyStoreFromState,
    stateFindUserRecord,
    dbListEmployeesForReports,
    calcEmployeeMonthlyLeaveBalance,
    buildAttendanceFromCheckinRecords,
    buildAttendanceFromReports,
    isLegacyTestUsername,
    inDateRange,
    clampNum,
    safeNumber,
    findUserSalary,
    buildPayrollForMonth,
  } = ctx;

  if (!month) return { ok: false, status: 400, error: 'missing_month' };

  try {
    const state0 = (await getSharedState()) || {};
    const myStore = pickMyStoreFromState(state0, username);
    const allowed = Array.isArray(allowedStores) ? allowedStores : [];
    const curStore = String(currentStore || '').trim();
    const store = role === 'store_manager'
      ? (storeQ && allowed.includes(storeQ) ? storeQ : (curStore || myStore))
      : storeQ;

    // ── 新闭环引擎（规则+日结果+账本+底薪时间线）──
    if (typeof buildPayrollForMonth === 'function') {
      try {
        const employeesList = Array.isArray(state0?.employees) ? state0.employees : [];
        const usersList = Array.isArray(state0?.users) ? state0.users : [];
        const peopleByLower = new Map();
        employeesList.forEach((p) => {
          const uRaw = String(p?.username || '').trim();
          const u = uRaw.toLowerCase();
          if (!u || isLegacyTestUsername(u)) return;
          if (!peopleByLower.has(u)) peopleByLower.set(u, { ...p, username: uRaw });
        });
        usersList.forEach((p) => {
          const uRaw = String(p?.username || '').trim();
          const u = uRaw.toLowerCase();
          if (!u || isLegacyTestUsername(u)) return;
          if (!peopleByLower.has(u)) peopleByLower.set(u, { ...p, username: uRaw });
        });
        if (!peopleByLower.size) {
          const dbEmps = await dbListEmployeesForReports({
            store,
            includeInactive: false,
            tenantId: tenantId || 'default',
          });
          for (const p of dbEmps) {
            const uRaw = String(p?.username || '').trim();
            const u = uRaw.toLowerCase();
            if (!u || isLegacyTestUsername(u)) continue;
            if (!peopleByLower.has(u)) peopleByLower.set(u, { ...p, username: uRaw });
          }
        }
        let people = Array.from(peopleByLower.values());
        if (store) people = people.filter((p) => String(p?.store || '').trim() === store);

        const leaveBalanceByUser = new Map();
        let summarizeAttMonthPay = ctx.summarizeAttendanceDaysForMonth || null;
        if (typeof summarizeAttMonthPay !== 'function') {
          try {
            const mod = await import('../../services/hrms-attendance-day.js');
            summarizeAttMonthPay = mod.summarizeAttendanceDaysForMonth;
          } catch (_) { /* ignore */ }
        }
        for (const p of people) {
          let attendanceRestDays = null;
          if (typeof summarizeAttMonthPay === 'function') {
            try {
              const att = await summarizeAttMonthPay({
                tenantId: tenantId || 'default',
                username: p.username,
                month,
                db: typeof pool === 'function' ? pool() : pool,
              });
              if (att && Number.isFinite(Number(att.restDays))) attendanceRestDays = Number(att.restDays);
            } catch (_) { /* ignore */ }
          }
          const bal = calcEmployeeMonthlyLeaveBalance(state0, p, month, { attendanceRestDays });
          leaveBalanceByUser.set(String(p.username || '').trim().toLowerCase(), Number(bal?.remaining || 0));
        }

        const computed = await buildPayrollForMonth({
          tenantId: tenantId || 'default',
          month,
          store,
          people,
          leaveBalanceByUser,
          getSharedState,
          findUserSalary,
          state: state0,
          reconcile: true,
        });

        if (computed?.ok) {
          const auditKey = `${month}||${store || 'ALL'}`;
          const auditMap = state0?.payrollAudits && typeof state0.payrollAudits === 'object' ? state0.payrollAudits : {};
          const audit = auditMap[auditKey] || null;
          const rows = (computed.rows || []).map((r) => ({
            store: r.store,
            username: r.username,
            name: r.name,
            attendanceDays: r.attendanceDays,
            payableAttendanceDays: r.payableAttendanceDays,
            missingAttendanceDays: Math.max(0, Number((Number(r.workDaysPerMonth || 0) - Number(r.attendanceDays || 0)).toFixed(2))),
            leaveOffsetDays: null,
            remainingLeaveBeforeOffset: r.leaveRemaining,
            remainingLeaveAfterOffset: r.leaveRemaining,
            monthlySalary: r.monthlySalary,
            dailyRate: r.dailyRate,
            computedBaseAmount: r.baseAmount,
            baseAmount: r.baseAmount,
            baseAmountOverridden: false,
            rewardPunishmentAdj: r.rewardPunishmentAdj,
            subsidy: r.subsidy,
            pointsAmount: r.pointsAmount,
            manualSubsidy: r.manualSubsidy,
            amount: r.amount,
            prorationMode: r.prorationMode,
            salarySource: r.salarySource,
            ledgerItems: r.ledgerItems,
            attendanceSummary: r.attendanceSummary,
          })).filter((r) => {
            const emp = peopleByLower.get(String(r.username || '').toLowerCase()) || null;
            return !isEmployeeDepartedForPayroll(emp, month, r.attendanceDays);
          });

          return {
            ok: true,
            payload: {
              month,
              store: store || '',
              monthDays: computed.monthDays,
              workDaysPerMonth: computed.workDaysPerMonth,
              audit,
              rows,
              totalAmount: rows.reduce((s, x) => s + clampNum(x.amount, 0), 0),
              engine: 'closed_loop_v1',
              rules: computed.rules,
              monthRun: computed.monthRun,
              resolvedFrom: computed.resolvedFrom,
            },
          };
        }
      } catch (engineErr) {
        log.warn({ msg: 'payroll_closed_loop_engine_failed', err: engineErr?.message || String(engineErr) });
      }
    }

    const start = `${month}-01`;
    const [yr, mo] = month.split('-').map(Number);
    const end = `${month}-${String(new Date(yr, mo, 0).getDate()).padStart(2, '0')}`;
    const pointStoreByUser = new Map();
    const pointSubsidyByUserStore = new Map();
    const pointRecords = Array.isArray(state0?.pointRecords) ? state0.pointRecords : [];
    pointRecords.forEach((r) => {
      const recMonth = String(r?.approvedAt || r?.createdAt || '').slice(0, 7);
      if (recMonth !== month) return;
      const u = String(r?.username || '').trim().toLowerCase();
      const st = String(r?.store || '').trim();
      if (!u) return;
      if (st && !pointStoreByUser.has(u)) pointStoreByUser.set(u, st);
      const amountFromRecord = safeNumber(r?.amount);
      const points = safeNumber(r?.points) || 0;
      const subsidyAmount = amountFromRecord != null ? amountFromRecord : Number((points * 0.5).toFixed(2));
      if (!subsidyAmount) return;
      const subsidyKey = `${st || 'ALL'}||${u}`;
      const prevSubsidy = safeNumber(pointSubsidyByUserStore.get(subsidyKey)) || 0;
      pointSubsidyByUserStore.set(subsidyKey, Number((prevSubsidy + subsidyAmount).toFixed(2)));
    });
    const knownUsers = new Set();
    const peopleByLower = new Map();
    const employeesList = Array.isArray(state0?.employees) ? state0.employees : [];
    const usersList = Array.isArray(state0?.users) ? state0.users : [];
    // employees first: treat employee records as authoritative when duplicates exist
    employeesList.forEach((p) => {
      const uRaw = String(p?.username || '').trim();
      const u = uRaw.toLowerCase();
      if (!u || isLegacyTestUsername(u)) return;
      if (!peopleByLower.has(u)) peopleByLower.set(u, { ...p, username: uRaw });
    });
    usersList.forEach((p) => {
      const uRaw = String(p?.username || '').trim();
      const u = uRaw.toLowerCase();
      if (!u || isLegacyTestUsername(u)) return;
      if (!peopleByLower.has(u)) peopleByLower.set(u, { ...p, username: uRaw });
    });
    // If hrms_state snapshot is empty (common on some installs), fall back to employees table
    // so payroll/attendance-related reports don't silently drop everyone.
    if (!peopleByLower.size) {
      const dbEmps = await dbListEmployeesForReports({
        store,
        includeInactive: false,
        tenantId: tenantId || 'default',
      });
      for (const p of dbEmps) {
        const uRaw = String(p?.username || '').trim();
        const u = uRaw.toLowerCase();
        if (!u || isLegacyTestUsername(u)) continue;
        if (!peopleByLower.has(u)) peopleByLower.set(u, { ...p, username: uRaw });
      }
    }
    const allPeople = Array.from(peopleByLower.values());
    const canonicalUsernameByLower = new Map();
    peopleByLower.forEach((p, u) => {
      knownUsers.add(u);
      canonicalUsernameByLower.set(u, String(p?.username || u).trim() || u);
    });
    let attendanceRows = [];
    try {
      let conditions = [`check_time >= $1::date`, `check_time < ($2::date + interval '1 day')`];
      let params = [start, end];
      let idx = 3;
      if (store) {
        conditions.push(`store = $${idx}`);
        params.push(store);
        idx++;
      }
      params.push(tenantId || 'default');
      conditions.push(`tenant_id = $${idx}`);
      const where = 'where ' + conditions.join(' and ');
      const checkinSql = `select username, store, check_time, status from checkin_records ${where} order by check_time desc`;
      const db = typeof pool === 'function' ? pool() : pool;
      const checkinRows = await db.query(checkinSql, params);
      const displayNameByLower = new Map();
      peopleByLower.forEach((p, lower) => {
        displayNameByLower.set(lower, String(p?.name || p?.username || '').trim());
      });
      const normalizedCheckins = (checkinRows.rows || []).map((r) => ({
        ...r,
        display_name: displayNameByLower.get(String(r?.username || '').trim().toLowerCase()) || String(r?.username || '').trim(),
      }));
      attendanceRows = buildAttendanceFromCheckinRecords(normalizedCheckins, { start, end, knownUsers });
    } catch (e) {
      log.warn({ msg: 'payroll_checkin_attendance_fallback', err: e?.message || String(e) });
      let items = Array.isArray(state0.dailyReports) ? state0.dailyReports.slice() : [];
      items = items.filter((r) => inDateRange(String(r?.date || '').trim(), start, end));
      if (store) items = items.filter((r) => String(r?.store || '').trim() === store);
      attendanceRows = buildAttendanceFromReports(items);
    }
    const [yearNum, monthNum] = month.split('-').map(Number);
    const monthDays = new Date(yearNum, monthNum, 0).getDate();
    // Business rule: daily rate uses salary / (days in month - 4 fixed weekly offs)
    const workDaysPerMonth = Math.max(1, monthDays - 4);

    const payrollRowKey = (st, userLower) => `${String(st || '').trim()}||${String(userLower || '').trim()}`;

    const sumMap = new Map();
    for (const r of attendanceRows) {
      const st = String(r?.store || '').trim();
      const uRaw = String(r?.username || '').trim();
      const u = uRaw.toLowerCase();
      if (!st || !u) continue;
      if (!knownUsers.has(u)) continue;
      const canonicalUser = canonicalUsernameByLower.get(u) || uRaw;
      const key = payrollRowKey(st, u);
      const prev = sumMap.get(key) || { store: st, username: canonicalUser, name: String(r?.name || '').trim(), days: 0 };
      prev.days += clampNum(r?.days, 0);
      if (!prev.name) prev.name = String(r?.name || '').trim();
      sumMap.set(key, prev);
    }

    // 奖惩归属月份以「审批单的生效/创建月」为准，而非 salaryAdjustment 记录的 createdAt
    // （再次终审会把记录 createdAt 重写成当时时间，导致跨月奖惩被错并到同一月 → 金额翻倍）。
    const approvalMonthById = new Map();
    try {
      const db = typeof pool === 'function' ? pool() : pool;
      const arRows = await db.query(
        `SELECT id::text AS id, to_char(COALESCE(effective_date, created_at::date), 'YYYY-MM') AS ym
           FROM approval_requests WHERE type = 'reward_punishment' AND tenant_id = $1`,
        [tenantId || 'default']
      );
      for (const r of (arRows.rows || [])) approvalMonthById.set(String(r.id), String(r.ym || ''));
    } catch (e) {
      log.warn({ msg: 'payroll_load_approval_months_failed', err: e?.message || String(e) });
    }

    const adjustmentMap = new Map();
    const adjRows = Array.isArray(state0?.salaryAdjustments) ? state0.salaryAdjustments : [];
    for (const a of adjRows) {
      if (!a || typeof a !== 'object') continue;
      const st = String(a?.status || '').trim().toLowerCase();
      if (st && st !== 'approved') continue;
      const target = String(a?.targetUsername || '').trim();
      if (!target) continue;
      if (isLegacyTestUsername(target)) continue;
      const apprId = String(a?.approvalId || '').trim();
      const ym = (apprId && approvalMonthById.get(apprId)) || String(a?.createdAt || a?.effectiveAt || '').slice(0, 7);
      if (ym !== month) continue;
      let signed = safeNumber(a?.signedAmount);
      if (signed == null) {
        const raw = Math.abs(safeNumber(a?.amount) || 0);
        const tp = String(a?.type || a?.rpType || '').trim().toLowerCase();
        const isPunish = tp.includes('惩罚') || tp.includes('punish');
        signed = isPunish ? -raw : raw;
      }
      const key = target.toLowerCase();
      adjustmentMap.set(key, (adjustmentMap.get(key) || 0) + (signed || 0));

      // Ensure people with salary adjustments still appear in payroll rows even with zero attendance
      const rec = stateFindUserRecord(state0, target) || {};
      const recStore = String(rec?.store || '').trim();
      const canonicalTarget = canonicalUsernameByLower.get(key) || target;
      if (!store || recStore === store) {
        const attKey = payrollRowKey(recStore, key);
        if (!sumMap.has(attKey)) {
          sumMap.set(attKey, {
            store: recStore,
            username: canonicalTarget,
            name: String(rec?.name || canonicalTarget).trim(),
            days: 0,
          });
        }
      }
    }

    const payrollAdjMap = state0?.payrollAdjustments && typeof state0.payrollAdjustments === 'object' ? state0.payrollAdjustments : {};

    // Ensure people with points/manual subsidy still appear even when attendance is 0
    Object.entries(payrollAdjMap).forEach(([k, v]) => {
      const key = String(k || '').trim();
      const m = key.match(/^(\d{4}-\d{2})\|\|(.+)\|\|(.+)$/);
      if (!m) return;
      const keyMonth = String(m[1] || '').trim();
      const keyStore = String(m[2] || '').trim();
      const keyUser = String(m[3] || '').trim();
      const keyUserLower = keyUser.toLowerCase();
      if (keyMonth !== month || !keyUser) return;
      if (isLegacyTestUsername(keyUser)) return;
      const subsidy = safeNumber(v?.subsidy ?? v?.amount) || 0;
      if (!subsidy) return;
      const rec = stateFindUserRecord(state0, keyUser) || {};
      const recStore = String(keyStore && keyStore !== 'ALL' ? keyStore : (rec?.store || pointStoreByUser.get(keyUserLower) || '')).trim();
      if (store && recStore !== store) return;
      const canonicalUser = canonicalUsernameByLower.get(keyUserLower) || keyUser;
      const attKey = payrollRowKey(recStore, keyUserLower);
      if (!sumMap.has(attKey)) {
        sumMap.set(attKey, {
          store: recStore,
          username: canonicalUser,
          name: String(rec?.name || canonicalUser).trim(),
          days: 0,
        });
      }
    });

    // Ensure zero-attendance employees are still listed when they have salary/adjustments/points
    allPeople.forEach((p) => {
      const rowUser = String(p?.username || '').trim();
      const rowUserLower = rowUser.toLowerCase();
      if (!rowUser || !knownUsers.has(rowUserLower)) return;

      const rowStore = String(p?.store || pointStoreByUser.get(rowUserLower) || '').trim();
      if (store && rowStore !== store) return;

      const salary = findUserSalary(state0, rowUser);
      const hasSalary = salary != null;
      const hasAdjustment = adjustmentMap.has(rowUserLower);
      const pointSubsidyByStore = safeNumber(pointSubsidyByUserStore.get(`${rowStore || 'ALL'}||${rowUserLower}`)) || 0;
      const pointSubsidyAllStore = rowStore ? (safeNumber(pointSubsidyByUserStore.get(`ALL||${rowUserLower}`)) || 0) : 0;
      const hasPointSubsidy = (pointSubsidyByStore + pointSubsidyAllStore) > 0;
      if (!hasSalary && !hasAdjustment && !hasPointSubsidy) return;

      const canonicalUser = canonicalUsernameByLower.get(rowUserLower) || rowUser;
      const attKey = payrollRowKey(rowStore, rowUserLower);
      if (!sumMap.has(attKey)) {
        sumMap.set(attKey, {
          store: rowStore,
          username: canonicalUser,
          name: String(p?.name || rowUser).trim(),
          days: 0,
        });
      }
    });

    const rows = Array.from(sumMap.values()).map((x) => {
      const monthlySalary = findUserSalary(state0, x.username);
      const dailyRate = monthlySalary != null ? (monthlySalary / workDaysPerMonth) : null;
      const person = peopleByLower.get(String(x.username || '').trim().toLowerCase()) || null;
      const leaveBalance = person ? calcEmployeeMonthlyLeaveBalance(state0, person, month) : null;
      const attendanceDays = clampNum(x.days, 0);
      const missingAttendanceDays = Number(Math.max(0, Number((workDaysPerMonth - attendanceDays).toFixed(2))));
      const remainingLeaveBeforeOffset = leaveBalance ? Number(leaveBalance.remaining || 0) : 0;
      // 倒欠公司假期仍算全勤
      let leaveOffsetDays;
      let payableAttendanceDays;
      if (remainingLeaveBeforeOffset < 0) {
        leaveOffsetDays = missingAttendanceDays;
        payableAttendanceDays = workDaysPerMonth;
      } else {
        leaveOffsetDays = Number(Math.min(missingAttendanceDays, Math.max(0, remainingLeaveBeforeOffset)).toFixed(2));
        payableAttendanceDays = Number(Math.min(workDaysPerMonth, attendanceDays + leaveOffsetDays).toFixed(2));
      }
      const remainingLeaveAfterOffset = leaveBalance
        ? Number((remainingLeaveBeforeOffset - leaveOffsetDays).toFixed(2))
        : null;
      const computedBaseAmount = dailyRate != null ? (dailyRate * payableAttendanceDays) : null;
      const rewardPunishmentAdj = adjustmentMap.get(String(x.username || '').toLowerCase()) || 0;
      const rowStore = String(x.store || '').trim();
      const rowUser = String(x.username || '').trim().toLowerCase();
      const fallbackStore = String(pointStoreByUser.get(rowUser) || '').trim();
      const effectiveStore = rowStore || fallbackStore;
      const adjKey = `${month}||${effectiveStore || 'ALL'}||${rowUser}`;
      const payrollAdjByStore = payrollAdjMap?.[adjKey] && typeof payrollAdjMap[adjKey] === 'object' ? payrollAdjMap[adjKey] : {};
      const payrollAdjAllStore = effectiveStore && payrollAdjMap?.[`${month}||ALL||${rowUser}`] && typeof payrollAdjMap[`${month}||ALL||${rowUser}`] === 'object'
        ? payrollAdjMap[`${month}||ALL||${rowUser}`]
        : {};
      const subsidyByStore = safeNumber(payrollAdjMap?.[adjKey]?.subsidy ?? payrollAdjMap?.[adjKey]?.amount) || 0;
      const subsidyAllStore = effectiveStore
        ? (safeNumber(payrollAdjMap?.[`${month}||ALL||${rowUser}`]?.subsidy ?? payrollAdjMap?.[`${month}||ALL||${rowUser}`]?.amount) || 0)
        : 0;
      const manualBaseByStore = safeNumber(payrollAdjByStore?.baseAmount);
      const manualBaseAllStore = safeNumber(payrollAdjAllStore?.baseAmount);
      const baseAmount = manualBaseByStore != null
        ? manualBaseByStore
        : (manualBaseAllStore != null ? manualBaseAllStore : computedBaseAmount);
      const subsidyFromPayrollAdjustments = subsidyByStore + subsidyAllStore;
      const pointSubsidyByStore2 = safeNumber(pointSubsidyByUserStore.get(`${effectiveStore || 'ALL'}||${rowUser}`)) || 0;
      const pointSubsidyAllStore2 = effectiveStore ? (safeNumber(pointSubsidyByUserStore.get(`ALL||${rowUser}`)) || 0) : 0;
      const subsidyFromPointRecords = pointSubsidyByStore2 + pointSubsidyAllStore2;
      // 人工补贴与积分相加（不再取 max）
      const subsidy = Number((subsidyFromPayrollAdjustments + subsidyFromPointRecords).toFixed(2));
      const amount = baseAmount != null ? (baseAmount + rewardPunishmentAdj + subsidy) : ((rewardPunishmentAdj || 0) + subsidy || null);
      return {
        store: effectiveStore,
        username: x.username,
        name: x.name,
        attendanceDays,
        payableAttendanceDays,
        missingAttendanceDays,
        leaveOffsetDays,
        remainingLeaveBeforeOffset,
        remainingLeaveAfterOffset,
        monthlySalary,
        dailyRate,
        computedBaseAmount,
        baseAmount,
        baseAmountOverridden: manualBaseByStore != null || manualBaseAllStore != null,
        rewardPunishmentAdj,
        subsidy,
        amount,
      };
    });

    // 排除已离职且当月无出勤的人员（避免离职后每月仍计薪；末月有出勤者保留结算）
    const rowsActive = rows.filter((r) => {
      const lower = String(r?.username || '').trim().toLowerCase();
      const emp = peopleByLower.get(lower) || stateFindUserRecord(state0, r?.username) || null;
      return !isEmployeeDepartedForPayroll(emp, month, r?.attendanceDays);
    });
    rows.length = 0;
    rows.push(...rowsActive);

    rows.sort((a, b) => String(a.store).localeCompare(String(b.store), 'zh-Hans-CN') || String(a.name || a.username).localeCompare(String(b.name || b.username), 'zh-Hans-CN'));

    const auditKey = `${month}||${store || 'ALL'}`;
    const auditMap = state0?.payrollAudits && typeof state0.payrollAudits === 'object' ? state0.payrollAudits : {};
    const audit = auditMap[auditKey] || null;

    const totalAmount = rows.reduce((s, x) => s + clampNum(x.amount, 0), 0);
    return {
      ok: true,
      payload: {
        month,
        store: store || '',
        monthDays,
        workDaysPerMonth,
        audit,
        rows,
        totalAmount,
        engine: 'legacy_fallback',
      },
    };
  } catch (e) {
    return { ok: false, status: 500, error: 'server_error', message: 'internal_error' };
  }
}

/**
 * @returns {Promise<{ ok: true, audit: object } | { ok: false, status: number, error: string, message?: string }>}
 */
export async function auditPayrollMonth(ctx, { month, store, username, audited }) {
  const { getSharedState, mergeSharedStateFields, hrmsNowISO } = ctx;
  if (!username) return { ok: false, status: 400, error: 'missing_user' };
  if (!month) return { ok: false, status: 400, error: 'missing_month' };

  try {
    const state0 = (await getSharedState()) || {};
    const storeKey = String(store || '').trim();
    const auditKey = `${month}||${storeKey || 'ALL'}`;
    const auditMap = state0?.payrollAudits && typeof state0.payrollAudits === 'object' ? { ...state0.payrollAudits } : {};
    auditMap[auditKey] = {
      month,
      store: storeKey || '',
      audited: !!audited,
      auditedBy: username,
      auditedAt: hrmsNowISO(),
    };
    await mergeSharedStateFields({ payrollAudits: auditMap });
    return { ok: true, audit: auditMap[auditKey] };
  } catch (e) {
    return { ok: false, status: 500, error: 'server_error', message: 'internal_error' };
  }
}

/**
 * @returns {Promise<{ ok: true, item: object } | { ok: false, status: number, error: string, message?: string }>}
 */
export async function adjustPayrollRow(ctx, {
  month,
  store,
  targetUsername,
  subsidy,
  baseAmount,
  reason,
  username,
  tenantId,
}) {
  const { getSharedState, mergeSharedStateFields, hrmsNowISO, safeNumber } = ctx;
  if (!username) return { ok: false, status: 400, error: 'missing_user' };
  if (!month) return { ok: false, status: 400, error: 'missing_month' };
  const target = String(targetUsername || '').trim();
  if (!target) return { ok: false, status: 400, error: 'missing_username' };

  const subsidyNum = safeNumber(subsidy);
  const baseAmountNum = safeNumber(baseAmount);
  if (subsidyNum == null && baseAmountNum == null) {
    return { ok: false, status: 400, error: 'missing_adjustment' };
  }

  try {
    const state0 = (await getSharedState()) || {};
    const storeKey = String(store || '').trim();
    const key = `${month}||${storeKey || 'ALL'}||${target.toLowerCase()}`;
    const existing = state0?.payrollAdjustments?.[key] && typeof state0.payrollAdjustments[key] === 'object'
      ? state0.payrollAdjustments[key]
      : {};
    const item = {
      ...existing,
      month,
      store: storeKey || '',
      username: target,
      ...(subsidyNum != null ? { subsidy: subsidyNum } : {}),
      ...(baseAmountNum != null ? { baseAmount: baseAmountNum } : {}),
      updatedBy: username,
      updatedAt: hrmsNowISO(),
    };
    // 原子合并，避免整包 saveSharedState 覆盖由积分审批写入的 pointRecords/payrollAdjustments
    await mergeSharedStateFields({ payrollAdjustments: { [key]: item } });
    // 同步写入薪资账本（人工补贴与积分相加）
    if (subsidyNum != null) {
      try {
        const upsert = ctx.upsertPayrollLedgerEntry
          || (await import('../../services/hrms-payroll-engine.js')).upsertPayrollLedgerEntry;
        await upsert({
          tenantId: tenantId || 'default',
          username: target,
          store: storeKey,
          bizMonth: month,
          entryType: 'manual_subsidy',
          amount: subsidyNum,
          title: '人工补贴',
          reason: String(reason || '').trim() || '高温/调店等临时费用',
          sourceRef: key,
          createdBy: username,
        });
      } catch (e) {
        log.warn({ msg: 'payroll_adjustment_ledger_write_failed', err: e?.message || String(e) });
      }
    }
    return { ok: true, item };
  } catch (e) {
    return { ok: false, status: 500, error: 'server_error', message: 'internal_error' };
  }
}
