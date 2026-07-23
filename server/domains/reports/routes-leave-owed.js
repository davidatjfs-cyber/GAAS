/**
 * Leave-owed report — /api/reports/leave-owed
 */
import {
  pool,
  safeMonthOnly,
  getSharedStateRef,
  requireReportPerm,
  checkHrmsPermission,
} from './helpers.js';

export function registerReportsLeaveOwedRoutes(app, deps) {
  const {
    authRequired,
    getSharedState,
    pickMyStoreFromState,
    calcEmployeeMonthlyLeaveBalance,
    computeAttendanceMissingClockPenalties,
    isLegacyTestUsername,
    hrmsNowISO,
  } = deps;

  app.get('/api/reports/leave-owed', authRequired, async (req, res) => {
    const username = String(req.user?.username || '').trim();
    const role = String(req.user?.role || '').trim();
    if (!username) return res.status(400).json({ error: 'missing_user' });
    const filterStoreLeave = String(req.query?.store || '').trim();
    if (!(await requireReportPerm(req, res, 'reports.leave_owed.view', filterStoreLeave))) return;

    const month = safeMonthOnly(req.query?.month || '') || hrmsNowISO().slice(0, 7);
    const filterStore = String(req.query?.store || '').trim();
    const includeInactive = String(req.query?.includeInactive || '').trim() === '1';

    try {
      const state0 = (await getSharedState()) || {};
      const myStore = pickMyStoreFromState(state0, username);
      const _allowedStores10814 = Array.isArray(req.user?.allowed_stores) ? req.user.allowed_stores : [];
      const _currentStore10814 = String(req.user?.current_store || '').trim();
      const store = role === 'store_manager'
        ? (filterStore && _allowedStores10814.includes(filterStore) ? filterStore : (_currentStore10814 || myStore))
        : filterStore;

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

      let people = Array.from(map.values());
      if (!people.length) {
        try {
          const params = [];
          const where = [];
          if (store) {
            params.push(store);
            where.push(`store = $${params.length}`);
          }
          if (!includeInactive) {
            where.push(`(coalesce(status, '') not in ('inactive', '离职') AND NOT COALESCE((extra_json->>'offboardingApproved')::boolean, false))`);
          }
          params.push(req.tenantId || req.user?.tenant_id || 'default');
          where.push(`tenant_id = $${params.length}`);
          const sql = `select username, name, role, store, department, position, status,
                              join_date as "joinDate", created_at as "createdAt"
                         from employees
                         ${where.length ? ('where ' + where.join(' and ')) : ''}
                        order by name asc, username asc`;
          const dbRows = await pool.query(sql, params);
          people = Array.isArray(dbRows.rows) ? dbRows.rows : [];
        } catch (_) { /* ignore */ }
      }
      if (store) people = people.filter(p => String(p?.store || '').trim() === store);
      if (!includeInactive) {
        people = people.filter(p => {
          const st = String(p?.status || '').trim().toLowerCase();
          if (st === 'inactive' || st === '离职') return false;
          const ob = p?.offboardingApproved === true || String(p?.offboardingApproved || '').trim().toLowerCase() === 'true';
          if (ob) return false;
          return true;
        });
      }

      const penaltyMap = await computeAttendanceMissingClockPenalties(month, store, req.tenantId || req.user?.tenant_id || 'default');
      const tidLeave = req.tenantId || req.user?.tenant_id || 'default';
      const dbLeave = typeof pool === 'function' ? pool() : pool;
      let summarizeAttMonth = null;
      let listAttRestDays = null;
      try {
        const mod = await import('../../services/hrms-attendance-day.js');
        summarizeAttMonth = mod.summarizeAttendanceDaysForMonth;
        listAttRestDays = mod.listAttendanceRestDaysForMonth;
      } catch (_) { /* ignore */ }
      const rows = [];
      for (const p of people) {
        const penalty = penaltyMap.get(String(p?.username || '').trim().toLowerCase());
        let attendanceRestDays = null;
        let attendanceRestDetails = null;
        if (typeof listAttRestDays === 'function') {
          try {
            const details = await listAttRestDays({
              tenantId: tidLeave,
              username: p.username,
              month,
              db: dbLeave
            });
            if (Array.isArray(details) && details.length) {
              attendanceRestDetails = details;
              attendanceRestDays = details.reduce((s, d) => s + Number(d?.days || 0), 0);
            }
          } catch (_) { /* ignore */ }
        }
        if (attendanceRestDays == null && typeof summarizeAttMonth === 'function') {
          try {
            const att = await summarizeAttMonth({
              tenantId: tidLeave,
              username: p.username,
              month,
              db: dbLeave
            });
            if (att && Number.isFinite(Number(att.restDays))) attendanceRestDays = Number(att.restDays);
          } catch (_) { /* ignore */ }
        }
        const bal = calcEmployeeMonthlyLeaveBalance(state0, p, month, { penalty, attendanceRestDays, attendanceRestDetails }) || {
          baseLeave: 0, annualLeave: 0, usedLeave: 0, totalLeave: 0, computedRemaining: 0, remaining: 0, overridden: false, weeklyDetails: [], lastAdjustment: null
        };
        const remaining = Number(bal?.remaining || 0);
        const _joinDate = String(p?.joinDate || p?.hireDate || p?.startDate || p?.entryDate || p?.onboardDate || p?.joiningDate || p?.createdAt || '').trim();
        rows.push({
          username: String(p?.username || '').trim(),
          name: String(p?.name || p?.username || '').trim(),
          role: String(p?.role || '').trim(),
          store: String(p?.store || '').trim(),
          department: String(p?.department || '').trim(),
          position: String(p?.position || '').trim(),
          status: String(p?.status || 'active').trim() || 'active',
          baseLeave: bal.baseLeave,
          annualLeave: bal.annualLeave,
          usedLeave: bal.usedLeave,
          totalLeave: bal.totalLeave,
          actualRestDays: bal.usedLeave,
          holidayDays: bal.totalLeave,
          cumulativeLeaveDays: Number(bal?.cumulativeLeaveDays || 0),
          monthRemaining: Number(bal?.monthRemaining || 0),
          computedRemaining: bal.computedRemaining,
          usedLeaveDetails: Array.isArray(bal?.usedLeaveDetails) ? bal.usedLeaveDetails : [],
          remaining,
          isOwed: remaining > 0,
          owedDays: remaining > 0 ? Number(remaining.toFixed(2)) : 0,
          overridden: !!bal.overridden,
          weeklyDetails: Array.isArray(bal.weeklyDetails) ? bal.weeklyDetails : [],
          lastAdjustment: bal.lastAdjustment || null
        });
      }
      rows.sort((a, b) => {
        if (Number(a.isOwed) !== Number(b.isOwed)) return Number(b.isOwed) - Number(a.isOwed);
        const ra = Number(a.remaining || 0);
        const rb = Number(b.remaining || 0);
        if (ra !== rb) return rb - ra;
        return String(a.name || a.username || '').localeCompare(String(b.name || b.username || ''), 'zh-Hans-CN');
      });

      const totals = rows.reduce((acc, r) => {
        acc.people += 1;
        acc.totalLeave = Number((acc.totalLeave + Number(r.totalLeave || 0)).toFixed(2));
        acc.usedLeave = Number((acc.usedLeave + Number(r.usedLeave || 0)).toFixed(2));
        acc.remaining = Number((acc.remaining + Number(r.remaining || 0)).toFixed(2));
        if (r.isOwed) {
          acc.owedPeople += 1;
          acc.owedDays = Number((acc.owedDays + Number(r.owedDays || 0)).toFixed(2));
        }
        return acc;
      }, { people: 0, owedPeople: 0, owedDays: 0, totalLeave: 0, usedLeave: 0, remaining: 0 });

      const adjustments = Array.isArray(state0?.leaveBalanceAdjustments) ? state0.leaveBalanceAdjustments : [];
      const monthAdjustments = adjustments
        .filter(a => String(a?.month || '') === month)
        .filter(a => !store || String(a?.store || '') === store)
        .slice(0, 200);

      const canAdjustCheck = await checkHrmsPermission(req, 'reports.leave_owed.adjust', {
        store: store || '',
        getSharedState: getSharedStateRef,
      });

      return res.json({
        month,
        store: store || '',
        includeInactive,
        canAdjust: !!canAdjustCheck.ok,
        totals,
        rows,
        adjustments: monthAdjustments
      });
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: 'internal_error' });
    }
  });

}
