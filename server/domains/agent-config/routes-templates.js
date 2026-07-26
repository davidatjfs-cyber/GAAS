/**
 * Agent prompt-template admin routes (P4 peel from agent-config-manager.js).
 */
import { assertAdmin, tenantIdFromReq } from './route-helpers.js';

/**
 * @param {import('express').Express} app
 * @param {(req,res,next)=>void} authRequired
 * @param {{ pool: () => { query: Function } }} deps
 */
export function registerAgentTemplateRoutes(app, authRequired, deps) {
  const { pool } = deps;

  app.get('/api/admin/agents/templates', authRequired, async (req, res) => {
    if (!assertAdmin(req, res)) return;
    const agentId = String(req.query?.agent_id || '').trim();
    try {
      if (agentId) {
        const r = await pool().query(
          `select * from agent_prompt_templates where agent_id = $1 and tenant_id = $2 order by is_builtin desc, updated_at desc`,
          [agentId, tenantIdFromReq(req)]
        );
        return res.json({ templates: r.rows });
      }
      const r = await pool().query(
        'select * from agent_prompt_templates where tenant_id = $1 order by agent_id, is_builtin desc, updated_at desc',
        [tenantIdFromReq(req)]
      );
      return res.json({ templates: r.rows });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/admin/agents/templates', authRequired, async (req, res) => {
    if (!assertAdmin(req, res)) return;
    const agentId = String(req.body?.agent_id || '').trim();
    const name = String(req.body?.name || '').trim();
    const content = String(req.body?.content || '').trim();
    const enabled = req.body?.enabled !== false;
    if (!agentId || !name || !content) return res.status(400).json({ error: 'missing_params' });
    try {
      const key = `custom_${agentId}_${Date.now()}`;
      const r = await pool().query(
        `insert into agent_prompt_templates (template_key, agent_id, name, content, enabled, is_builtin, tenant_id)
         values ($1, $2, $3, $4, $5, false, $6)
         returning *`,
        [key, agentId, name, content, enabled, tenantIdFromReq(req)]
      );
      return res.json({ template: r.rows[0] });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  });

  app.put('/api/admin/agents/templates/:id', authRequired, async (req, res) => {
    if (!assertAdmin(req, res)) return;
    const id = String(req.params?.id || '').trim();
    if (!id) return res.status(400).json({ error: 'missing_id' });
    try {
      const tenantIdQ = tenantIdFromReq(req);
      const old = await pool().query('select * from agent_prompt_templates where id = $1 and tenant_id = $2 limit 1', [id, tenantIdQ]);
      if (!old.rows?.length) return res.status(404).json({ error: 'not_found' });
      const row = old.rows[0];

      if (row.is_builtin) {
        const enabled2 = req.body?.enabled === undefined ? row.enabled : !!req.body.enabled;
        const name2 = String(req.body?.name || row.name).trim() || row.name;
        const r = await pool().query(
          `update agent_prompt_templates set name = $1, enabled = $2, updated_at = now() where id = $3 and tenant_id = $4 returning *`,
          [name2, enabled2, id, tenantIdQ]
        );
        return res.json({ template: r.rows[0], locked_content: true });
      }

      const name2 = String(req.body?.name || row.name).trim() || row.name;
      const content2 = String(req.body?.content || row.content).trim() || row.content;
      const enabled2 = req.body?.enabled === undefined ? row.enabled : !!req.body.enabled;
      const r = await pool().query(
        `update agent_prompt_templates set name = $1, content = $2, enabled = $3, updated_at = now() where id = $4 and tenant_id = $5 returning *`,
        [name2, content2, enabled2, id, tenantIdQ]
      );
      return res.json({ template: r.rows[0] });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  });

  app.delete('/api/admin/agents/templates/:id', authRequired, async (req, res) => {
    if (!assertAdmin(req, res)) return;
    const id = String(req.params?.id || '').trim();
    if (!id) return res.status(400).json({ error: 'missing_id' });
    try {
      const tenantIdQ = tenantIdFromReq(req);
      const old = await pool().query('select * from agent_prompt_templates where id = $1 and tenant_id = $2 limit 1', [id, tenantIdQ]);
      if (!old.rows?.length) return res.status(404).json({ error: 'not_found' });
      if (old.rows[0].is_builtin) return res.status(400).json({ error: 'builtin_template_cannot_delete' });

      const used = await pool().query('select count(*)::int as c from agent_configs where prompt_template_id = $1 and tenant_id = $2', [id, tenantIdQ]);
      if (Number(used.rows?.[0]?.c || 0) > 0) return res.status(400).json({ error: 'template_in_use' });

      await pool().query('delete from agent_prompt_templates where id = $1 and tenant_id = $2', [id, tenantIdQ]);
      return res.json({ ok: true });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  });
}
