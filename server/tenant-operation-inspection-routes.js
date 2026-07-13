import {
  getLatestOverview,
  runInspection,
  listInspectionItems,
  generateInspectionReport,
  generateRecoveryTask,
  generateRecoveryTasksBatch,
  getInspectionTrends,
  saveInspectionReport,
  listInspectionReports,
  markInspectionReportSent,
  buildInspectionReportHtml,
} from './services/tenant-operation-inspection-service.js';
import {
  getHealthCenterBoard,
  getHealthCenterTenantDetail,
  scanHealthCenter,
} from './services/tenant-health-center-service.js';
import { listHealthFaqs } from './services/tenant-health-faq.js';
import {
  syncIncidentsFromInspections,
  listIncidents,
  ackIncident,
  resolveIncident,
  escalateIncident,
  healIncident,
  HEAL_ACTIONS,
  QUEUE_LABELS,
} from './services/tenant-health-incident-service.js';
import { tenantContext } from './utils/database.js';

const ALLOWED_ROLES = new Set([
  'admin',
  'super_admin',
  'tenant_admin',
  'operation_admin',
  'agent_admin',
  'hq_manager',
  'hr_manager',
]);

function tenantIdFrom(req) {
  return String(req.tenantId || req.params?.tenantId || req.user?.tenant_id || req.query?.tenant_id || req.body?.tenant_id || 'default').trim() || 'default';
}

function requireTenantInspectionRole(req, res, next) {
  const role = String(req.user?.role || '').trim();
  if (!ALLOWED_ROLES.has(role)) return res.status(403).json({ ok: false, error: 'forbidden' });
  const requestedTenant = String(req.query?.tenant_id || req.body?.tenant_id || '').trim();
  const currentTenant = String(req.tenantId || req.user?.tenant_id || 'default').trim() || 'default';
  if (requestedTenant && requestedTenant !== currentTenant && !['admin', 'super_admin'].includes(role)) {
    return res.status(403).json({ ok: false, error: 'tenant_forbidden' });
  }
  next();
}

function buildHandlers(pool) {
  const overview = async (req, res) => {
    try {
      const overview = await getLatestOverview(pool, {
        tenantId: tenantIdFrom(req),
        storeId: req.query?.store_id,
        date: req.query?.date,
      });
      return res.json({ ok: true, ...overview });
    } catch (e) {
      console.error('[tenant-inspection] overview failed:', e?.message || e);
      return res.status(500).json({ ok: false, error: 'server_error' });
    }
  };

  const run = async (req, res) => {
    try {
      const result = await runInspection(pool, {
        tenantId: tenantIdFrom(req),
        storeId: req.body?.store_id,
        date: req.body?.date,
        scope: req.body?.scope,
      });
      return res.json(result);
    } catch (e) {
      console.error('[tenant-inspection] run failed:', e?.message || e);
      return res.status(500).json({ ok: false, error: 'server_error' });
    }
  };

  const items = async (req, res) => {
    try {
      const items = await listInspectionItems(pool, {
        tenantId: tenantIdFrom(req),
        storeId: req.query?.store_id,
        date: req.query?.date,
        category: req.query?.category,
        severity: req.query?.severity,
      });
      return res.json({ ok: true, items });
    } catch (e) {
      console.error('[tenant-inspection] list items failed:', e?.message || e);
      return res.status(500).json({ ok: false, error: 'server_error' });
    }
  };

  const report = async (req, res) => {
    try {
      const result = await runInspection(pool, {
        tenantId: tenantIdFrom(req),
        storeId: req.body?.store_id,
        date: req.body?.date,
      });
      const report = generateInspectionReport({
        tenantId: tenantIdFrom(req),
        overview: result.overview,
        store_results: result.store_results,
        items: result.items,
      });
      const saved = await saveInspectionReport(pool, {
        tenantId: tenantIdFrom(req),
        runId: result.items?.[0]?.run_id || null,
        report,
      });
      const rawStatus = saved.report?.report_status || 'generated';
      const statusLabel = { generated: '已生成', pending: '待生成', failed: '生成失败' }[rawStatus] || rawStatus;
      return res.json({
        ok: true,
        ...report,
        report_id: saved.report?.id || null,
        health_score: result.overview?.health_score ?? null,
        risk_level: result.overview?.risk_level || null,
        report_status: rawStatus,
        report_status_label: statusLabel,
      });
    } catch (e) {
      console.error('[tenant-inspection] report failed:', e?.message || e);
      return res.status(500).json({ ok: false, error: 'server_error' });
    }
  };

  const generateTask = async (req, res) => {
    try {
      const result = await generateRecoveryTask(pool, { itemId: req.params.id });
      const status = result.ok ? 200 : (result.error === 'inspection_item_not_found' ? 404 : 400);
      return res.status(status).json(result);
    } catch (e) {
      console.error('[tenant-inspection] generate task failed:', e?.message || e);
      const status = String(e?.message || '') === 'inspection_item_not_found' ? 404 : 500;
      return res.status(status).json({ ok: false, error: status === 404 ? 'not_found' : 'server_error' });
    }
  };

  const generateTasksBatch = async (req, res) => {
    try {
      const result = await generateRecoveryTasksBatch(pool, {
        tenantId: tenantIdFrom(req),
        storeId: req.body?.store_id,
        severity: req.body?.severity,
        responsibleParty: req.body?.responsible_party,
        date: req.body?.date,
      });
      return res.status(result.ok ? 200 : 400).json(result);
    } catch (e) {
      console.error('[tenant-inspection] generate batch tasks failed:', e?.message || e);
      return res.status(500).json({ ok: false, error: 'server_error' });
    }
  };

  const trends = async (req, res) => {
    try {
      const items = await getInspectionTrends(pool, {
        tenantId: tenantIdFrom(req),
        storeId: req.query?.store_id,
        date: req.query?.date,
      });
      return res.json({ ok: true, items });
    } catch (e) {
      console.error('[tenant-inspection] trends failed:', e?.message || e);
      return res.status(500).json({ ok: false, error: 'server_error' });
    }
  };
  const reports = async (req, res) => {
    try {
      const items = await listInspectionReports(pool, { tenantId: tenantIdFrom(req) });
      return res.json({ ok: true, items });
    } catch (e) {
      console.error('[tenant-inspection] reports failed:', e?.message || e);
      return res.status(500).json({ ok: false, error: 'server_error' });
    }
  };
  const exportPdf = async (req, res) => {
    try {
      const list = await listInspectionReports(pool, { tenantId: tenantIdFrom(req) });
      const report = list.find((x) => String(x.id) === String(req.params.id));
      if (!report) return res.status(404).json({ ok: false, error: 'not_found' });
      const html = buildInspectionReportHtml(report, { tenantName: tenantIdFrom(req), date: report.created_at, riskLevel: '见报告结论', healthScore: '' });
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="tenant-operation-rectification-report-${report.id}.html"`);
      return res.send(html);
    } catch (e) {
      console.error('[tenant-inspection] export pdf failed:', e?.message || e);
      return res.status(500).json({ ok: false, error: 'server_error' });
    }
  };
  const markSent = async (req, res) => {
    try {
      const result = await markInspectionReportSent(pool, { reportId: req.params.id, tenantId: tenantIdFrom(req) });
      return res.status(result.ok ? 200 : 404).json(result.ok ? result : { ok: false, error: 'not_found' });
    } catch (e) {
      console.error('[tenant-inspection] mark sent failed:', e?.message || e);
      return res.status(500).json({ ok: false, error: 'server_error' });
    }
  };
  const recheck = run;
  return { overview, run, items, report, generateTask, generateTasksBatch, trends, reports, exportPdf, markSent, recheck };
}

function platformTenantMiddleware(req, _res, next) {
  const tenantId = String(req.params?.tenantId || req.query?.tenant_id || req.body?.tenant_id || 'default').trim() || 'default';
  req.tenantId = tenantId;
  req.user = { ...(req.user || {}), role: 'super_admin', tenant_id: tenantId };
  if (req.body && typeof req.body === 'object') req.body.tenant_id = tenantId;
  return tenantContext.run(tenantId, () => next());
}

export function registerTenantOperationInspectionRoutes(app, pool, authRequired, platformAdminRequired = null) {
  const h = buildHandlers(pool);
  app.get('/api/tenant-inspection/overview', authRequired, requireTenantInspectionRole, h.overview);
  app.post('/api/tenant-inspection/run', authRequired, requireTenantInspectionRole, h.run);
  app.get('/api/tenant-inspection/items', authRequired, requireTenantInspectionRole, h.items);
  app.get('/api/tenant-inspection/trends', authRequired, requireTenantInspectionRole, h.trends);
  app.get('/api/tenant-inspection/reports', authRequired, requireTenantInspectionRole, h.reports);
  app.post('/api/tenant-inspection/generate-report', authRequired, requireTenantInspectionRole, h.report);
  app.post('/api/tenant-inspection/reports/:id/export-pdf', authRequired, requireTenantInspectionRole, h.exportPdf);
  app.post('/api/tenant-inspection/reports/:id/mark-sent', authRequired, requireTenantInspectionRole, h.markSent);
  app.post('/api/tenant-inspection/recheck', authRequired, requireTenantInspectionRole, h.recheck);
  app.post('/api/tenant-inspection/items/:id/generate-task', authRequired, requireTenantInspectionRole, h.generateTask);
  app.post('/api/tenant-inspection/generate-tasks-batch', authRequired, requireTenantInspectionRole, h.generateTasksBatch);

  if (platformAdminRequired) {
    app.get('/api/admin/tenants/:tenantId/tenant-inspection/overview', platformAdminRequired, platformTenantMiddleware, h.overview);
    app.post('/api/admin/tenants/:tenantId/tenant-inspection/run', platformAdminRequired, platformTenantMiddleware, h.run);
    app.get('/api/admin/tenants/:tenantId/tenant-inspection/items', platformAdminRequired, platformTenantMiddleware, h.items);
    app.get('/api/admin/tenants/:tenantId/tenant-inspection/trends', platformAdminRequired, platformTenantMiddleware, h.trends);
    app.get('/api/admin/tenants/:tenantId/tenant-inspection/reports', platformAdminRequired, platformTenantMiddleware, h.reports);
    app.post('/api/admin/tenants/:tenantId/tenant-inspection/generate-report', platformAdminRequired, platformTenantMiddleware, h.report);
    app.post('/api/admin/tenants/:tenantId/tenant-inspection/reports/:id/export-pdf', platformAdminRequired, platformTenantMiddleware, h.exportPdf);
    app.post('/api/admin/tenants/:tenantId/tenant-inspection/reports/:id/mark-sent', platformAdminRequired, platformTenantMiddleware, h.markSent);
    app.post('/api/admin/tenants/:tenantId/tenant-inspection/recheck', platformAdminRequired, platformTenantMiddleware, h.recheck);
    app.post('/api/admin/tenants/:tenantId/tenant-inspection/items/:id/generate-task', platformAdminRequired, platformTenantMiddleware, h.generateTask);
    app.post('/api/admin/tenants/:tenantId/tenant-inspection/generate-tasks-batch', platformAdminRequired, platformTenantMiddleware, h.generateTasksBatch);

    // 极轻模式 Phase 1：客服健康中心（全租户红名单）
    app.get('/api/admin/health-center/board', platformAdminRequired, async (req, res) => {
      try {
        const data = await getHealthCenterBoard(pool, { light: req.query?.light || 'red' });
        return res.json(data);
      } catch (e) {
        console.error('[health-center] board failed:', e?.message || e);
        return res.status(500).json({ ok: false, error: 'server_error', message: e?.message || 'board_failed' });
      }
    });
    app.get('/api/admin/health-center/faqs', platformAdminRequired, (_req, res) => {
      return res.json({ ok: true, faqs: listHealthFaqs() });
    });
    app.get('/api/admin/health-center/tenants/:tenantId', platformAdminRequired, async (req, res) => {
      try {
        const data = await getHealthCenterTenantDetail(pool, req.params.tenantId);
        return res.json(data);
      } catch (e) {
        console.error('[health-center] tenant detail failed:', e?.message || e);
        return res.status(500).json({ ok: false, error: 'server_error', message: e?.message || 'detail_failed' });
      }
    });
    app.post('/api/admin/health-center/scan', platformAdminRequired, async (req, res) => {
      try {
        const tenantIds = Array.isArray(req.body?.tenant_ids) ? req.body.tenant_ids : null;
        const data = await scanHealthCenter(pool, { tenantIds, date: req.body?.date });
        const synced = await syncIncidentsFromInspections(pool, { date: req.body?.date }).catch((e) => ({
          ok: false,
          error: e?.message || String(e),
        }));
        return res.json({ ...data, incidents_sync: synced });
      } catch (e) {
        console.error('[health-center] scan failed:', e?.message || e);
        return res.status(500).json({ ok: false, error: 'server_error', message: e?.message || 'scan_failed' });
      }
    });

    // Phase 2：分流队列 + 有限自愈
    app.post('/api/admin/health-center/incidents/sync', platformAdminRequired, async (req, res) => {
      try {
        const data = await syncIncidentsFromInspections(pool, {
          tenantId: req.body?.tenant_id,
          date: req.body?.date,
        });
        return res.json(data);
      } catch (e) {
        console.error('[health-center] incidents sync failed:', e?.message || e);
        return res.status(500).json({ ok: false, error: 'server_error', message: e?.message || 'sync_failed' });
      }
    });
    app.get('/api/admin/health-center/incidents', platformAdminRequired, async (req, res) => {
      try {
        const data = await listIncidents(pool, {
          queue: req.query?.queue,
          status: req.query?.status || 'open',
          tenantId: req.query?.tenant_id,
          limit: req.query?.limit,
        });
        return res.json(data);
      } catch (e) {
        console.error('[health-center] incidents list failed:', e?.message || e);
        return res.status(500).json({ ok: false, error: 'server_error', message: e?.message || 'list_failed' });
      }
    });
    app.get('/api/admin/health-center/heal-actions', platformAdminRequired, (_req, res) => {
      return res.json({ ok: true, actions: Object.values(HEAL_ACTIONS), queues: QUEUE_LABELS });
    });
    app.post('/api/admin/health-center/incidents/:id/ack', platformAdminRequired, async (req, res) => {
      try {
        const data = await ackIncident(pool, req.params.id, { note: req.body?.note });
        return res.status(data.ok ? 200 : 404).json(data);
      } catch (e) {
        console.error('[health-center] ack failed:', e?.message || e);
        return res.status(500).json({ ok: false, error: 'server_error' });
      }
    });
    app.post('/api/admin/health-center/incidents/:id/resolve', platformAdminRequired, async (req, res) => {
      try {
        const data = await resolveIncident(pool, req.params.id, { note: req.body?.note });
        return res.status(data.ok ? 200 : 404).json(data);
      } catch (e) {
        console.error('[health-center] resolve failed:', e?.message || e);
        return res.status(500).json({ ok: false, error: 'server_error' });
      }
    });
    app.post('/api/admin/health-center/incidents/:id/escalate', platformAdminRequired, async (req, res) => {
      try {
        const data = await escalateIncident(pool, req.params.id, { note: req.body?.note });
        return res.status(data.ok ? 200 : 404).json(data);
      } catch (e) {
        console.error('[health-center] escalate failed:', e?.message || e);
        return res.status(500).json({ ok: false, error: 'server_error' });
      }
    });
    app.post('/api/admin/health-center/incidents/:id/heal', platformAdminRequired, async (req, res) => {
      try {
        const data = await healIncident(pool, req.params.id, { action: req.body?.action });
        return res.status(data.ok ? 200 : 400).json(data);
      } catch (e) {
        console.error('[health-center] heal failed:', e?.message || e);
        return res.status(500).json({ ok: false, error: 'server_error', message: e?.message || 'heal_failed' });
      }
    });
  }
}
