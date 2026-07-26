/**
 * Payroll report — closed-loop engine path (rules + ledger + base timeline).
 */
import { isEmployeeDepartedForPayroll } from './helpers.js';
import { childLogger } from '../../utils/logger.js';

const log = childLogger({ domain: 'reports', handler: 'payroll-closed-loop' });

export async function tryClosedLoopPayrollPayload(ctx, {
  month,
  store,
  state0,
  peopleByLower,
  people,
  tenantId,
}) {
  const {
    pool,
    getSharedState,
    calcEmployeeMonthlyLeaveBalance,
    findUserSalary,
    buildPayrollForMonth,
    clampNum,
  } = ctx;

  if (typeof buildPayrollForMonth !== 'function') return null;

  try {
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

    if (!computed?.ok) return null;

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
  } catch (engineErr) {
    log.warn({ msg: 'payroll_closed_loop_engine_failed', err: engineErr?.message || String(engineErr) });
    return null;
  }
}
