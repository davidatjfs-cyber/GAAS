/**
 * Training topics / promotion / development-map routes.
 */
import { pool, isManager, getUserStore } from './shared.js';
import {
  getPromotionRequiredTopics,
  getMyDevelopmentMap,
  getCrossTrackTechnicianStatus,
} from './service.js';

export function registerTrainingTopicsRoutes(app, authMiddleware, _uploadMiddleware) {
  // ═══════════════════════════════════════════════════════════
  // 管理端路由
  // ═══════════════════════════════════════════════════════════

  // GET /api/training/promotion-requirements?position=X&level=Y - 该岗位+级别的晋升能力要求知识点（员工/管理员均可查看）
  app.get('/api/training/promotion-requirements', authMiddleware, async (req, res) => {
    try {
      const topics = await getPromotionRequiredTopics(req.query.position || '', req.query.level || '');
      res.json({ success: true, topics: topics.map(t => ({ id: t.id, title: t.title, level: t.level, validity_days: t.validity_days })) });
    } catch (e) {
      res.json({ success: false, error: e?.message });
    }
  });

  // POST /api/training/topics/set-promotion-requirements
  // 管理员批量设置某岗位+级别的晋升认证要求：
  // required_ids 里的 topic 设为 promotion_required=true；同岗位+级别其余 topic 设为 false。
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

      // 取该岗位+级别的所有 topic id（position 字段是逗号分隔，用 LIKE 匹配）
      const allR = await pool().query(
        `SELECT id FROM training_topics WHERE is_active = true AND level = $1
           AND (position = $2 OR position LIKE $3 OR position LIKE $4 OR position LIKE $5)`,
        [level, position, `${position},%`, `%,${position}`, `%,${position},%`]
      );
      const allIds = allR.rows.map(r => r.id);
      if (!allIds.length) return res.json({ success: true, updated: 0 });

      // 批量 update：用 CASE 一次搞定
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

  // GET /api/training/my-development-map - 我的发展地图（档案首页）
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

  // GET /api/training/cross-track-status?username=X - 厨师长晋升阶段一前提：跨专业线技师级状态
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

  // GET /api/training/topics - 列出知识点
  // 注意：员工提交晋升资格申请(技能提升)时，前端要按目标岗位查知识点供自选，
  // 调用方是申请人本人(store_employee)而非管理者——之前这里要求isManager()，
  // 普通员工调用必得403，前端又把{error:...}误判成{topics:[]}显示"该岗位暂无知识点"，
  // 导致所有非管理者角色提交同岗位晋升申请时永远看不到任何知识点可选。
  // 知识点标题/要点本身不是敏感数据(本来就是员工要学的内容)，放开给所有登录用户只读查询。
  app.get('/api/training/topics', authMiddleware, async (req, res) => {
    try {
      const position = req.query.position || '';
      const tenantId = String(req.tenantId || req.user?.tenant_id || 'default').trim() || 'default';
      const params = [tenantId];
      let sql = `SELECT * FROM training_topics WHERE is_active = true AND tenant_id = $1`;
      // 门店过滤：店长/出品经理只看自己门店（或全部门店的知识点）
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

  // POST /api/training/topics - 创建知识点
  app.post('/api/training/topics', authMiddleware, async (req, res) => {
    try {
      if (!['admin', 'hq_manager'].includes(req.user?.role)) {
        return res.status(403).json({ error: '仅管理员和总部营运可新建知识点' });
      }
      const { title, positions, position, description, key_points, practice_task, sort_order, kb_article_ids, store, promotion_required, validity_days, level } = req.body;
      // positions 优先（新格式：数组），position 备用（旧格式：字符串）
      const posArr = Array.isArray(positions) && positions.length ? positions : (position ? [position] : []);
      const posStr = posArr.join(',');
      if (!title?.trim() || !posStr) {
        return res.json({ success: false, error: '标题和岗位必填' });
      }
      const kbIds = Array.isArray(kb_article_ids) ? kb_article_ids : [];
      // 门店：store_manager/production_mgr 强制使用自己的门店
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

  // PUT /api/training/topics/:id - 更新知识点
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
      // 门店：store_manager/production_mgr 强制使用自己的门店
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

  // DELETE /api/training/topics/:id - 软删除知识点
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
