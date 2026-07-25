/**
 * Admin ops HTTP routes (Wave 4q — behavior-preserving extract from index.js).
 */
import { childLogger } from '../../utils/logger.js';

const log = childLogger({ domain: 'admin-ops', handler: 'routes' });

export function registerAdminOpsRoutes(app, authRequired, deps) {
  const {
    pool,
    canAccessDailyAttendanceRegister,
    safeDateOnly,
    safeMonthOnly,
    safeErrMessage,
    backfillDailyAttendanceRegisterMissing,
    runLeaveCumulativeCloseSnapshotForClosedMonth,
    runSalesRawFolderImportOnce,
    notifyAdminsDualWriteFailure,
    normalizeRoleForJwt,
    loadEmployeesFromTable,
    getSharedState,
    sendAdminSystemAlert,
    hrmsNowISO,
  } = deps;

  app.post('/api/admin/reconcile-daily-attendance-register-from-pg', authRequired, async (req, res) => {
    const role = String(req.user?.role || '').trim();
    if (!canAccessDailyAttendanceRegister(role)) return res.status(403).json({ error: 'forbidden' });
    if (!pool) return res.status(503).json({ error: 'database_unavailable' });

    const maxRows = Math.min(5000, Math.max(1, Number(req.body?.maxRows) || 1500));
    const start = safeDateOnly(req.body?.start);
    const end = safeDateOnly(req.body?.end);
    const store = String(req.body?.store || '').trim();

    try {
      const refreshExisting = !!req.body?.refreshExisting;
      const out = await backfillDailyAttendanceRegisterMissing(pool, {
        maxRows,
        start,
        end,
        store,
        refreshExisting,
        tenantId: req.tenantId || req.user?.tenant_id || 'default',
      });
      return res.json({ ok: true, refreshExisting, ...out });
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: 'internal_error' });
    }
  });

  // 管理端：重算指定「已闭合月份」的累计假期闭合快照（覆盖 system_month_close，保留人工 manual_carryover）。
  // 用途：累计假期公式修复后，旧公式在月初锁定的快照仍会被 getLockedOpeningCarryForMonth 取用，需刷新。
  app.post('/api/admin/leave-close-snapshot/recompute', authRequired, async (req, res) => {
    if (String(req.user?.role || '') !== 'admin') return res.status(403).json({ error: 'admin_only' });
    const month = safeMonthOnly(req.body?.month || '');
    if (!month) return res.status(400).json({ error: 'missing_month' });
    try {
      const r = await runLeaveCumulativeCloseSnapshotForClosedMonth(month);
      return res.json(r);
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: safeErrMessage(e) });
    }
  });

  /** 手动触发 sales_raw 目录扫描（需配置 SALES_RAW_IMPORT_DIR） */
  app.post('/api/admin/sales-raw/run-folder-import', authRequired, async (req, res) => {
    const role = String(req.user?.role || '').trim();
    if (role !== 'admin') return res.status(403).json({ error: 'forbidden' });
    try {
      const r = await runSalesRawFolderImportOnce();
      return res.json(r);
    } catch (e) {
      void notifyAdminsDualWriteFailure('sales_raw（管理员触发目录导入抛错）', e);
      return res.status(500).json({ error: 'internal_error' });
    }
  });

  /** 管理员查看某账号当前登录密码明文（优先 employees 表，其次 state 镜像）。 */
  app.get('/api/admin/employee-password/:username', authRequired, async (req, res) => {
    if (normalizeRoleForJwt(String(req.user?.role || '')) !== 'admin') {
      return res.status(403).json({ error: 'forbidden', message: '仅系统管理员可查看密码' });
    }
    const un = String(req.params.username || '').trim().toLowerCase();
    if (!un) return res.status(400).json({ error: 'missing_username' });
    try {
      const tid = req.tenantId || req.user?.tenant_id || 'default';
      const tableEmps = await loadEmployeesFromTable(pool, tid);
      const emp = tableEmps.find((e) => String(e?.username || '').trim().toLowerCase() === un);
      if (emp) {
        return res.json({ username: String(req.params.username || '').trim(), password: String(emp.password || '').trim() });
      }
      const state = (await getSharedState(tid)) || {};
      const employees = Array.isArray(state.employees) ? state.employees : [];
      const users = Array.isArray(state.users) ? state.users : [];
      const empS = employees.find((e) => String(e?.username || '').trim().toLowerCase() === un);
      const usr = users.find((u) => String(u?.username || '').trim().toLowerCase() === un);
      const password = String(empS?.password ?? usr?.password ?? '').trim();
      return res.json({ username: String(req.params.username || '').trim(), password });
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: 'internal_error' });
    }
  });

  app.post('/api/admin/system-alert/test', authRequired, async (req, res) => {
    const role = String(req.user?.role || '').trim();
    if (!['admin', 'hq_manager', 'hr_manager'].includes(role)) {
      return res.status(403).json({ error: 'forbidden' });
    }

    try {
      const targetUsername = String(req.body?.username || '').trim();
      if (!targetUsername) return res.status(400).json({ error: 'missing_username' });

      const targetR = await pool.query(
        `SELECT username, role
       FROM users
       WHERE lower(username) = lower($1)
         AND role IN ('admin','hq_manager','hr_manager')
       LIMIT 1`,
        [targetUsername]
      );
      const target = targetR.rows?.[0] || null;
      if (!target) return res.status(400).json({ error: 'target_user_not_admin' });

      const message = String(
        req.body?.message ||
          `🧪 [HRMS] 管理员单人告警测试\n目标账号：${target.username}\n时间：${hrmsNowISO()}\n说明：用于验证飞书告警与 HRMS 公司通知链路是否同时生效。`
      ).trim();

      const result = await sendAdminSystemAlert(message, {
        usernames: [target.username],
        persistToHrms: true,
        notificationType: 'system_alert_test',
        meta: {
          test: true,
          createdBy: String(req.user?.username || ''),
        },
      });
      return res.json({ ok: true, ...result, targetUsername: target.username });
    } catch (error) {
      log.error({ msg: 'admin_system_alert_test_failed', err: safeErrMessage(error) });
      return res.status(500).json({ error: 'server_error', message: safeErrMessage(error) });
    }
  });
}
