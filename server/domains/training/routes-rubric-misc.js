/**
 * Training score-detail + kb-search routes.
 */
import { pool, isManager } from './shared.js';

export function registerTrainingRubricMiscRoutes(app, authMiddleware, _uploadMiddleware) {
  app.get('/api/training/certifications/:id/score-detail', authMiddleware, async (req, res) => {
    try {
      const { id } = req.params;
      const username = req.user?.username;
      const isMgr = isManager(req.user?.role);
      const certResult = await pool().query(`
        SELECT c.*, t.title, t.position
        FROM training_certifications c JOIN training_topics t ON t.id = c.topic_id
        WHERE c.id = $1`, [id]);
      if (certResult.rows.length === 0) return res.json({ success: false, error: '认证记录不存在' });
      const cert = certResult.rows[0];
      if (!isMgr && cert.employee_username !== username) return res.status(403).json({ error: '无权查看' });
      res.json({
        success: true,
        certification: cert,
        ai_step_scores: cert.ai_step_scores || null,
        ai_total_score: cert.ai_total_score || null,
        review_status: cert.review_status || 'pending',
        manager_score: cert.manager_score || null,
        final_score: cert.final_score || null,
        manager_note: cert.manager_note || ''
      });
    } catch (e) {
      res.json({ success: false, error: e?.message });
    }
  });

  app.get('/api/training/kb-search', authMiddleware, async (req, res) => {
    try {
      if (!isManager(req.user?.role)) {
        return res.status(403).json({ error: '无权限' });
      }
      const q = (req.query.q || '').trim();
      const idsParam = (req.query.ids || '').trim();
      let sql, params;
      if (idsParam) {
        const ids = idsParam.split(',').map(s => s.trim()).filter(Boolean).slice(0, 50);
        const placeholders = ids.map((_, i) => '$' + (i + 1)).join(',');
        sql = `SELECT id, title, category, LEFT(content, 200) AS excerpt FROM knowledge_base WHERE enabled = true AND id::text IN (${placeholders}) ORDER BY title`;
        params = ids;
      } else if (q) {
        sql = `SELECT id, title, category, LEFT(content, 200) AS excerpt FROM knowledge_base WHERE enabled = true AND (title ILIKE $1 OR content ILIKE $1) ORDER BY title LIMIT 20`;
        params = ['%' + q + '%'];
      } else {
        sql = `SELECT id, title, category, LEFT(content, 200) AS excerpt FROM knowledge_base WHERE enabled = true ORDER BY updated_at DESC LIMIT 20`;
        params = [];
      }
      const result = await pool().query(sql, params);
      res.json({ success: true, articles: result.rows });
    } catch (e) {
      res.json({ success: false, error: e?.message });
    }
  });
}
