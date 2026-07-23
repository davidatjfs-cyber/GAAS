/**
 * Dedup stats & cleanup HTTP (Wave 4p — behavior-preserving extract from index.js).
 */

/**
 * @param {import('express').Express} app
 * @param {(req,res,next)=>void} authRequired
 * @param {{ pool: import('pg').Pool }} deps
 */
export function registerDedupRoutes(app, authRequired, deps) {
  const { pool } = deps;

  app.get('/api/dedup/stats', authRequired, async (req, res) => {
    const role = String(req.user?.role || '').trim();
    if (role !== 'admin') return res.status(403).json({ error: 'admin_only' });
    try {
      const tables = {};
      // agent_messages duplicates
      const am = await pool.query(`SELECT count(*) as cnt FROM (
      SELECT record_id, content_type, count(*) as c FROM agent_messages
      WHERE record_id IS NOT NULL AND record_id != '' AND tenant_id = $1
      GROUP BY record_id, content_type HAVING count(*) > 1) t`, [req.tenantId || req.user?.tenant_id || 'default']);
      tables.agent_messages_dup_groups = Number(am.rows[0]?.cnt || 0);
      // feishu_generic_records total
      const fg = await pool.query(`SELECT count(*) as cnt FROM feishu_generic_records`);
      tables.feishu_generic_records = Number(fg.rows[0]?.cnt || 0);
      // pos_sales_detail total(sales_raw已下线)
      const sr = await pool.query(`SELECT count(*) as cnt FROM pos_sales_detail`);
      tables.pos_sales_detail = Number(sr.rows[0]?.cnt || 0);
      // table_visit_records total
      const tv = await pool.query(`SELECT count(*) as cnt FROM table_visit_records`);
      tables.table_visit_records = Number(tv.rows[0]?.cnt || 0);
      return res.json({ ok: true, tables });
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: 'internal_error' });
    }
  });

  app.post('/api/dedup/cleanup', authRequired, async (req, res) => {
    const role = String(req.user?.role || '').trim();
    if (role !== 'admin') return res.status(403).json({ error: 'admin_only' });
    try {
      // Remove duplicate agent_messages (keep newest, tiebreak by id)
      const del = await pool.query(`
      DELETE FROM agent_messages a USING agent_messages b
      WHERE a.record_id IS NOT NULL AND a.record_id != ''
        AND a.record_id = b.record_id AND a.content_type = b.content_type
        AND a.tenant_id = b.tenant_id AND a.tenant_id = $1
        AND (a.created_at < b.created_at OR (a.created_at = b.created_at AND a.id < b.id))`, [req.tenantId || req.user?.tenant_id || 'default']);
      return res.json({ ok: true, deleted: del.rowCount || 0 });
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: 'internal_error' });
    }
  });
}
