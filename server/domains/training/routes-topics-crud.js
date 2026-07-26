/**
 * Training topics CRUD routes.
 */
import { pool, getUserStore } from './shared.js';

export function registerTrainingTopicsCrudRoutes(app, authMiddleware, _uploadMiddleware) {
  app.get('/api/training/topics', authMiddleware, async (req, res) => {
    try {
      const position = req.query.position || '';
      const tenantId = String(req.tenantId || req.user?.tenant_id || 'default').trim() || 'default';
      const params = [tenantId];
      let sql = `SELECT * FROM training_topics WHERE is_active = true AND tenant_id = $1`;
      const userRole = req.user?.role;
      const userStore = ['store_manager', 'store_production_manager'].includes(userRole)
        ? await getUserStore(req.user?.username) : '';
      if (userStore) {
        sql += ` AND (store = '' OR store = $${params.length + 1})`;
        params.push(userStore);
      }
      if (position) {
        sql += ` AND (position = $${params.length + 1} OR position LIKE $${params.length + 2} OR position LIKE $${params.length + 3} OR position LIKE $${params.length + 4})`;
        params.push(position, position + ',%', '%,' + position, '%,' + position + ',%');
      }
      sql += ` ORDER BY sort_order, id`;
      const result = await pool().query(sql, params);
      res.json({ success: true, topics: result.rows });
    } catch (e) {
      res.json({ success: false, error: e?.message });
    }
  });

  app.post('/api/training/topics', authMiddleware, async (req, res) => {
    try {
      if (!['admin', 'hq_manager'].includes(req.user?.role)) {
        return res.status(403).json({ error: '仅管理员和总部营运可新建知识点' });
      }
      const { title, positions, position, description, key_points, practice_task, sort_order, kb_article_ids, store, promotion_required, validity_days, level } = req.body;
      const posArr = Array.isArray(positions) && positions.length ? positions : (position ? [position] : []);
      const posStr = posArr.join(',');
      if (!title?.trim() || !posStr) {
        return res.json({ success: false, error: '标题和岗位必填' });
      }
      const kbIds = Array.isArray(kb_article_ids) ? kb_article_ids : [];
      const userRole = req.user?.role;
      let storeVal = String(store || '').trim();
      if (['store_manager', 'store_production_manager'].includes(userRole)) {
        storeVal = await getUserStore(req.user?.username);
      }
      const promotionRequired = promotion_required === true || promotion_required === 'true';
      const validityDays = Math.max(1, Number(validity_days) || 180);
      const levelVal = String(level || '').trim();
      const tenantIdForInsert = String(req.tenantId || req.user?.tenant_id || 'default').trim() || 'default';
      const result = await pool().query(
        `INSERT INTO training_topics (title, position, description, key_points, practice_task, sort_order, created_by, kb_article_ids, store, promotion_required, validity_days, level, tenant_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         RETURNING *`,
        [title, posStr, description || '', JSON.stringify(key_points || []), practice_task || '', sort_order || 0, req.user?.username, kbIds, storeVal, promotionRequired, validityDays, levelVal, tenantIdForInsert]
      );
      res.json({ success: true, topic: result.rows[0] });
    } catch (e) {
      res.json({ success: false, error: e?.message });
    }
  });

  app.put('/api/training/topics/:id', authMiddleware, async (req, res) => {
    try {
      if (!['admin', 'hq_manager'].includes(req.user?.role)) {
        return res.status(403).json({ error: '仅管理员和总部营运可编辑知识点' });
      }
      const { id } = req.params;
      const { title, positions, position, description, key_points, practice_task, sort_order, kb_article_ids, store, promotion_required, validity_days, level } = req.body;
      const posArr = Array.isArray(positions) && positions.length ? positions : (position ? [position] : null);
      const posStr = posArr ? posArr.join(',') : null;
      const kbIds = Array.isArray(kb_article_ids) ? kb_article_ids : null;
      const userRole = req.user?.role;
      let storeVal = store !== undefined ? String(store || '').trim() : null;
      if (['store_manager', 'store_production_manager'].includes(userRole)) {
        storeVal = await getUserStore(req.user?.username);
      }
      const promotionRequired = promotion_required === undefined ? null : (promotion_required === true || promotion_required === 'true');
      const validityDays = validity_days === undefined ? null : Math.max(1, Number(validity_days) || 180);
      const levelVal = level === undefined ? null : String(level || '').trim();
      const result = await pool().query(
        `UPDATE training_topics
         SET title = COALESCE($1, title),
             position = COALESCE($2, position),
             description = COALESCE($3, description),
             key_points = COALESCE($4, key_points),
             practice_task = COALESCE($5, practice_task),
             sort_order = COALESCE($6, sort_order),
             kb_article_ids = COALESCE($7, kb_article_ids),
             store = COALESCE($9, store),
             promotion_required = COALESCE($10, promotion_required),
             validity_days = COALESCE($11, validity_days),
             level = COALESCE($12, level)
         WHERE id = $8
         RETURNING *`,
        [title, posStr, description, JSON.stringify(key_points), practice_task, sort_order, kbIds, id, storeVal, promotionRequired, validityDays, levelVal]
      );
      if (result.rows.length === 0) {
        return res.json({ success: false, error: '知识点不存在' });
      }
      res.json({ success: true, topic: result.rows[0] });
    } catch (e) {
      res.json({ success: false, error: e?.message });
    }
  });

  app.delete('/api/training/topics/:id', authMiddleware, async (req, res) => {
    try {
      if (!['admin', 'hq_manager'].includes(req.user?.role)) {
        return res.status(403).json({ error: '仅管理员和总部营运可删除知识点' });
      }
      await pool().query(`UPDATE training_topics SET is_active = false WHERE id = $1`, [req.params.id]);
      res.json({ success: true });
    } catch (e) {
      res.json({ success: false, error: e?.message });
    }
  });
}
