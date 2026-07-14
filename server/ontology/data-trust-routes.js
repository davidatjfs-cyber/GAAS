/**
 * Data Trust Engine 路由：查询可信度记录+冲突台账。
 * 记录数据可信度评分本身(recordDataQuality)由各业务数据入口调用，这里先只提供查询能力，
 * 各业务模块(打卡/培训/库存等)接入调用时机是下一步，不在本次范围内。
 */
import { listConflictRules, getUsagePolicy } from './data-trust-service.js';

export function registerDataTrustRoutes(app, pool, authRequired, platformAdminRequired) {
  app.get('/api/ontology/data-trust/conflict-rules', authRequired, async (_req, res) => {
    res.json({ ok: true, rules: listConflictRules() });
  });

  app.get('/api/ontology/data-trust/records', authRequired, async (req, res) => {
    try {
      const storeId = String(req.query?.store_id || '').trim();
      const params = [];
      let where = '1=1';
      if (storeId) { params.push(storeId); where += ` AND store_id = $${params.length}`; }
      const r = await pool.query(
        `SELECT * FROM growth_ontology_data_quality WHERE ${where} ORDER BY created_at DESC LIMIT 200`,
        params
      );
      res.json({ ok: true, records: (r.rows || []).map((row) => ({ ...row, usage_policy: getUsagePolicy(Number(row.trust_score)) })) });
    } catch (e) {
      console.error('[data-trust] records query failed:', e?.message || e);
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  if (!platformAdminRequired) return;

  app.get('/api/admin/ontology/data-trust/conflicts', platformAdminRequired, async (_req, res) => {
    try {
      const r = await pool.query(
        `SELECT * FROM growth_ontology_data_quality WHERE conflict_flag = TRUE AND review_status = 'pending' ORDER BY created_at DESC LIMIT 200`
      );
      res.json({ ok: true, conflicts: r.rows || [] });
    } catch (e) {
      console.error('[data-trust] conflicts query failed:', e?.message || e);
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.post('/api/admin/ontology/data-trust/:id/review', platformAdminRequired, async (req, res) => {
    try {
      const status = String(req.body?.review_status || '').trim();
      if (!['approved', 'rejected'].includes(status)) return res.status(400).json({ ok: false, error: 'invalid_review_status' });
      const r = await pool.query(
        `UPDATE growth_ontology_data_quality SET review_status=$2, reviewer=$3, verified_at=NOW(), updated_at=NOW() WHERE id=$1 RETURNING *`,
        [req.params.id, status, req.platformAdmin?.username || 'platform_admin']
      );
      if (!r.rows?.[0]) return res.status(404).json({ ok: false, error: 'not_found' });
      res.json({ ok: true, record: r.rows[0] });
    } catch (e) {
      console.error('[data-trust] review failed:', e?.message || e);
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });
}
