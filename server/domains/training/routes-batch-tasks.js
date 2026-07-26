/**
 * POST /api/training/tasks/batch (behavior-preserving extract from index.js).
 */
import { pool, resolveTenantIdDefault } from './shared.js';
import { childLogger } from '../../utils/logger.js';

const log = childLogger({ domain: 'training', handler: 'routes-batch-tasks' });


export function registerTrainingBatchTasksRoutes(app, authRequired, deps) {
  const { getSharedState } = deps;

  app.post('/api/training/tasks/batch', authRequired, async (req, res) => {
    const role = String(req.user?.role || '').trim();
    // 仅限管理员或HR执行批量下发
    if (!['admin', 'hr_manager', 'hq_manager'].includes(role)) {
      return res.status(403).json({ error: 'forbidden', message: '只有管理员或HR可以批量下发培训任务' });
    }

    const { type, title, target_role, due_date } = req.body || {};
    if (!type || !title || !target_role) {
      return res.status(400).json({ error: 'missing_fields', message: '请提供培训类型、标题和目标岗位' });
    }

    try {
      const state = await getSharedState();
      const employees = Array.isArray(state?.data?.employees) ? state.data.employees : [];
      const users = Array.isArray(state?.data?.users) ? state.data.users : [];
      const allUsers = employees.concat(users);

      // 筛选符合目标岗位的人员
      const targets = allUsers.filter(u => String(u.role || '') === target_role && String(u.status || '') !== '离职');

      if (targets.length === 0) {
        return res.status(404).json({ error: 'no_targets_found', message: `未找到岗位为 ${target_role} 的在职员工` });
      }

      let inserted = 0;
      const client = await pool().connect();
      try {
        await client.query('BEGIN');
        for (const t of targets) {
          const trainingTaskId = `TR-${Date.now().toString().slice(-6)}-${Math.random().toString(36).slice(2, 6)}`;
          await client.query(
            `INSERT INTO training_tasks (task_id, type, title, target_role, assignee_username, store, brand, status, due_date, tenant_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8, $9)`,
            [
              trainingTaskId,
              type,
              title,
              target_role,
              t.username,
              t.store || '总部',
              t.brand || '',
              due_date || null,
              resolveTenantIdDefault()
            ]
          );
          inserted++;
        }
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }

      res.json({ success: true, count: inserted, message: `成功为 ${inserted} 名员工下发了培训任务。Master Agent 将会在调度后通过飞书自动通知他们。` });
    } catch (e) {
      log.error({ msg: 'training_tasks_batch_failed', request_id: req.requestId, err: e?.message || String(e) });
      res.status(500).json({ error: 'server_error', message: '内部服务器错误' });
    }
  });
}
