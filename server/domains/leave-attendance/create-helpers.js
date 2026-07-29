import { createDateMathHelpers } from './date-math.js';
import { createDailyReportRestHelpers } from './daily-report-rest.js';
import {
  hrmsClockMinutesInShanghai,
  hrmsDateKeyInShanghai,
  hrmsAttendanceWindowMinutesForStore,
} from './clock-window.js';
import { createAttendanceBuildHelpers } from './attendance-build.js';
import { createPenaltiesHelpers, ATTENDANCE_PENALTY_START_DATE } from './penalties.js';
import { createLeaveBalanceHelpers } from './leave-balance.js';
import { createCloseSnapshotHelpers } from './close-snapshot.js';

export function createLeaveAttendanceHelpers({
  pool,
  getSharedState,
  resolveTenantIdDefault,
  invalidateSharedStateCache,
  safeDateOnly,
  safeMonthOnly,
  isLegacyTestUsername,
  clampNum,
  hrmsNowISO,
}) {
  const {
    calcDateSpanDaysInclusive,
    calcOverlapDaysWithinMonth,
    calcCumulativeLeaveDaysByJoinDate,
    shiftMonth,
    leaveBalanceOverrideKey,
    getLeaveBalanceOverride,
  } = createDateMathHelpers({ safeDateOnly, safeMonthOnly });

  const {
    dailyReportRestStaffForLeaveCalc,
    dailyReportHasRestForEmployee,
    dailyReportRestDaysForEmployee,
    calcEmployeeMonthlyActualRestFromDailyReports,
  } = createDailyReportRestHelpers({ safeMonthOnly });

  const {
    buildAttendanceFromReports,
    isCountableCheckinStatus,
    shanghaiDateOnly,
    buildAttendanceFromCheckinRecords,
    normalizeAttendanceRegisterLineDetails,
    sortIsoDateList,
    buildAttendanceSummaryRows,
  } = createAttendanceBuildHelpers({ clampNum, safeDateOnly, isLegacyTestUsername });

  const {
    computeAttendanceMissingClockPenalties,
  } = createPenaltiesHelpers({ pool, safeMonthOnly });

  // leave-balance.calcEmployeeMonthlyLeaveBalance → getLockedOpeningCarryForMonth
  // close-snapshot.getLockedOpeningCarryForMonth → calcEmployeeMonthlyCarryover
  // 用惰性转发打破环，避免两模块互相 import
  const lockedCarryRef = { fn: null };

  const {
    resolveEmployeeLeaveCalcStartMonth,
    calcEmployeeMonthlyApprovedLeaveDays,
    calcEmployeeMonthlyCarryover,
    calcEmployeeMonthlyLeaveBalance,
  } = createLeaveBalanceHelpers({
    safeMonthOnly,
    hrmsNowISO,
    shiftMonth,
    leaveBalanceOverrideKey,
    getLeaveBalanceOverride,
    calcOverlapDaysWithinMonth,
    dailyReportHasRestForEmployee,
    calcEmployeeMonthlyActualRestFromDailyReports,
    getLockedOpeningCarryForMonth: (state, employee, monthM) => lockedCarryRef.fn(state, employee, monthM),
  });

  const {
    getLeaveCumulativeCloseSnapshot,
    getLockedOpeningCarryForMonth,
    runLeaveCumulativeCloseSnapshotForClosedMonth,
  } = createCloseSnapshotHelpers({
    safeMonthOnly,
    shiftMonth,
    leaveBalanceOverrideKey,
    getLeaveBalanceOverride,
    calcEmployeeMonthlyCarryover,
    getSharedState,
    pool,
    resolveTenantIdDefault,
    invalidateSharedStateCache,
    isLegacyTestUsername,
    hrmsNowISO,
  });

  lockedCarryRef.fn = getLockedOpeningCarryForMonth;

  return {
    // attendance-build
    buildAttendanceFromReports,
    isCountableCheckinStatus,
    shanghaiDateOnly,
    buildAttendanceFromCheckinRecords,
    normalizeAttendanceRegisterLineDetails,
    sortIsoDateList,
    buildAttendanceSummaryRows,

    // date-math
    calcDateSpanDaysInclusive,
    calcOverlapDaysWithinMonth,
    calcCumulativeLeaveDaysByJoinDate,
    shiftMonth,
    leaveBalanceOverrideKey,
    getLeaveBalanceOverride,

    // daily-report-rest
    dailyReportRestStaffForLeaveCalc,
    dailyReportHasRestForEmployee,
    dailyReportRestDaysForEmployee,
    calcEmployeeMonthlyActualRestFromDailyReports,

    // clock-window
    hrmsClockMinutesInShanghai,
    hrmsDateKeyInShanghai,
    hrmsAttendanceWindowMinutesForStore,

    // leave-balance
    resolveEmployeeLeaveCalcStartMonth,
    calcEmployeeMonthlyApprovedLeaveDays,
    calcEmployeeMonthlyCarryover,
    calcEmployeeMonthlyLeaveBalance,

    // close-snapshot
    getLeaveCumulativeCloseSnapshot,
    getLockedOpeningCarryForMonth,
    runLeaveCumulativeCloseSnapshotForClosedMonth,

    // penalties
    ATTENDANCE_PENALTY_START_DATE,
    computeAttendanceMissingClockPenalties,
  };
}
