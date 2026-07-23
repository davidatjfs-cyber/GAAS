/**
 * Training dashboard routes.
 */
import { pool, isManager } from './shared.js';

export function registerTrainingDashboardRoutes(app, authMiddleware, _uploadMiddleware) {
  // GET /api/training/dashboard - 团队通过率看板（含每人明细）
  app.get('/api/training/dashboard', authMiddleware, async (req, res) => {
    try {
      const role = req.user?.role;
      const username = req.user?.username;
      if (!isManager(role)) {
        return res.status(403).json({ error: '无权限访问' });
      }

      // admin / hq_manager 看所有人派发的任务；其他管理者只看自己派发的
      const isHQ = ['admin', 'hr_manager', 'hq_manager'].includes(role);
      const assignedByFilter = isHQ ? '' : `AND a.assigned_by = '${username.replace(/'/g, "''")}'`;

      // 是否在结果中显示派发人（HQ 看全量需要知道是谁派的）
      const assignerField = isHQ
        ? `, a.assigned_by AS assigned_by, COALESCE(ae.name, a.assigned_by) AS assigner_name`
        : '';
      const assignerJoin = isHQ
        ? `LEFT JOIN employees ae ON ae.username = a.assigned_by`
        : '';
      const groupExtra = isHQ ? `, a.assigned_by, ae.name` : '';

      const result = await pool().query(`
        SELECT t.id, t.title, t.position
               ${assignerField},
               COUNT(DISTINCT a.employee_username) AS assigned_count,
               COUNT(DISTINCT CASE WHEN s.status = 'certified' THEN s.employee_username END) AS certified_count,
               COUNT(DISTINCT CASE
                 WHEN a.due_date IS NOT NULL
                  AND a.due_date < ((NOW() AT TIME ZONE 'Asia/Shanghai')::date)
                  AND COALESCE(s.status, 'not_started') != 'certified'
                 THEN a.employee_username
               END) AS overdue_count,
               COALESCE(
                 json_agg(
                   json_build_object(
                     'username', a.employee_username,
                     'name', COALESCE(e.name, a.employee_username),
                     'status', COALESCE(s.status, 'not_started'),
                     'quiz_score', s.quiz_score,
                     'quiz_history', COALESCE(s.quiz_history, '[]'::jsonb),
                     'due_date', a.due_date,
                     'is_overdue', CASE
                       WHEN a.due_date IS NOT NULL
                        AND a.due_date < ((NOW() AT TIME ZONE 'Asia/Shanghai')::date)
                        AND COALESCE(s.status, 'not_started') != 'certified'
                       THEN true ELSE false
                     END,
                     'is_due_today', CASE
                       WHEN a.due_date IS NOT NULL
                        AND a.due_date = ((NOW() AT TIME ZONE 'Asia/Shanghai')::date)
                        AND COALESCE(s.status, 'not_started') != 'certified'
                       THEN true ELSE false
                     END,
                     'days_overdue', CASE
                       WHEN a.due_date IS NOT NULL
                        AND a.due_date < ((NOW() AT TIME ZONE 'Asia/Shanghai')::date)
                        AND COALESCE(s.status, 'not_started') != 'certified'
                       THEN (((NOW() AT TIME ZONE 'Asia/Shanghai')::date) - a.due_date)
                       ELSE 0
                     END
                   ) ORDER BY e.name
                 ) FILTER (WHERE a.employee_username IS NOT NULL),
                 '[]'::json
               ) AS members
        FROM training_topics t
        LEFT JOIN training_assignments a ON a.topic_id = t.id ${assignedByFilter}
        LEFT JOIN training_sessions s ON s.topic_id = t.id AND s.employee_username = a.employee_username
        LEFT JOIN employees e ON e.username = a.employee_username
        ${assignerJoin}
        WHERE t.is_active = true
        GROUP BY t.id, t.title, t.position ${groupExtra}
        ORDER BY t.sort_order, t.id
      `);
      res.json({ success: true, dashboard: result.rows });
    } catch (e) {
      res.json({ success: false, error: e?.message });
    }
  });
}
