/**
 * HR / BI / Ops domain-config admin routes (P4 peel from agent-config-manager.js).
 */
import { assertAdmin } from './route-helpers.js';

/**
 * @param {import('express').Express} app
 * @param {(req,res,next)=>void} authRequired
 * @param {object} deps
 */
export function registerAgentDomainConfigRoutes(app, authRequired, deps) {
  const {
    pool,
    log,
    toJson,
    DEFAULT_EMPLOYEE_RATING_CONFIG,
    DEFAULT_BI_AGENT_CONFIG,
    DEFAULT_OPS_AGENT_CONFIG,
    normalizeEmployeeRatingConfig,
    validateEmployeeRatingConfig,
    normalizeBiAgentConfig,
    normalizeOpsAgentConfig,
    clearEmployeeRatingConfigCache,
    clearBiAgentConfigCache,
    clearOpsAgentConfigCache,
    resolveTenantIdDefault,
    isHrmsAgentV1Enabled,
    reloadScheduledTasks,
  } = deps;

  app.get('/api/admin/hr/employee-rating-config', authRequired, async (req, res) => {
    if (!assertAdmin(req, res)) return;
    try {
      const r = await pool().query(`
        select config, enabled, updated_at
        from hr_rating_configs
        where config_key = 'employee_rating'
        limit 1
      `);
      const row = r.rows?.[0];
      const config = row?.config ? toJson(row.config, DEFAULT_EMPLOYEE_RATING_CONFIG) : DEFAULT_EMPLOYEE_RATING_CONFIG;
      return res.json({ config, enabled: row?.enabled !== false, updated_at: row?.updated_at || null });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  });

  app.put('/api/admin/hr/employee-rating-config', authRequired, async (req, res) => {
    if (!assertAdmin(req, res)) return;
    const config = req.body?.config;
    const enabled2 = req.body?.enabled !== false;
    if (!validateEmployeeRatingConfig(config)) return res.status(400).json({ error: 'invalid_config' });
    const normalizedConfig = normalizeEmployeeRatingConfig(config);
    try {
      const r = await pool().query(
        `insert into hr_rating_configs (config_key, config, enabled, updated_at, tenant_id)
         values ('employee_rating', $1::jsonb, $2, now(), $3)
         on conflict (config_key, tenant_id)
         do update set config = excluded.config, enabled = excluded.enabled, updated_at = now()
         returning config, enabled, updated_at`,
        [JSON.stringify(normalizedConfig), enabled2, resolveTenantIdDefault()]
      );
      clearEmployeeRatingConfigCache();
      return res.json({ ok: true, config: toJson(r.rows?.[0]?.config, normalizedConfig), enabled: r.rows?.[0]?.enabled !== false });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/admin/agents/bi-config', authRequired, async (req, res) => {
    if (!assertAdmin(req, res)) return;
    try {
      const r = await pool().query(`
        select config, enabled, updated_at
        from hr_rating_configs
        where config_key = 'bi_agent'
        limit 1
      `);
      const row = r.rows?.[0];
      const config = normalizeBiAgentConfig(row?.config ? toJson(row.config, DEFAULT_BI_AGENT_CONFIG) : DEFAULT_BI_AGENT_CONFIG);
      return res.json({ config, enabled: row?.enabled !== false, updated_at: row?.updated_at || null });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  });

  app.put('/api/admin/agents/bi-config', authRequired, async (req, res) => {
    if (!assertAdmin(req, res)) return;
    const config = normalizeBiAgentConfig(req.body?.config);
    const enabled2 = req.body?.enabled !== false;
    if (!config || typeof config !== 'object') return res.status(400).json({ error: 'invalid_config' });
    try {
      const r = await pool().query(
        `insert into hr_rating_configs (config_key, config, enabled, updated_at, tenant_id)
         values ('bi_agent', $1::jsonb, $2, now(), $3)
         on conflict (config_key, tenant_id)
         do update set config = excluded.config, enabled = excluded.enabled, updated_at = now()
         returning config, enabled, updated_at`,
        [JSON.stringify(config), enabled2, resolveTenantIdDefault()]
      );
      clearBiAgentConfigCache();
      return res.json({ config: r.rows[0].config, enabled: r.rows[0].enabled, updated_at: r.rows[0].updated_at });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/admin/agents/ops-config', authRequired, async (req, res) => {
    if (!assertAdmin(req, res)) return;
    try {
      const r = await pool().query(`
        select config, enabled, updated_at
        from hr_rating_configs
        where config_key = 'ops_agent'
        limit 1
      `);
      const row = r.rows?.[0];
      const config = normalizeOpsAgentConfig(row?.config ? toJson(row.config, DEFAULT_OPS_AGENT_CONFIG) : DEFAULT_OPS_AGENT_CONFIG);
      return res.json({ config, enabled: row?.enabled !== false, updated_at: row?.updated_at || null });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  });

  app.put('/api/admin/agents/ops-config', authRequired, async (req, res) => {
    if (!assertAdmin(req, res)) return;
    const config = normalizeOpsAgentConfig(req.body?.config);
    const enabled2 = req.body?.enabled !== false;
    if (!config || typeof config !== 'object') return res.status(400).json({ error: 'invalid_config' });
    try {
      const r = await pool().query(
        `insert into hr_rating_configs (config_key, config, enabled, updated_at, tenant_id)
         values ('ops_agent', $1::jsonb, $2, now(), $3)
         on conflict (config_key, tenant_id)
         do update set config = excluded.config, enabled = excluded.enabled, updated_at = now()
         returning config, enabled, updated_at`,
        [JSON.stringify(config), enabled2, resolveTenantIdDefault()]
      );
      clearOpsAgentConfigCache();
      if (isHrmsAgentV1Enabled()) {
        try {
          await reloadScheduledTasks();
        } catch (runtimeErr) {
          log.error({ msg: 'ops_config_scheduler_reload_failed', err: runtimeErr?.message || runtimeErr });
        }
      } else {
        log.info({ msg: 'ops_config_hrms_agent_v1_enabled_true_startscheduledtasks' });
      }
      return res.json({ config: r.rows[0].config, enabled: r.rows[0].enabled, updated_at: r.rows[0].updated_at });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  });
}
