/**
 * Attendance + daily-attendance-register — /api/reports/attendance*
 */
import {
  pool,
  requireReportPerm,
} from './helpers.js';

export function registerReportsAttendanceRoutes(app, deps) {
  const {
    authRequired,
    getSharedState,
    safeDateOnly,
    pickMyStoreFromState,
    dbListEmployeesForReports,
    buildAttendanceFromCheckinRecords,
    buildAttendanceSummaryRows,
    summarizeDailyRegisterForEmployee,
    filterDailyRegisterRowsByEmployee,
  } = deps;

  app.get('/api/reports/attendance', authRequired, async (req, res) => {
    const username = String(req.user?.username || '').trim();
    const role = String(req.user?.role || '').trim();
    if (!username) return res.status(400).json({ error: 'missing_user' });
    const storeQAtt = String(req.query?.store || '').trim();
    if (!(await requireReportPerm(req, res, 'reports.attendance.view', storeQAtt))) return;
    const start = safeDateOnly(req.query?.start);
    const end = safeDateOnly(req.query?.end);
    if (!start || !end) return res.status(400).json({ error: 'missing_range' });
    const storeQ = String(req.query?.store || '').trim();

    try {
      const state0 = (await getSharedState()) || {};
      const myStore = pickMyStoreFromState(state0, username);
      const _allowedStores10959 = Array.isArray(req.user?.allowed_stores) ? req.user.allowed_stores : [];
      const _currentStore10959 = String(req.user?.current_store || '').trim();
      const store = role === 'store_manager'
        ? (storeQ && _allowedStores10959.includes(storeQ) ? storeQ : (_currentStore10959 || myStore))
        : storeQ;
      // Also fetch detailed checkin records from DB
      let checkinDetails = [];
      try {
        let conditions = [`check_time >= $1::date`, `check_time < ($2::date + interval '1 day')`];
        let params = [start, end];
        let idx = 3;
        if (store) { conditions.push(`c.store = $${idx}`); params.push(store); idx++; }
        params.push(req.tenantId || req.user?.tenant_id || 'default');
        conditions.push(`c.tenant_id = $${idx}`);
        const where = 'where ' + conditions.join(' and ');
        const sql = `select c.username, c.store, c.check_time, c.status, c.type, c.confirmed_by, c.confirmed_at from checkin_records c ${where} order by c.check_time desc limit 5000`;
        const cr = await pool.query(sql, params);
        const employeesList = Array.isArray(state0.employees) ? state0.employees : [];
        const usersList = Array.isArray(state0.users) ? state0.users : [];
        let nameByLower = null;
        if (employeesList.length || usersList.length) {
          nameByLower = new Map();
          for (const e of employeesList) {
            const u = String(e?.username || '').trim().toLowerCase();
            if (!u) continue;
            if (!nameByLower.has(u)) nameByLower.set(u, String(e?.name || '').trim() || String(e?.username || '').trim());
          }
          for (const e of usersList) {
            const u = String(e?.username || '').trim().toLowerCase();
            if (!u || nameByLower.has(u)) continue;
            nameByLower.set(u, String(e?.name || '').trim() || String(e?.username || '').trim());
          }
        } else {
          const dbEmps = await dbListEmployeesForReports({ store, includeInactive: false, tenantId: req.tenantId || req.user?.tenant_id || 'default' });
          nameByLower = new Map();
          for (const e of dbEmps) {
            const u = String(e?.username || '').trim().toLowerCase();
            if (!u) continue;
            nameByLower.set(u, String(e?.name || '').trim() || String(e?.username || '').trim());
          }
        }
        // Build storeByLower map from employees for fallback when checkin_records.store is empty
        let storeByLower = null;
        if (employeesList.length || usersList.length) {
          storeByLower = new Map();
          for (const e of [...employeesList, ...usersList]) {
            const u = String(e?.username || '').trim().toLowerCase();
            const s = String(e?.store || '').trim();
            if (u && s && !storeByLower.has(u)) storeByLower.set(u, s);
          }
        } else {
          const dbEmps2 = await dbListEmployeesForReports({ store: null, includeInactive: false, tenantId: req.tenantId || req.user?.tenant_id || 'default' });
          storeByLower = new Map();
          for (const e of dbEmps2) {
            const u = String(e?.username || '').trim().toLowerCase();
            const s = String(e?.store || '').trim();
            if (u && s) storeByLower.set(u, s);
          }
        }
        checkinDetails = (cr.rows || []).map(r => {
          const lower = String(r.username || '').trim().toLowerCase();
          r.display_name = (nameByLower ? nameByLower.get(lower) : null) || r.username;
          // Fill missing store from employee profile
          if (!r.store && storeByLower) r.store = storeByLower.get(lower) || '';
          return r;
        });
      } catch (e) { /* ignore */ }

      const fallbackRows = buildAttendanceFromCheckinRecords(checkinDetails, { start, end });
      let registerRows = [];
      try {
        const args = [start, end];
        let registerSql = `
          SELECT store, report_date, line_details
          FROM daily_report_attendance_register
          WHERE report_date >= $1::date AND report_date <= $2::date`;
        if (store) {
          registerSql += ` AND TRIM(store) = TRIM($3::text)`;
          args.push(store);
        }
        args.push(req.tenantId || req.user?.tenant_id || 'default');
        registerSql += ` AND tenant_id = $${args.length}`;
        registerSql += ` ORDER BY report_date DESC, store ASC`;
        const rr = await pool.query(registerSql, args);
        registerRows = Array.isArray(rr.rows) ? rr.rows : [];
      } catch (e) { /* ignore */ }

      const summaryRows = buildAttendanceSummaryRows(registerRows, checkinDetails);
      const totals = summaryRows.reduce((acc, row) => {
        acc.people += 1;
        acc.actualAttendanceDays += Number(row.actualAttendanceDays || 0);
        acc.absenceDays += Number(row.absenceDays || 0);
        acc.lateDays += Number(row.lateDays || 0);
        acc.restDays += Number(row.restDays || 0);
        acc.anomalyPunches += Number(row.anomalyPunches || 0);
        return acc;
      }, { people: 0, actualAttendanceDays: 0, absenceDays: 0, lateDays: 0, restDays: 0, anomalyPunches: 0 });

      return res.json({
        start,
        end,
        store: store || '',
        rows: summaryRows,
        summaryRows,
        fallbackRows,
        checkinDetails,
        totals,
        hasRegisterData: registerRows.length > 0
      });
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: 'internal_error' });
    }
  });

  app.get('/api/reports/daily-attendance-register', authRequired, async (req, res) => {
    const username = String(req.user?.username || '').trim();
    const _role = String(req.user?.role || '').trim();
    if (!username) return res.status(400).json({ error: 'missing_user' });
    const storeQDar = String(req.query?.store || '').trim();
    if (!(await requireReportPerm(req, res, 'reports.daily_register.view', storeQDar))) return;

    const start = safeDateOnly(req.query?.start);
    const end = safeDateOnly(req.query?.end);
    if (!start || !end) return res.status(400).json({ error: 'missing_range' });
    const storeQ = String(req.query?.store || '').trim();
    const employeeQ = String(req.query?.employee || '').trim();

    try {
      const args = [start, end];
      let sql = `
        SELECT store, brand, report_date, labor_total,
               front_person_days, kitchen_person_days, rest_person_days,
               staff_snapshot, line_details, overall_status, anomaly_count,
               created_at, updated_at
        FROM daily_report_attendance_register
        WHERE report_date >= $1::date AND report_date <= $2::date`;
      if (storeQ) {
        sql += ` AND TRIM(store) = TRIM($3::text)`;
        args.push(storeQ);
      }
      args.push(req.tenantId || req.user?.tenant_id || 'default');
      sql += ` AND tenant_id = $${args.length}`;
      sql += ` ORDER BY report_date DESC, store ASC`;
      const r = await pool.query(sql, args);
      let rows = r.rows || [];
      let employeeSummary = null;
      if (employeeQ) {
        employeeSummary = summarizeDailyRegisterForEmployee(rows, employeeQ);
        rows = filterDailyRegisterRowsByEmployee(rows, employeeQ);
      }
      return res.json({
        start,
        end,
        store: storeQ || '',
        employee: employeeQ,
        employee_summary: employeeSummary,
        rows
      });
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: 'internal_error' });
    }
  });

}
