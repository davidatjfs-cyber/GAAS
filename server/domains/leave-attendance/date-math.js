/** 日期跨度 / 月重叠 / shiftMonth / 累计年假天数 / override key */

export function createDateMathHelpers({ safeDateOnly, safeMonthOnly }) {
  function calcDateSpanDaysInclusive(startDate, endDate) {
    const s = safeDateOnly(startDate);
    const e = safeDateOnly(endDate);
    if (!s || !e) return null;
    const st = new Date(s + 'T00:00:00').getTime();
    const et = new Date(e + 'T00:00:00').getTime();
    if (!Number.isFinite(st) || !Number.isFinite(et) || et < st) return null;
    const days = Math.floor((et - st) / (24 * 60 * 60 * 1000)) + 1;
    return days > 0 ? days : null;
  }

  function calcOverlapDaysWithinMonth(startDate, endDate, month) {
    const s = safeDateOnly(startDate);
    const e = safeDateOnly(endDate);
    const m = safeMonthOnly(month);
    if (!s || !e || !m) return 0;
    const [yr, mo] = m.split('-').map(Number);
    const monthStart = new Date(yr, mo - 1, 1).getTime();
    const monthEnd = new Date(yr, mo, 0).getTime();
    const st = new Date(s + 'T00:00:00').getTime();
    const et = new Date(e + 'T00:00:00').getTime();
    if (!Number.isFinite(st) || !Number.isFinite(et) || et < st) return 0;
    const overlapStart = Math.max(st, monthStart);
    const overlapEnd = Math.min(et, monthEnd);
    if (overlapEnd < overlapStart) return 0;
    return Math.floor((overlapEnd - overlapStart) / 86400000) + 1;
  }

  function calcCumulativeLeaveDaysByJoinDate(joinDateInput) {
    const joinDate = String(joinDateInput || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(joinDate)) return 0;
    const jd = new Date(joinDate + 'T00:00:00');
    if (!Number.isFinite(jd.getTime())) return 0;
    const years = (Date.now() - jd.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
    if (years >= 20) return 15;
    if (years >= 10) return 10;
    if (years >= 1) return 5;
    return 0;
  }

  function shiftMonth(ym, delta) {
    const m = safeMonthOnly(ym);
    if (!m || !Number.isFinite(Number(delta))) return '';
    const [y, mo] = m.split('-').map(Number);
    const d = new Date(y, mo - 1 + Number(delta), 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  /** 与 leaveBalanceOverrides / 审计记录 key 一致：用户名一律小写，避免大小写不一致导致「手动累计假期」未生效 */
  function leaveBalanceOverrideKey(username, month) {
    return `${String(username || '').trim().toLowerCase()}_${String(month || '').trim()}`;
  }

  function getLeaveBalanceOverride(state, username, month) {
    const overrides = state?.leaveBalanceOverrides && typeof state.leaveBalanceOverrides === 'object'
      ? state.leaveBalanceOverrides
      : {};
    const canonical = leaveBalanceOverrideKey(username, month);
    let raw = overrides[canonical];
    if (raw == null) {
      const legacy = `${String(username || '').trim()}_${String(month || '').trim()}`;
      raw = overrides[legacy];
    }
    if (raw == null) return null;
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      const mode = String(raw.mode || '').trim().toLowerCase();
      const value = Number(raw.value);
      if (!Number.isFinite(value)) return null;
      return { mode: mode || 'carryover', value, raw };
    }
    const value = Number(raw);
    if (!Number.isFinite(value)) return null;
    return { mode: 'remaining', value, raw };
  }

  return {
    calcDateSpanDaysInclusive,
    calcOverlapDaysWithinMonth,
    calcCumulativeLeaveDaysByJoinDate,
    shiftMonth,
    leaveBalanceOverrideKey,
    getLeaveBalanceOverride,
  };
}
