import { clearAgentConfigCache } from '../../agent-config-manager.js';
import {
  ensureTenantAgentCenterReady,
  normalizeAgentModelName,
  normalizeAgentScheduleInterval,
  normalizeAgentTemperature,
} from './agent-center-seed.js';

async function createTenantAgentTemplate(pool, kind, tenantId, body) {
  const agentId = String(body?.agent_id || '').trim();
  const name = String(body?.name || '').trim();
  const content = String(body?.content || '').trim();
  const enabled = body?.enabled !== false;
  if (!agentId || !name || !content) {
    const err = new Error('missing_params');
    err.statusCode = 400;
    throw err;
  }
  const keyPrefix = kind === 'reply' ? 'tenant_reply' : 'tenant_prompt';
  const table = kind === 'reply' ? 'agent_reply_templates' : 'agent_prompt_templates';
  const key = `${keyPrefix}_${agentId}_${Date.now()}`;
  const r = await pool.query(
    `INSERT INTO ${table} (template_key, agent_id, name, content, enabled, is_builtin, tenant_id)
       VALUES ($1, $2, $3, $4, $5, false, $6)
       RETURNING *`,
    [key, agentId, name, content, enabled, tenantId]
  );
  return r.rows[0];
}

async function updateTenantAgentTemplate(pool, kind, tenantId, id, body) {
  const table = kind === 'reply' ? 'agent_reply_templates' : 'agent_prompt_templates';
  const old = await pool.query(`SELECT * FROM ${table} WHERE id = $1 AND tenant_id = $2 LIMIT 1`, [id, tenantId]);
  if (!old.rows?.length) {
    const err = new Error('template_not_found');
    err.statusCode = 404;
    throw err;
  }
  const row = old.rows[0];
  const name = String(body?.name ?? row.name).trim() || row.name;
  const enabled = body?.enabled === undefined ? !!row.enabled : !!body.enabled;
  if (row.is_builtin) {
    const r = await pool.query(
      `UPDATE ${table} SET name = $1, enabled = $2, updated_at = NOW() WHERE id = $3 AND tenant_id = $4 RETURNING *`,
      [name, enabled, id, tenantId]
    );
    return { template: r.rows[0], locked_content: true };
  }
  const content = String(body?.content ?? row.content).trim() || row.content;
  const r = await pool.query(
    `UPDATE ${table} SET name = $1, content = $2, enabled = $3, updated_at = NOW() WHERE id = $4 AND tenant_id = $5 RETURNING *`,
    [name, content, enabled, id, tenantId]
  );
  return { template: r.rows[0] };
}

async function deleteTenantAgentTemplate(pool, kind, tenantId, id) {
  const table = kind === 'reply' ? 'agent_reply_templates' : 'agent_prompt_templates';
  const old = await pool.query(`SELECT * FROM ${table} WHERE id = $1 AND tenant_id = $2 LIMIT 1`, [id, tenantId]);
  if (!old.rows?.length) {
    const err = new Error('template_not_found');
    err.statusCode = 404;
    throw err;
  }
  if (old.rows[0].is_builtin) {
    const err = new Error('builtin_template_cannot_delete');
    err.statusCode = 400;
    throw err;
  }
  const usedTable = kind === 'reply' ? 'reply_template_id' : 'prompt_template_id';
  const used = await pool.query(`SELECT COUNT(*)::int AS c FROM agent_configs WHERE ${usedTable} = $1 AND tenant_id = $2`, [id, tenantId]);
  if (Number(used.rows?.[0]?.c || 0) > 0) {
    const err = new Error('template_in_use');
    err.statusCode = 400;
    throw err;
  }
  await pool.query(`DELETE FROM ${table} WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
  return { ok: true };
}

/**
 * @param {import('express').Express} app
 * @param {object} deps
 */
export function registerTenantPlatformAgentCenterRoutes(app, deps) {
  const { pool, platformAdminRequired } = deps;

  app.get('/api/admin/tenants/:tenantId/agent-center', platformAdminRequired, async (req, res) => {
    const tenantId = String(req.params.tenantId || '').trim();
    if (!tenantId) return res.status(400).json({ error: 'missing_tenant_id' });
    try {
      const exists = await pool.query('SELECT tenant_id, name FROM tenants WHERE tenant_id = $1 LIMIT 1', [tenantId]);
      if (!exists.rows.length) return res.status(404).json({ error: 'tenant_not_found' });
      const data = await ensureTenantAgentCenterReady(pool, tenantId, exists.rows[0].name);
      return res.json({
        ok: true,
        tenant: exists.rows[0],
        ...data,
        summary: {
          configs: data.configs.length,
          prompt_templates: data.prompt_templates.length,
          reply_templates: data.reply_templates.length,
          enabled_configs: data.configs.filter((row) => row.enabled !== false).length,
        }
      });
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: e?.message || 'internal_error' });
    }
  });

  app.put('/api/admin/tenants/:tenantId/agent-center/configs/:agentId', platformAdminRequired, async (req, res) => {
    const tenantId = String(req.params.tenantId || '').trim();
    const agentId = String(req.params.agentId || '').trim();
    if (!tenantId || !agentId) return res.status(400).json({ error: 'missing_params' });
    try {
      const existing = await pool.query(
        `SELECT *
           FROM agent_configs
          WHERE tenant_id = $1 AND agent_id = $2
          LIMIT 1`,
        [tenantId, agentId]
      );
      if (!existing.rows.length) return res.status(404).json({ error: 'config_not_found' });
      const body = req.body || {};
      const nextSystemPrompt = Object.prototype.hasOwnProperty.call(body, 'system_prompt')
        ? String(body.system_prompt || '').trim()
        : existing.rows[0].system_prompt || '';
      const hasPromptTemplateId = Object.prototype.hasOwnProperty.call(body, 'prompt_template_id');
      const hasReplyTemplateId = Object.prototype.hasOwnProperty.call(body, 'reply_template_id');
      const promptTemplateId = hasPromptTemplateId ? (String(body.prompt_template_id || '').trim() || null) : existing.rows[0].prompt_template_id || null;
      const replyTemplateId = hasReplyTemplateId ? (String(body.reply_template_id || '').trim() || null) : existing.rows[0].reply_template_id || null;
      const r = await pool.query(
        `UPDATE agent_configs
            SET system_prompt = $1,
                model_name = $2,
                temperature = $3,
                enabled = $4,
                schedule_interval = $5,
                prompt_template_id = $6,
                reply_template_id = $7,
                updated_at = NOW()
          WHERE tenant_id = $8 AND agent_id = $9
          RETURNING *`,
        [
          nextSystemPrompt,
          normalizeAgentModelName(body.model_name, existing.rows[0].model_name || 'qwen-plus'),
          normalizeAgentTemperature(body.temperature, Number(existing.rows[0].temperature ?? 0.1)),
          body.enabled === undefined ? !!existing.rows[0].enabled : !!body.enabled,
          normalizeAgentScheduleInterval(body.schedule_interval, Number(existing.rows[0].schedule_interval ?? 30)),
          promptTemplateId,
          replyTemplateId,
          tenantId,
          agentId
        ]
      );
      clearAgentConfigCache();
      return res.json({ ok: true, config: r.rows[0] });
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: e?.message || 'internal_error' });
    }
  });

  app.post('/api/admin/tenants/:tenantId/agent-center/templates/prompt', platformAdminRequired, async (req, res) => {
    const tenantId = String(req.params.tenantId || '').trim();
    try {
      const template = await createTenantAgentTemplate(pool, 'prompt', tenantId, req.body || {});
      clearAgentConfigCache();
      return res.json({ ok: true, template });
    } catch (e) {
      return res.status(e.statusCode || 500).json({ error: e.message || 'internal_error' });
    }
  });

  app.put('/api/admin/tenants/:tenantId/agent-center/templates/prompt/:id', platformAdminRequired, async (req, res) => {
    const tenantId = String(req.params.tenantId || '').trim();
    const id = String(req.params.id || '').trim();
    try {
      const result = await updateTenantAgentTemplate(pool, 'prompt', tenantId, id, req.body || {});
      clearAgentConfigCache();
      return res.json({ ok: true, ...result });
    } catch (e) {
      return res.status(e.statusCode || 500).json({ error: e.message || 'internal_error' });
    }
  });

  app.delete('/api/admin/tenants/:tenantId/agent-center/templates/prompt/:id', platformAdminRequired, async (req, res) => {
    const tenantId = String(req.params.tenantId || '').trim();
    const id = String(req.params.id || '').trim();
    try {
      const result = await deleteTenantAgentTemplate(pool, 'prompt', tenantId, id);
      clearAgentConfigCache();
      return res.json(result);
    } catch (e) {
      return res.status(e.statusCode || 500).json({ error: e.message || 'internal_error' });
    }
  });

  app.post('/api/admin/tenants/:tenantId/agent-center/templates/reply', platformAdminRequired, async (req, res) => {
    const tenantId = String(req.params.tenantId || '').trim();
    try {
      const template = await createTenantAgentTemplate(pool, 'reply', tenantId, req.body || {});
      clearAgentConfigCache();
      return res.json({ ok: true, template });
    } catch (e) {
      return res.status(e.statusCode || 500).json({ error: e.message || 'internal_error' });
    }
  });

  app.put('/api/admin/tenants/:tenantId/agent-center/templates/reply/:id', platformAdminRequired, async (req, res) => {
    const tenantId = String(req.params.tenantId || '').trim();
    const id = String(req.params.id || '').trim();
    try {
      const result = await updateTenantAgentTemplate(pool, 'reply', tenantId, id, req.body || {});
      clearAgentConfigCache();
      return res.json({ ok: true, ...result });
    } catch (e) {
      return res.status(e.statusCode || 500).json({ error: e.message || 'internal_error' });
    }
  });

  app.delete('/api/admin/tenants/:tenantId/agent-center/templates/reply/:id', platformAdminRequired, async (req, res) => {
    const tenantId = String(req.params.tenantId || '').trim();
    const id = String(req.params.id || '').trim();
    try {
      const result = await deleteTenantAgentTemplate(pool, 'reply', tenantId, id);
      clearAgentConfigCache();
      return res.json(result);
    } catch (e) {
      return res.status(e.statusCode || 500).json({ error: e.message || 'internal_error' });
    }
  });

  // 托管控制台（agents-admin）专用：按 tenantId 路径参数读取门店列表，不依赖登录租户的 JWT。
  app.get('/api/admin/tenants/:tenantId/stores', platformAdminRequired, async (req, res) => {
    try {
      const r = await pool.query('select data from hrms_state where key = $1 limit 1', [req.params.tenantId || 'default']);
      const row = r.rows?.[0] || null;
      const stateStores = Array.isArray(row?.data?.stores) ? row.data.stores : [];
      const items = stateStores.map(s => ({ id: s.id || s.name, name: s.name }));
      return res.json({ items });
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: e?.message });
    }
  });
}
