/** 上月末累计池快照读写 */

import { upsertLeaveDomain } from './domain-service.js';
import { childLogger } from '../../utils/logger.js';

const log = childLogger({ domain: 'leave-attendance', handler: 'close-snapshot' });

export function createCloseSnapshotHelpers({
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
}) {
  /** 读取「已闭合月份」上月末累计池快照（次月1日 06:00 上海时区写入） */
  function getLeaveCumulativeCloseSnapshot(state, username, closedMonth) {
    const snaps = state?.leaveCumulativeCloseSnapshots && typeof state.leaveCumulativeCloseSnapshots === 'object'
      ? state.leaveCumulativeCloseSnapshots
      : {};
    const k = leaveBalanceOverrideKey(username, closedMonth);
    const raw = snaps[k];
    if (raw == null) return null;
    if (typeof raw === 'object' && raw !== null && Number.isFinite(Number(raw.value))) {
      return { value: Number(raw.value), lockedAt: String(raw.lockedAt || ''), source: String(raw.source || 'system') };
    }
    const v = Number(raw);
    if (Number.isFinite(v)) return { value: v, lockedAt: '', source: 'system' };
    return null;
  }

  /**
   * 业务口径（与「我的档案」累计假期展示一致）：
   * 1）若当月已有人工 carryover（核实上月末池），以人工为准，且不再回退到公式滚动（当月内固定展示该值）；
   * 2）否则若有「上月」闭合快照（次月1日6点锁定），以快照为准，当月内不随日报回填抖动；
   * 3）否则回退实时滚动计算（新系统或无快照月份）。
   */
  function getLockedOpeningCarryForMonth(state, employee, monthM) {
    const m = safeMonthOnly(monthM);
    const emp = employee && typeof employee === 'object' ? employee : null;
    const uname = String(emp?.username || '').trim();
    if (!m || !uname) return 0;
    const oNow = getLeaveBalanceOverride(state, uname, m);
    if (oNow && String(oNow.mode || '').toLowerCase() === 'carryover' && Number.isFinite(Number(oNow.value))) {
      return Number(Number(oNow.value).toFixed(2));
    }
    const prev = shiftMonth(m, -1);
    if (prev) {
      const snap = getLeaveCumulativeCloseSnapshot(state, uname, prev);
      if (snap && Number.isFinite(snap.value)) return Number(snap.value.toFixed(2));
    }
    return Number(calcEmployeeMonthlyCarryover(state, emp, m).toFixed(2));
  }

  /**
   * 为「已闭合自然月」写入上月末累计池快照（次月 1 日 06:00 上海时区由定时任务调用）。
   * 写入值 = 次月月初池（公式滚动，且忽略次月 carryover 人工覆盖，避免把未审覆盖写进上月闭合快照）。
   */
  async function runLeaveCumulativeCloseSnapshotForClosedMonth(closedMonth) {
    const m = safeMonthOnly(closedMonth);
    if (!m) return { ok: false, error: 'bad_month' };
    const nextM = shiftMonth(m, 1);
    if (!nextM) return { ok: false, error: 'bad_next' };

    const state0 = (await getSharedState()) || {};
    const emps = Array.isArray(state0?.employees) ? state0.employees : [];
    const users = Array.isArray(state0?.users) ? state0.users : [];
    const map = new Map();
    users.forEach((u) => {
      const k = String(u?.username || '').trim().toLowerCase();
      if (!k || isLegacyTestUsername(k)) return;
      if (!map.has(k)) map.set(k, { ...u, username: String(u?.username || '').trim() });
    });
    emps.forEach((e) => {
      const k = String(e?.username || '').trim().toLowerCase();
      if (!k || isLegacyTestUsername(k)) return;
      map.set(k, { ...(map.get(k) || {}), ...e, username: String(e?.username || '').trim() });
    });
    const people = Array.from(map.values());

    const prevSnaps = state0.leaveCumulativeCloseSnapshots && typeof state0.leaveCumulativeCloseSnapshots === 'object'
      ? state0.leaveCumulativeCloseSnapshots
      : {};
    const snaps = { ...prevSnaps };
    const lockedAt = hrmsNowISO();
    let n = 0;
    for (const p of people) {
      const uname = String(p?.username || '').trim();
      if (!uname) continue;
      const kk = leaveBalanceOverrideKey(uname, m);
      const prevSnap = prevSnaps[kk];
      if (prevSnap && typeof prevSnap === 'object' && String(prevSnap.source || '') === 'manual_carryover') {
        continue;
      }
      const val = calcEmployeeMonthlyCarryover(state0, p, nextM, { ignoreEndCarryoverOverride: true });
      snaps[kk] = {
        value: Number(Number(val).toFixed(2)),
        lockedAt,
        source: 'system_month_close',
        closedMonth: m
      };
      n++;
    }
    try {
      const tid = typeof resolveTenantIdDefault === 'function' ? resolveTenantIdDefault() : 'default';
      // 只 patch 这个函数真正要改的字段；leaveBalanceOverrides/leaveBalanceAdjustments 不传，
      // upsertLeaveDomain 会保留它们在表里的当前值，不会被这里读到的旧快照覆盖。
      await upsertLeaveDomain(pool, tid, {
        leaveCumulativeCloseSnapshots: snaps,
      });
      if (typeof invalidateSharedStateCache === 'function') {
        invalidateSharedStateCache(tid);
      }
    } catch (e) {
      log.error({ msg: 'close_snapshot_upsert_failed', closedMonth: m, err: e?.message || e, stack: e?.stack });
      return { ok: false, error: 'internal_error', closedMonth: m };
    }
    return { ok: true, closedMonth: m, nextMonth: nextM, employees: n };
  }

  return {
    getLeaveCumulativeCloseSnapshot,
    getLockedOpeningCarryForMonth,
    runLeaveCumulativeCloseSnapshotForClosedMonth,
  };
}
