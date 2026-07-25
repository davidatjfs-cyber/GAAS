/**
 * Tenant settings & chairman config proxy routes (Wave 4o — behavior-preserving extract from index.js).
 */
import { agentsOutboundHeaders } from '../shared/agents-service-auth.js';

function canManageChairmanConfig(user) {
  const role = String(user?.role || '').trim();
  return role === 'admin' || role === 'hq_manager' || role === 'hr_manager';
}

const TENANT_SETTINGS_ALLOWED_KEYS = new Set(['performance_eval', 'rhythm_schedule', 'daily_inspections', 'labor_cost_targets', 'random_inspections']);

function canManageTenantSettings(user) {
  const role = String(user?.role || '').trim();
  return role === 'admin' || role === 'hq_manager' || role === 'hr_manager';
}

/**
 * @param {import('express').Express} app
 * @param {(req,res,next)=>void} authRequired
 * @param {{
 *   axios: import('axios').default,
 *   getAgentsServiceBaseUrl: () => string,
 *   getAgentsServiceAdminToken: () => Promise<string>,
 * }} deps
 */
export function registerTenantSettingsRoutes(app, authRequired, deps) {
  const { axios, getAgentsServiceBaseUrl, getAgentsServiceAdminToken } = deps;

  async function agentsAuthHeaders(req, extra = {}) {
    const token = await getAgentsServiceAdminToken();
    return agentsOutboundHeaders(req, {
      Authorization: `Bearer ${token}`,
      ...extra,
    });
  }

  app.get('/api/chairman/config', authRequired, async (req, res) => {
    if (!canManageChairmanConfig(req.user)) return res.status(403).json({ error: 'forbidden' });
    try {
      const url = getAgentsServiceBaseUrl() + '/api/chairman/config';
      const r = await axios.get(url, {
        timeout: 8000,
        validateStatus: () => true,
        headers: await agentsAuthHeaders(req),
      });
      if (r.status < 200 || r.status >= 300) {
        return res.status(r.status || 502).json(r.data || { error: 'chairman_config_proxy_failed' });
      }
      return res.json(r.data || { ok: true, config: {} });
    } catch (e) {
      return res.status(502).json({ error: 'internal_error' });
    }
  });

  app.post('/api/chairman/config', authRequired, async (req, res) => {
    if (!canManageChairmanConfig(req.user)) return res.status(403).json({ error: 'forbidden' });
    try {
      const url = getAgentsServiceBaseUrl() + '/api/chairman/config';
      const r = await axios.post(url, req.body || {}, {
        timeout: 10000,
        validateStatus: () => true,
        headers: await agentsAuthHeaders(req, { 'Content-Type': 'application/json' }),
      });
      if (r.status < 200 || r.status >= 300) {
        return res.status(r.status || 502).json(r.data || { error: 'chairman_config_proxy_failed' });
      }
      return res.json(r.data || { ok: true });
    } catch (e) {
      return res.status(502).json({ error: 'internal_error' });
    }
  });

  // ─── 目标管理：通用KPI目标（门店/品牌/公司级，任意metric_key），供"任务和绩效"页面增删改 ───
  // 必须注册在 /api/tenant-settings/:key 之前，否则会被 :key 抢先匹配成 unknown_settings_key → HTTP 400。
  // 复用agents-service-v2既有的/api/kpi/targets CRUD（kpi_targets表已tenant_id隔离）。
  app.get('/api/tenant-settings/kpi-targets', authRequired, async (req, res) => {
    if (!canManageTenantSettings(req.user)) return res.status(403).json({ error: 'forbidden' });
    try {
      const qs = new URLSearchParams();
      ['store', 'brand', 'metric_key'].forEach(k => { if (req.query?.[k]) qs.set(k, String(req.query[k])); });
      const url = getAgentsServiceBaseUrl() + '/api/kpi/targets' + (qs.toString() ? `?${qs}` : '');
      const r = await axios.get(url, {
        timeout: 8000,
        validateStatus: () => true,
        headers: await agentsAuthHeaders(req),
      });
      if (r.status < 200 || r.status >= 300) return res.status(r.status || 502).json(r.data || { error: 'kpi_targets_proxy_failed' });
      return res.json(r.data || { targets: [] });
    } catch (e) {
      return res.status(502).json({ error: 'internal_error' });
    }
  });

  app.put('/api/tenant-settings/kpi-targets', authRequired, async (req, res) => {
    if (!canManageTenantSettings(req.user)) return res.status(403).json({ error: 'forbidden' });
    try {
      const url = getAgentsServiceBaseUrl() + '/api/kpi/targets';
      const r = await axios.put(url, req.body || {}, {
        timeout: 8000,
        validateStatus: () => true,
        headers: await agentsAuthHeaders(req, { 'Content-Type': 'application/json' }),
      });
      if (r.status < 200 || r.status >= 300) return res.status(r.status || 502).json(r.data || { error: 'kpi_targets_proxy_failed' });
      return res.json(r.data || { ok: true });
    } catch (e) {
      return res.status(502).json({ error: 'internal_error' });
    }
  });

  app.delete('/api/tenant-settings/kpi-targets/:id', authRequired, async (req, res) => {
    if (!canManageTenantSettings(req.user)) return res.status(403).json({ error: 'forbidden' });
    try {
      const url = getAgentsServiceBaseUrl() + '/api/kpi/targets/' + encodeURIComponent(req.params.id);
      const r = await axios.delete(url, {
        timeout: 8000,
        validateStatus: () => true,
        headers: await agentsAuthHeaders(req),
      });
      if (r.status < 200 || r.status >= 300) return res.status(r.status || 502).json(r.data || { error: 'kpi_targets_proxy_failed' });
      return res.json(r.data || { ok: true });
    } catch (e) {
      return res.status(502).json({ error: 'internal_error' });
    }
  });

  app.get('/api/tenant-settings/:key', authRequired, async (req, res) => {
    if (!canManageTenantSettings(req.user)) return res.status(403).json({ error: 'forbidden' });
    const key = String(req.params.key || '').trim();
    if (!TENANT_SETTINGS_ALLOWED_KEYS.has(key)) return res.status(400).json({ error: 'unknown_settings_key' });
    try {
      const url = getAgentsServiceBaseUrl() + '/api/config/' + encodeURIComponent(key);
      const r = await axios.get(url, {
        timeout: 8000,
        validateStatus: () => true,
        headers: await agentsAuthHeaders(req),
      });
      if (r.status < 200 || r.status >= 300) return res.status(r.status || 502).json(r.data || { error: 'tenant_settings_proxy_failed' });
      return res.json(r.data || { config_key: key, config_value: null });
    } catch (e) {
      return res.status(502).json({ error: 'internal_error' });
    }
  });

  app.put('/api/tenant-settings/:key', authRequired, async (req, res) => {
    if (!canManageTenantSettings(req.user)) return res.status(403).json({ error: 'forbidden' });
    const key = String(req.params.key || '').trim();
    if (!TENANT_SETTINGS_ALLOWED_KEYS.has(key)) return res.status(400).json({ error: 'unknown_settings_key' });
    const { config_value, description } = req.body || {};
    if (config_value === undefined) return res.status(400).json({ error: 'config_value is required' });
    try {
      const url = getAgentsServiceBaseUrl() + '/api/config/' + encodeURIComponent(key);
      const r = await axios.put(url, { config_value, description }, {
        timeout: 8000,
        validateStatus: () => true,
        headers: await agentsAuthHeaders(req, { 'Content-Type': 'application/json' }),
      });
      if (r.status < 200 || r.status >= 300) return res.status(r.status || 502).json(r.data || { error: 'tenant_settings_proxy_failed' });
      return res.json(r.data || { ok: true });
    } catch (e) {
      return res.status(502).json({ error: 'internal_error' });
    }
  });
}
