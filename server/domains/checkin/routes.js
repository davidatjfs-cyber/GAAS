/**
 * Checkin / attendance HTTP routes — thin handlers.
 * Business logic lives in service.js.
 */
import { requireHrmsPermission } from '../../services/hrms-permission-engine.js';
import {
  createCheckin,
  listTodayCheckins,
  listCheckinRecords,
  confirmCheckin,
  getCheckinSummary,
  getAttendanceOverview,
  setLeaveBalance,
  confirmMonthlyAttendance,
  getMonthlyConfirm,
} from './service.js';

function sendFail(res, result) {
  const { ok: _ok, status, ...body } = result;
  return res.status(status).json(body);
}

function withRequestId(ctx, req) {
  return { ...ctx, requestId: req.requestId };
}

export function registerCheckinRoutes(app, deps) {
  const { authRequired, ...rest } = deps;
  const ctx = { ...rest };

  app.post('/api/checkin', authRequired, async (req, res) => {
    const username = String(req.user?.username || '').trim();
    const result = await createCheckin(withRequestId(ctx, req), {
      username,
      type: req.body?.type,
      latitude: req.body?.latitude,
      longitude: req.body?.longitude,
      body: req.body,
      faceMatch: req.body?.faceMatch,
      faceScore: req.body?.faceScore,
      photoUrl: req.body?.photoUrl,
      storeName: String(req.body?.store || req.user?.store || '').trim(),
      tenantId: req.tenantId || req.user?.tenant_id || 'default',
    });
    if (!result.ok) return sendFail(res, result);
    return res.json({ ok: true, record: result.record });
  });

  app.get('/api/checkin/today', authRequired, async (req, res) => {
    const username = String(req.user?.username || '').trim();
    const result = await listTodayCheckins(withRequestId(ctx, req), { username });
    if (!result.ok) return sendFail(res, result);
    return res.json({ records: result.records });
  });

  app.get('/api/checkin/records', authRequired, async (req, res) => {
    const username = String(req.user?.username || '').trim();
    const role = String(req.user?.role || '').trim();
    const result = await listCheckinRecords(withRequestId(ctx, req), {
      username,
      role,
      filterUser: String(req.query?.username || '').trim(),
      filterStore: String(req.query?.store || '').trim(),
      filterName: String(req.query?.name || '').trim(),
      start: req.query?.start,
      end: req.query?.end,
      filterStatus: String(req.query?.status || '').trim(),
      tenantId: req.tenantId || req.user?.tenant_id || 'default',
    });
    if (!result.ok) return sendFail(res, result);
    return res.json({ records: result.records });
  });

  app.post('/api/checkin/:id/confirm', authRequired, async (req, res) => {
    const username = String(req.user?.username || '').trim();
    const role = String(req.user?.role || '').trim();
    const result = await confirmCheckin(withRequestId(ctx, req), {
      username,
      role,
      id: req.params?.id,
      status: req.body?.status,
      note: req.body?.note,
      tenantId: req.tenantId || req.user?.tenant_id || 'default',
    });
    if (!result.ok) return sendFail(res, result);
    return res.json({ record: result.record });
  });

  app.get('/api/checkin/summary', authRequired, async (req, res) => {
    const username = String(req.user?.username || '').trim();
    const role = String(req.user?.role || '').trim();
    const result = await getCheckinSummary(withRequestId(ctx, req), {
      username,
      role,
      filterStore: String(req.query?.store || '').trim(),
      month: String(req.query?.month || '').trim(),
      tenantId: req.tenantId || req.user?.tenant_id || 'default',
    });
    if (!result.ok) return sendFail(res, result);
    return res.json({ records: result.records, leaveBalances: result.leaveBalances });
  });

  app.get('/api/profile/attendance-overview', authRequired, async (req, res) => {
    const username = String(req.user?.username || '').trim();
    const role = String(req.user?.role || '').trim();
    const month = String(req.query?.month || '').trim();
    const result = await getAttendanceOverview(ctx, {
      username,
      role,
      month,
      tenantId: req.tenantId || req.user?.tenant_id || 'default',
    });
    if (!result.ok) return sendFail(res, result);
    const { ok: _ok, ...payload } = result;
    return res.json(payload);
  });

  app.post('/api/checkin/leave-balance', authRequired, async (req, res) => {
    const actor = String(req.user?.username || '').trim();
    const role = String(req.user?.role || '').trim();
    if (!(await requireHrmsPermission(req, res, 'reports.leave_owed.adjust', {
      getSharedState: ctx.getSharedState,
    }))) return;
    const result = await setLeaveBalance(ctx, {
      actor,
      role,
      targetUsername: req.body?.username,
      month: req.body?.month,
      value: req.body?.value,
      mode: req.body?.mode,
      note: req.body?.note,
    });
    if (!result.ok) return sendFail(res, result);
    return res.json({
      ok: true,
      key: result.key,
      value: result.value,
      adjustment: result.adjustment,
    });
  });

  app.post('/api/checkin/monthly-confirm', authRequired, async (req, res) => {
    const username = String(req.user?.username || '').trim();
    const role = String(req.user?.role || '').trim();
    const result = await confirmMonthlyAttendance(withRequestId(ctx, req), {
      username,
      role,
      month: req.body?.month,
      store: req.body?.store,
      summary: req.body?.summary,
      tenantId: req.tenantId || req.user?.tenant_id || 'default',
    });
    if (!result.ok) return sendFail(res, result);
    return res.json({ ok: true, confirmation: result.confirmation });
  });

  app.get('/api/checkin/monthly-confirm', authRequired, async (req, res) => {
    const result = await getMonthlyConfirm(ctx, {
      month: req.query?.month,
    });
    if (!result.ok) return sendFail(res, result);
    return res.json({ confirmations: result.confirmations });
  });
}
