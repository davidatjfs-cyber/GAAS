/**
 * Training assignments list / create / delete routes.
 */
import { pool, getAssignableRoles } from './shared.js';
import { createTrainingAssignment } from './service.js';

export function registerTrainingAssignmentsCrudRoutes(app, authMiddleware, _uploadMiddleware) {
  app.get('/api/training/assignments', authMiddleware, async (req, res) => {
    try {
      const role = req.user?.role;
      const username = req.user?.username;
      const _canAssign = ['admin', 'hq_manager', 'store_manager', 'store_production_manager'];
      if (!_canAssign.includes(role)) {
        return res.status(403).json({ error: '无权限访问' });
      }
      const name = (req.query.name || '').trim();
      const tenantId = String(req.tenantId || req.user?.tenant_id || 'default').trim() || 'default';
      const params = [tenantId];
      let sql = `
        SELECT a.*, t.title, t.position,
               s.status AS session_status, s.quiz_passed, s.quiz_score,
               CASE
                 WHEN a.due_date IS NOT NULL
                  AND a.due_date < ((NOW() AT TIME ZONE 'Asia/Shanghai')::date)
                  AND COALESCE(s.status, 'not_started') != 'certified'
                 THEN true ELSE false
               END AS is_overdue,
               CASE
                 WHEN a.due_date IS NOT NULL
                  AND a.due_date = ((NOW() AT TIME ZONE 'Asia/Shanghai')::date)
                  AND COALESCE(s.status, 'not_started') != 'certified'
                 THEN true ELSE false
               END AS is_due_today,
               CASE
                 WHEN a.due_date IS NOT NULL
                  AND a.due_date < ((NOW() AT TIME ZONE 'Asia/Shanghai')::date)
                  AND COALESCE(s.status, 'not_started') != 'certified'
                 THEN (((NOW() AT TIME ZONE 'Asia/Shanghai')::date) - a.due_date)
                 ELSE 0
               END AS days_overdue,
               e.name AS employee_name
        FROM training_assignments a
        JOIN training_topics t ON t.id = a.topic_id
        LEFT JOIN training_sessions s ON s.topic_id = a.topic_id AND s.employee_username = a.employee_username
        LEFT JOIN employees e ON e.username = a.employee_username
        WHERE a.tenant_id = $1
      `;
      if (!['admin', 'hq_manager'].includes(role)) {
        params.push(username);
        sql += ` AND a.assigned_by = $${params.length}`;
      }
      if (name) {
        params.push('%' + name + '%');
        sql += ` AND (e.name ILIKE $${params.length} OR a.employee_username ILIKE $${params.length})`;
      }
      sql += ` ORDER BY a.created_at DESC`;
      const result = await pool().query(sql, params);
      res.json({ success: true, assignments: result.rows });
    } catch (e) {
      res.json({ success: false, error: e?.message });
    }
  });

  app.post('/api/training/assignments', authMiddleware, async (req, res) => {
    try {
      const _canAssign = ['admin', 'hq_manager', 'store_manager', 'store_production_manager'];
      if (!_canAssign.includes(req.user?.role)) {
        return res.status(403).json({ error: '仅店长及以上角色可指派培训任务' });
      }
      const { employee_username, employee_usernames, topic_id, due_date, note } = req.body;
      const usernames = Array.isArray(employee_usernames) && employee_usernames.length
        ? employee_usernames
        : (employee_username ? [employee_username] : []);
      if (!usernames.length || !topic_id) {
        return res.json({ success: false, error: '员工和知识点必填' });
      }

      const assignableRoles = getAssignableRoles(req.user?.role);
      const requirePractice = req.body.require_practice === true || req.body.require_practice === 'true';
      const created = [];

      for (const username of usernames) {
        if (!username.trim()) continue;
        if (assignableRoles !== null) {
          const empCheck = await pool().query(`SELECT role, name FROM employees WHERE username = $1`, [username]);
          if (empCheck.rows.length === 0) continue;
          if (!assignableRoles.includes(empCheck.rows[0].role)) continue;
        }
        const row = await createTrainingAssignment({
          employeeUsername: username,
          topicId: topic_id,
          assignedBy: req.user?.username,
          dueDate: due_date || null,
          note: note || '',
          requirePractice,
          source: 'manual',
          tenantId: req.tenantId || req.user?.tenant_id
        });
        if (row) created.push(row);
      }

      res.json({ success: true, count: created.length, assignments: created });
    } catch (e) {
      res.json({ success: false, error: e?.message });
    }
  });

  app.delete('/api/training/assignments/:id', authMiddleware, async (req, res) => {
    try {
      const role = req.user?.role;
      const username = req.user?.username;
      const _canAssign = ['admin', 'hq_manager', 'store_manager', 'store_production_manager'];
      if (!_canAssign.includes(role)) {
        return res.status(403).json({ error: '无权限操作' });
      }
      if (!['admin', 'hq_manager'].includes(role)) {
        const check = await pool().query(`SELECT assigned_by FROM training_assignments WHERE id = $1`, [req.params.id]);
        if (check.rows.length === 0) return res.json({ success: false, error: '记录不存在' });
        if (check.rows[0].assigned_by !== username) {
          return res.status(403).json({ error: '只能撤销自己指派的任务' });
        }
      }
      await pool().query(`DELETE FROM training_assignments WHERE id = $1`, [req.params.id]);
      res.json({ success: true });
    } catch (e) {
      res.json({ success: false, error: e?.message });
    }
  });
}
