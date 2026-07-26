/**
 * Agent rules CRUD admin routes (P4 peel from agent-config-manager.js).
 */
import { assertAdmin, tenantIdFromReq } from './route-helpers.js';

/**
 * @param {import('express').Express} app
 * @param {(req,res,next)=>void} authRequired
 * @param {{ pool: () => { query: Function }, clearAgentRuleCache: () => void }} deps
 */
export function registerAgentRulesRoutes(app, authRequired, deps) {
  const { pool, clearAgentRuleCache } = deps;

  app.get('/api/admin/agents/rules', authRequired, async (req, res) => {
    if (!assertAdmin(req, res)) return;
    try {
      const r = await pool().query(
        'select * from agent_rules where tenant_id = $1 order by enabled desc, updated_at desc',
        [tenantIdFromReq(req)]
      );
      res.json({ rules: r.rows });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.put('/api/admin/agents/rules/:id', authRequired, async (req, res) => {
    if (!assertAdmin(req, res)) return;
    const id = req.params.id;
    const { category, assignee_role, normal_deduction, major_deduction, enabled } = req.body;
    try {
      const r = await pool().query(`
        update agent_rules
        set category = $1, assignee_role = $2, normal_deduction = $3, major_deduction = $4, enabled = $5, updated_at = now()
        where id = $6 and tenant_id = $7 returning *
      `, [category, assignee_role, normal_deduction, major_deduction, enabled, id, tenantIdFromReq(req)]);
      clearAgentRuleCache();
      res.json({ rule: r.rows[0] });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/admin/agents/rules', authRequired, async (req, res) => {
    if (!assertAdmin(req, res)) return;
    const { category, assignee_role, normal_deduction, major_deduction, enabled } = req.body;
    try {
      const r = await pool().query(`
        insert into agent_rules (category, assignee_role, normal_deduction, major_deduction, enabled, tenant_id)
        values ($1, $2, $3, $4, $5, $6) returning *
      `, [category, assignee_role, normal_deduction, major_deduction, enabled !== false, tenantIdFromReq(req)]);
      clearAgentRuleCache();
      res.json({ rule: r.rows[0] });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.delete('/api/admin/agents/rules/:id', authRequired, async (req, res) => {
    if (!assertAdmin(req, res)) return;
    const id = req.params.id;
    try {
      await pool().query('delete from agent_rules where id = $1 and tenant_id = $2', [id, tenantIdFromReq(req)]);
      clearAgentRuleCache();
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // 角色模块权限：唯一权威为 domains/flow-config（GET/PUT /api/role-modules）。
  // 此处不再注册影子 GET /api/role-modules 与 PUT /api/admin/role-modules，避免双写/无镜像。
}
