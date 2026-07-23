import { randomUUID } from 'crypto';
import { clearAgentConfigCache } from '../../agent-config-manager.js';
import {
  buildTenantLoginAccess,
  getTenantPlatformProfile,
  mergePlatformProfile,
  runTenantAcceptance,
  saveTenantPlatformAcceptanceReport,
  saveTenantPlatformProfile,
} from './helpers.js';
import { ensureTenantAgentCenterSeed } from './agent-center-seed.js';

/**
 * @param {import('express').Express} app
 * @param {object} deps
 */
export function registerTenantPlatformLifecycleRoutes(app, deps) {
  const {
    pool,
    platformAdminRequired,
    TENANT_INTEGRATION_ENCRYPTION_KEY,
    REQUIRED_TENANT_FEISHU_TABLE_KEYS,
  } = deps;

  const acceptanceOpts = {
    tenantIntegrationEncryptionKey: TENANT_INTEGRATION_ENCRYPTION_KEY,
    requiredTenantFeishuTableKeys: REQUIRED_TENANT_FEISHU_TABLE_KEYS,
  };

  app.post('/api/admin/tenants/:tenantId/license', platformAdminRequired, async (req, res) => {
    const tenantId = String(req.params.tenantId || '').trim();
    const expiresAt = req.body?.expires_at;
    if (!expiresAt) return res.status(400).json({ error: 'missing_expires_at' });
    const allowedFeatures = Array.isArray(req.body?.allowed_features) ? req.body.allowed_features : [];
    const maxStoresRaw = req.body?.max_stores;
    const maxStores = maxStoresRaw == null || maxStoresRaw === '' ? null : Number(maxStoresRaw);
    if (maxStores != null && (!Number.isFinite(maxStores) || maxStores < 0)) {
      return res.status(400).json({ error: 'invalid_max_stores' });
    }
    try {
      const exists = await pool.query('SELECT 1 FROM tenants WHERE tenant_id = $1', [tenantId]);
      if (!exists.rows.length) return res.status(404).json({ error: 'tenant_not_found' });
      const licenseKey = randomUUID();
      const r = await pool.query(
        `INSERT INTO licenses (tenant_id, license_key, expires_at, allowed_features, max_stores)
         VALUES ($1, $2, $3, $4, $5) RETURNING license_key, expires_at, status, max_stores`,
        [tenantId, licenseKey, expiresAt, JSON.stringify(allowedFeatures), maxStores]
      );
      return res.json({ ok: true, license: r.rows[0] });
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: e?.message || 'internal_error' });
    }
  });

  app.post('/api/admin/tenants/:tenantId/bootstrap', platformAdminRequired, async (req, res) => {
    const tenantId = String(req.params.tenantId || '').trim();
    try {
      const exists = await pool.query('SELECT tenant_id, name FROM tenants WHERE tenant_id = $1 LIMIT 1', [tenantId]);
      if (!exists.rows.length) return res.status(404).json({ error: 'tenant_not_found' });
      const current = await getTenantPlatformProfile(pool, tenantId, exists.rows[0].name);
      const next = mergePlatformProfile({
        ...current,
        system_name: current.system_name || exists.rows[0].name,
        page_title: current.page_title || `${exists.rows[0].name} 平台控制台`,
        feature_switches: {
          ...current.feature_switches,
          unified_template: true,
          auto_acceptance: true,
          failure_repair: true,
          tenant_alerts: true,
          billing: true,
          countdown: true,
        },
        template_switches: {
          ...current.template_switches,
          hrms: true,
          agent_v2: true,
          mini_program: true,
          feishu: true,
        },
      }, tenantId);
      await saveTenantPlatformProfile(pool, tenantId, next);
      await ensureTenantAgentCenterSeed(pool, tenantId, exists.rows[0].name);
      clearAgentConfigCache();
      const report = await runTenantAcceptance(pool, tenantId, acceptanceOpts);
      await saveTenantPlatformAcceptanceReport(pool, tenantId, {
        ...report,
        checked_at: new Date().toISOString(),
        action: 'bootstrap',
      });
      const login_access = await buildTenantLoginAccess(pool, req, tenantId);
      return res.json({
        ok: true,
        profile: next,
        report,
        message: report.ok ? '初始化完成' : '初始化完成，但部分检查项仍失败',
        login_access,
      });
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: e?.message || 'internal_error' });
    }
  });

  app.post('/api/admin/tenants/:tenantId/repair', platformAdminRequired, async (req, res) => {
    const tenantId = String(req.params.tenantId || '').trim();
    try {
      const exists = await pool.query('SELECT tenant_id FROM tenants WHERE tenant_id = $1 LIMIT 1', [tenantId]);
      if (!exists.rows.length) return res.status(404).json({ error: 'tenant_not_found' });
      const profile = await getTenantPlatformProfile(pool, tenantId);
      await saveTenantPlatformProfile(pool, tenantId, profile);
      const report = await runTenantAcceptance(pool, tenantId, acceptanceOpts);
      await saveTenantPlatformAcceptanceReport(pool, tenantId, {
        ...report,
        checked_at: new Date().toISOString(),
        action: 'repair',
      });
      return res.json({
        ok: report.ok,
        report,
        message: report.ok ? '修复校验通过' : '修复校验完成，但仍有检查项失败',
      });
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: e?.message || 'internal_error' });
    }
  });

  app.post('/api/admin/tenants/:tenantId/acceptance', platformAdminRequired, async (req, res) => {
    const tenantId = String(req.params.tenantId || '').trim();
    try {
      const report = await runTenantAcceptance(pool, tenantId, acceptanceOpts);
      const currentStatus = String(report?.tenant?.status || '').trim().toLowerCase();
      if (report.ok && req.body?.activate !== false) {
        await pool.query(`UPDATE tenants SET status = 'active', updated_at = NOW() WHERE tenant_id = $1`, [tenantId]);
        report.tenant = { ...(report.tenant || {}), status: 'active' };
      } else if (!report.ok && currentStatus !== 'active') {
        await pool.query(`UPDATE tenants SET status = 'provisioning', updated_at = NOW() WHERE tenant_id = $1`, [tenantId]);
        report.tenant = { ...(report.tenant || {}), status: 'provisioning' };
      }
      await saveTenantPlatformAcceptanceReport(pool, tenantId, {
        ...report,
        checked_at: new Date().toISOString(),
        action: 'acceptance',
      });
      return res.json({ ok: report.ok, report });
    } catch (e) {
      return res.status(500).json({ error: e?.message || 'internal_error' });
    }
  });
}
