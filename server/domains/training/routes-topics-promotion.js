/**
 * Training promotion / development-map routes.
 */
import { pool, isManager } from './shared.js';
import {
  getPromotionRequiredTopics,
  getMyDevelopmentMap,
  getCrossTrackTechnicianStatus,
} from './service.js';

export function registerTrainingTopicsPromotionRoutes(app, authMiddleware, _uploadMiddleware) {
  app.get('/api/training/promotion-requirements', authMiddleware, async (req, res) => {
    try {
      const topics = await getPromotionRequiredTopics(req.query.position || '', req.query.level || '');
      res.json({ success: true, topics: topics.map(t => ({ id: t.id, title: t.title, level: t.level, validity_days: t.validity_days })) });
    } catch (e) {
      res.json({ success: false, error: e?.message });
    }
  });

  app.post('/api/training/topics/set-promotion-requirements', authMiddleware, async (req, res) => {
    try {
      if (!['admin', 'hq_manager'].includes(req.user?.role)) {
        return res.status(403).json({ error: '仅管理员和总部营运可修改晋升认证要求' });
      }
      const position = String(req.body?.position || '').trim();
      const level = String(req.body?.level || '').trim();
      const requiredIds = Array.isArray(req.body?.required_ids)
        ? req.body.required_ids.map(Number).filter(n => Number.isFinite(n) && n > 0)
        : [];
      if (!position || !level) return res.status(400).json({ error: '必须指定 position 和 level' });

      const allR = await pool().query(
        `SELECT id FROM training_topics WHERE is_active = true AND level = $1
           AND (position = $2 OR position LIKE $3 OR position LIKE $4 OR position LIKE $5)`,
        [level, position, `${position},%`, `%,${position}`, `%,${position},%`]
      );
      const allIds = allR.rows.map(r => r.id);
      if (!allIds.length) return res.json({ success: true, updated: 0 });

      await pool().query(
        `UPDATE training_topics SET promotion_required = (id = ANY($1::int[]))
         WHERE id = ANY($2::int[])`,
        [requiredIds, allIds]
      );
      return res.json({ success: true, updated: allIds.length, required_count: requiredIds.length });
    } catch (e) {
      return res.status(500).json({ error: e?.message });
    }
  });

  app.get('/api/training/my-development-map', authMiddleware, async (req, res) => {
    try {
      const target = String(req.query.username || req.user?.username || '').trim();
      if (!isManager(req.user?.role) && target !== req.user?.username) {
        return res.status(403).json({ success: false, error: '无权限查看他人数据' });
      }
      const map = await getMyDevelopmentMap(target);
      res.json({ success: true, map });
    } catch (e) {
      res.json({ success: false, error: e?.message });
    }
  });

  app.get('/api/training/cross-track-status', authMiddleware, async (req, res) => {
    try {
      const target = String(req.query.username || req.user?.username || '').trim();
      if (!isManager(req.user?.role) && target !== req.user?.username) {
        return res.status(403).json({ error: '无权限查看他人数据' });
      }
      const status = await getCrossTrackTechnicianStatus(target);
      res.json({ success: true, ...status });
    } catch (e) {
      res.json({ success: false, error: e?.message });
    }
  });
}
