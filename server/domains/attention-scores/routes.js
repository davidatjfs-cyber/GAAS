/**
 * Attention scores HTTP routes (Wave 4n — behavior-preserving extract from index.js).
 */
import { childLogger } from '../../utils/logger.js';

const log = childLogger({ domain: 'attention-scores', handler: 'routes' });

export function registerAttentionScoresRoutes(app, authRequired, deps) {
  const { pool, getSharedState, resolveTenantIdDefault } = deps;

  // 保存专注度分数
  app.post('/api/attention-scores', authRequired, async (req, res) => {
    try {
      const username = String(req.user?.username || '').trim();
      if (!username) return res.status(400).json({ error: 'missing_user' });

      const materialId = String(req.body?.materialId || '').trim();
      const materialTitle = String(req.body?.materialTitle || '').trim();
      const score = Math.max(0, Math.min(100, Number(req.body?.score) || 0));
      const durationSeconds = Math.max(0, Number(req.body?.durationSeconds) || 0);
      const totalSamples = Math.max(0, Number(req.body?.totalSamples) || 0);
      const attentiveSamples = Math.max(0, Number(req.body?.attentiveSamples) || 0);
      const avgScore = Math.max(0, Math.min(100, Number(req.body?.avgScore) || 0));

      if (!materialId) return res.status(400).json({ error: 'missing_material_id' });

      // 获取用户姓名和门店
      const state = (await getSharedState()) || {};
      const users = Array.isArray(state.users) ? state.users : [];
      const employees = Array.isArray(state.employees) ? state.employees : [];
      const userObj = users.find(u => String(u?.username || '').toLowerCase() === username.toLowerCase())
        || employees.find(e => String(e?.username || '').toLowerCase() === username.toLowerCase());
      const name = String(userObj?.name || '').trim();
      const store = String(userObj?.store || '').trim();

      const id = 'attn_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
      await pool.query(
        `INSERT INTO attention_scores (id, username, name, store, material_id, material_title, score, duration_seconds, total_samples, attentive_samples, avg_score, tenant_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [id, username, name, store, materialId, materialTitle, score, durationSeconds, totalSamples, attentiveSamples, avgScore, resolveTenantIdDefault()]
      );

      res.json({ ok: true, id, score });
    } catch (e) {
      log.error({ msg: 'post_api_attention_scores_error', err: e?.message || String(e) });
      res.status(500).json({ error: 'internal_error' });
    }
  });

  // 查询专注度分数（管理员/经理可查全部，普通员工只能查自己）
  app.get('/api/attention-scores', authRequired, async (req, res) => {
    try {
      const username = String(req.user?.username || '').trim();
      const role = String(req.user?.role || '').trim();
      const canSeeAll = role === 'admin' || role === 'hq_manager' || role === 'hr_manager' || role === 'store_manager';

      const filterUser = String(req.query?.username || '').trim();
      const filterMaterial = String(req.query?.materialId || '').trim();
      const limit = Math.max(1, Math.min(200, Number(req.query?.limit) || 50));

      let query = 'SELECT * FROM attention_scores WHERE 1=1';
      const params = [];
      let paramIdx = 1;

      if (!canSeeAll) {
        query += ` AND username = $${paramIdx++}`;
        params.push(username);
      } else if (filterUser) {
        query += ` AND username = $${paramIdx++}`;
        params.push(filterUser);
      }

      if (filterMaterial) {
        query += ` AND material_id = $${paramIdx++}`;
        params.push(filterMaterial);
      }

      query += ` ORDER BY created_at DESC LIMIT $${paramIdx++}`;
      params.push(limit);

      const r = await pool.query(query, params);
      res.json({ scores: r.rows || [] });
    } catch (e) {
      log.error({ msg: 'get_api_attention_scores_error', err: e?.message || String(e) });
      res.status(500).json({ error: 'internal_error' });
    }
  });

  // 专注度统计摘要（按用户汇总）
  app.get('/api/attention-scores/summary', authRequired, async (req, res) => {
    try {
      const role = String(req.user?.role || '').trim();
      const canSeeAll = role === 'admin' || role === 'hq_manager' || role === 'hr_manager' || role === 'store_manager';
      if (!canSeeAll) return res.status(403).json({ error: 'forbidden' });

      const r = await pool.query(`
      SELECT username, name, store,
        COUNT(*) as session_count,
        ROUND(AVG(score)) as avg_score,
        SUM(duration_seconds) as total_duration,
        MAX(created_at) as last_session
      FROM attention_scores
      GROUP BY username, name, store
      ORDER BY avg_score ASC
    `);
      res.json({ summary: r.rows || [] });
    } catch (e) {
      log.error({ msg: 'get_api_attention_scores_summary_error', err: e?.message || String(e) });
      res.status(500).json({ error: 'internal_error' });
    }
  });
}
