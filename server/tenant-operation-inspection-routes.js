import {
  getLatestOverview,
  runInspection,
  listInspectionItems,
  generateInspectionReport,
  generateRecoveryTask,
  generateRecoveryTasksBatch,
  getInspectionTrends,
} from './services/tenant-operation-inspection-service.js';
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
      return res.json({
        ok: true,
        ...generateInspectionReport({
          tenantId: tenantIdFrom(req),
          overview: result.overview,
          store_results: result.store_results,
          items: result.items,
        }),
      });
    } catch (e) {
      console.error('[tenant-inspection] report failed:', e?.message || e);
      return res.status(500).json({ ok: false, error: 'server_error' });
    }
  };

  const generateTask = async (req, res) => {
    try {
      const result = await generateRecoveryTask(pool, { itemId: req.params.id });
      return res.json(result);
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
      return res.json(result);
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
  return { overview, run, items, report, generateTask, generateTasksBatch, trends };
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
  app.post('/api/tenant-inspection/generate-report', authRequired, requireTenantInspectionRole, h.report);
  app.post('/api/tenant-inspection/items/:id/generate-task', authRequired, requireTenantInspectionRole, h.generateTask);
  app.post('/api/tenant-inspection/generate-tasks-batch', authRequired, requireTenantInspectionRole, h.generateTasksBatch);

  if (platformAdminRequired) {
    app.get('/api/admin/tenants/:tenantId/tenant-inspection/overview', platformAdminRequired, platformTenantMiddleware, h.overview);
    app.post('/api/admin/tenants/:tenantId/tenant-inspection/run', platformAdminRequired, platformTenantMiddleware, h.run);
    app.get('/api/admin/tenants/:tenantId/tenant-inspection/items', platformAdminRequired, platformTenantMiddleware, h.items);
    app.get('/api/admin/tenants/:tenantId/tenant-inspection/trends', platformAdminRequired, platformTenantMiddleware, h.trends);
    app.post('/api/admin/tenants/:tenantId/tenant-inspection/generate-report', platformAdminRequired, platformTenantMiddleware, h.report);
    app.post('/api/admin/tenants/:tenantId/tenant-inspection/items/:id/generate-task', platformAdminRequired, platformTenantMiddleware, h.generateTask);
    app.post('/api/admin/tenants/:tenantId/tenant-inspection/generate-tasks-batch', platformAdminRequired, platformTenantMiddleware, h.generateTasksBatch);
  }
}
