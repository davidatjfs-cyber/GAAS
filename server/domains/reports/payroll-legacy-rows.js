/**
 * Payroll report — legacy fallback: sumMap entries → payable rows + payload.
 */
import { isEmployeeDepartedForPayroll } from './helpers.js';
import {
  buildLegacyPointMaps,
  loadLegacyAttendanceRows,
  buildLegacyPayrollSumMap,
} from './payroll-legacy-build.js';

export function mapLegacyPayrollRows(ctx, {
  state0,
  month,
  sumMap,
  adjustmentMap,
  payrollAdjMap,
  pointStoreByUser,
  pointSubsidyByUserStore,
  peopleByLower,
  workDaysPerMonth,
}) {
  const { findUserSalary, calcEmployeeMonthlyLeaveBalance, clampNum, safeNumber, stateFindUserRecord } = ctx;

  const rows = Array.from(sumMap.values()).map((x) => {
    const monthlySalary = findUserSalary(state0, x.username);
    const dailyRate = monthlySalary != null ? (monthlySalary / workDaysPerMonth) : null;
    const person = peopleByLower.get(String(x.username || '').trim().toLowerCase()) || null;
    const leaveBalance = person ? calcEmployeeMonthlyLeaveBalance(state0, person, month) : null;
    const attendanceDays = clampNum(x.days, 0);
    const missingAttendanceDays = Number(Math.max(0, Number((workDaysPerMonth - attendanceDays).toFixed(2))));
    const remainingLeaveBeforeOffset = leaveBalance ? Number(leaveBalance.remaining || 0) : 0;
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
    const manualBaseByStore = safeNumber(payrollAdjByStore?.baseAmount);
    const manualBaseAllStore = safeNumber(payrollAdjAllStore?.baseAmount);
    const baseAmount = manualBaseByStore != null
      ? manualBaseByStore
      : (manualBaseAllStore != null ? manualBaseAllStore : computedBaseAmount);
    const subsidyByStore = safeNumber(payrollAdjMap?.[adjKey]?.subsidy ?? payrollAdjMap?.[adjKey]?.amount) || 0;
    const subsidyAllStore = effectiveStore
      ? (safeNumber(payrollAdjMap?.[`${month}||ALL||${rowUser}`]?.subsidy ?? payrollAdjMap?.[`${month}||ALL||${rowUser}`]?.amount) || 0)
      : 0;
    const subsidyFromPayrollAdjustments = subsidyByStore + subsidyAllStore;
    const pointSubsidyByStore2 = safeNumber(pointSubsidyByUserStore.get(`${effectiveStore || 'ALL'}||${rowUser}`)) || 0;
    const pointSubsidyAllStore2 = effectiveStore ? (safeNumber(pointSubsidyByUserStore.get(`ALL||${rowUser}`)) || 0) : 0;
    const subsidyFromPointRecords = pointSubsidyByStore2 + pointSubsidyAllStore2;
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

  const rowsActive = rows.filter((r) => {
    const lower = String(r?.username || '').trim().toLowerCase();
    const emp = peopleByLower.get(lower) || stateFindUserRecord(state0, r?.username) || null;
    return !isEmployeeDepartedForPayroll(emp, month, r?.attendanceDays);
  });
  rows.length = 0;
  rows.push(...rowsActive);

  rows.sort((a, b) => String(a.store).localeCompare(String(b.store), 'zh-Hans-CN') || String(a.name || a.username).localeCompare(String(b.name || b.username), 'zh-Hans-CN'));
  return rows;
}

export async function buildLegacyPayrollPayload(ctx, {
  month,
  store,
  state0,
  peopleByLower,
  allPeople,
  knownUsers,
  canonicalUsernameByLower,
  tenantId,
}) {
  const { clampNum, safeNumber } = ctx;
  const { pointStoreByUser, pointSubsidyByUserStore } = buildLegacyPointMaps(state0, month, safeNumber);
  const attendanceRows = await loadLegacyAttendanceRows(ctx, {
    state0,
    month,
    store,
    tenantId,
    peopleByLower,
    knownUsers,
  });

  const [yearNum, monthNum] = month.split('-').map(Number);
  const monthDays = new Date(yearNum, monthNum, 0).getDate();
  const workDaysPerMonth = Math.max(1, monthDays - 4);

  const { sumMap, adjustmentMap, payrollAdjMap } = await buildLegacyPayrollSumMap(ctx, {
    state0,
    month,
    store,
    tenantId,
    peopleByLower,
    allPeople,
    knownUsers,
    canonicalUsernameByLower,
    attendanceRows,
    pointStoreByUser,
    pointSubsidyByUserStore,
  });

  const rows = mapLegacyPayrollRows(ctx, {
    state0,
    month,
    sumMap,
    adjustmentMap,
    payrollAdjMap,
    pointStoreByUser,
    pointSubsidyByUserStore,
    peopleByLower,
    workDaysPerMonth,
  });

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
}
