/**
 * Daily-reports HTTP routes (behavior-preserving extract from index.js).
 * registerDailyReportsRoutes(app, deps)
 */
import {
  bindDailyReportsRuntimeDeps,
  canAccessDailyReports,
  canWriteDailyReports,
  recalcWechatMonthTotalsForStoreMonth,
  upsertDailyReportPgFromStateReport,
} from './helpers.js';
import {
  listDailyReports,
  queryPrivateRoomMonthTotal,
  deleteDailyReportFromState,
  syncSubmittedDailyReportsToPg,
  upsertDailyReport,
} from './service.js';
import { randomUUID } from 'crypto';
import { reconcileDailyReportAttendanceRegister } from '../../daily-attendance-register.js';
import { childLogger } from '../../utils/logger.js';

const log = childLogger({ domain: 'daily-reports', handler: 'routes' });

export { canAccessDailyReports, canWriteDailyReports, dailyReportItemFromPgRow } from './helpers.js';

export function registerDailyReportsRoutes(app, deps) {
  const {
    pool,
    authRequired,
    getSharedState,
    mergeSharedStateFields,
    safeDateOnly,
    stateFindUserRecord,
    expandAgentStoreLabels,
    inDateRange,
    hrmsNowISO,
    notifyAdminsDualWriteFailure,
    safeErrMessage,
    isAdmin,
    addStateNotification,
    makeNotif,
  } = deps;

  bindDailyReportsRuntimeDeps({
    pool,
    hrmsNowISO,
    safeDateOnly,
    getSharedState,
  });

  // 本月包房累计（仅洪潮品牌）
  app.get('/api/daily-reports/private-room-month-total', authRequired, async (req, res) => {
    const store = String(req.query?.store || '').trim();
    const month = String(req.query?.month || '').trim(); // YYYY-MM
    if (!store || !month || !/^\d{4}-\d{2}$/.test(month)) {
      return res.json({ total: 0 });
    }
    try {
      const { total } = await queryPrivateRoomMonthTotal({
        pool,
        store,
        month,
        tenantId: req.tenantId || req.user?.tenant_id || 'default',
        expandAgentStoreLabels,
      });
      return res.json({ total });
    } catch (e) {
      log.error({ msg: 'private_room_month_total_failed', err: e?.message || String(e) });
      return res.json({ total: 0 });
    }
  });

  app.get('/api/daily-reports', authRequired, async (req, res) => {
    const username = String(req.user?.username || '').trim();
    const role = String(req.user?.role || '').trim();
    if (!username) return res.status(400).json({ error: 'missing_user' });
    if (!canAccessDailyReports(role)) return res.status(403).json({ error: 'forbidden' });

    const date = safeDateOnly(req.query?.date);
    const start = safeDateOnly(req.query?.start);
    const end = safeDateOnly(req.query?.end);
    const storeQ = String(req.query?.store || '').trim();
    const limit = Math.min(2000, Math.max(1, Number(req.query?.limit || 200)));

    try {
      const payload = await listDailyReports({
        pool,
        getSharedState,
        stateFindUserRecord,
        inDateRange,
        username,
        role,
        date,
        start,
        end,
        storeQ,
        limit,
        allowedStores: Array.isArray(req.user?.allowed_stores) ? req.user.allowed_stores : [],
        currentStore: String(req.user?.current_store || '').trim(),
        tenantId: req.tenantId || req.user?.tenant_id || 'default',
        requestId: req.requestId,
      });
      return res.json(payload);
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: 'internal_error' });
    }
  });

  app.post('/api/daily-reports', authRequired, async (req, res) => {
    const username = String(req.user?.username || '').trim();
    const role = String(req.user?.role || '').trim();
    if (!username) return res.status(400).json({ error: 'missing_user' });
    if (!canWriteDailyReports(role)) return res.status(403).json({ error: 'forbidden' });
    const date = safeDateOnly(req.body?.date);
    if (!date) return res.status(400).json({ error: 'missing_date' });
    try {
      const result = await upsertDailyReport({
        pool, getSharedState, mergeSharedStateFields, stateFindUserRecord,
        addStateNotification, makeNotif, notifyAdminsDualWriteFailure, safeErrMessage,
        hrmsNowISO, randomUUID, recalcWechatMonthTotalsForStoreMonth, reconcileDailyReportAttendanceRegister,
        username, role, date,
        bodyStore: req.body?.store,
        allowedStores: Array.isArray(req.user?.allowed_stores) ? req.user.allowed_stores : [],
        currentStore: String(req.user?.current_store || '').trim(),
        dataPayload: req.body?.data,
        wantSubmit: !!req.body?.submitted,
        tenantId: req.tenantId || req.user?.tenant_id || 'default',
        requestId: req.requestId,
      });
      if (result.error) {
        return res.status(result.status).json({
          error: result.error,
          ...(result.message ? { message: result.message } : {}),
          ...(result.hint ? { hint: result.hint } : {}),
        });
      }
      return res.json({ item: result.item });
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: 'internal_error' });
    }
  });

  app.delete('/api/daily-reports', authRequired, async (req, res) => {
    const username = String(req.user?.username || '').trim();
    const role = String(req.user?.role || '').trim();
    if (!username) return res.status(400).json({ error: 'missing_user' });
    if (!isAdmin(role)) return res.status(403).json({ error: 'forbidden' });

    const store = String(req.query?.store || '').trim();
    const date = safeDateOnly(req.query?.date);
    if (!store) return res.status(400).json({ error: 'missing_store' });
    if (!date) return res.status(400).json({ error: 'missing_date' });

    try {
      const result = await deleteDailyReportFromState({
        store,
        date,
        getSharedState,
        mergeSharedStateFields,
        notifyAdminsDualWriteFailure,
        safeErrMessage,
      });
      if (result.error) {
        return res.status(502).json({ error: result.error, message: result.message });
      }
      return res.json({ ok: true });
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: 'internal_error' });
    }
  });

  /** admin：从 hrms_state 将「已提交」营业日报强制 UPSERT 到 daily_reports（不修改 state，用于补 PG） */
  app.post('/api/admin/sync-submitted-daily-reports-pg', authRequired, async (req, res) => {
    const role = String(req.user?.role || '').trim();
    if (role !== 'admin' && role !== 'hq_manager') {
      return res.status(403).json({ error: 'forbidden', message: '仅 admin 或 hq_manager' });
    }
    const date = safeDateOnly(req.body?.date);
    const storeFilter = String(req.body?.store || '').trim();
    if (!date) {
      return res.status(400).json({ error: 'missing_date', hint: 'JSON body: { "date": "2026-04-11", "store": "可选精确店名" }' });
    }
    try {
      const payload = await syncSubmittedDailyReportsToPg({
        date,
        storeFilter,
        tenantId: req.tenantId || req.user?.tenant_id || 'default',
        getSharedState,
        safeDateOnly,
        upsertDailyReportPgFromStateReport,
        notifyAdminsDualWriteFailure,
        safeErrMessage,
      });
      return res.json(payload);
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: 'internal_error' });
    }
  });

}
