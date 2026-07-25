import { canAccessOpsTasks } from './access.js';

/**
 * @param {import('express').Express} app
 * @param {(req,res,next)=>void} authRequired
 * @param {{
 *   pool: any,
 *   safeDateOnly: (input: unknown) => string | null,
 *   normalizeOpsRole: (input: unknown) => string,
 *   buildOpsFeedback: (task: object, completedAt: Date, evidenceCount: number, opts: { contentVerified: boolean }) => { score: number, feedback: string },
 * }} deps
 */
export function registerOpsTasksRoutes(app, authRequired, deps) {
  const { pool, safeDateOnly, normalizeOpsRole, buildOpsFeedback } = deps;

  app.get('/api/ops/tasks', authRequired, async (req, res) => {
    const username = String(req.user?.username || '').trim();
    const role = normalizeOpsRole(req.user?.role);
    if (!username) return res.status(400).json({ error: 'missing_user' });
    if (!canAccessOpsTasks(role)) return res.status(403).json({ error: 'forbidden' });

    const status = String(req.query?.status || 'open').trim();
    const bizDate = safeDateOnly(req.query?.date);
    const storeQ = String(req.query?.store || '').trim();
    const limit = Math.max(1, Math.min(200, Number(req.query?.limit) || 80));

    try {
      let where = ['1=1'];
      const params = [];
      const push = (v) => {
        params.push(v);
        return `$${params.length}`;
      };

      if (status && status !== 'all') {
        if (status === 'todo') {
          where.push(`status in ('open','overdue')`);
        } else {
          where.push(`status = ${push(status)}`);
        }
      }
      if (bizDate) where.push(`biz_date = ${push(bizDate)}::date`);

      if (role === 'store_manager' || role === 'store_production_manager') {
        where.push(`lower(assignee_username) = lower(${push(username)})`);
      } else if (storeQ) {
        where.push(`store = ${push(storeQ)}`);
      }

      const r = await pool.query(
        `select id, biz_date, store, brand, task_type, schedule_key, title, instructions,
                checklist, required_photos, assignee_username, assignee_role,
                status, due_at, completed_at, evidence_urls, evidence_note,
                feedback_score, feedback_text, source, created_at, updated_at
         from ops_tasks
         where ${where.join(' and ')}
         order by biz_date desc, due_at asc
         limit ${push(limit)}`,
        params
      );
      return res.json({ items: r.rows || [] });
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: 'internal_error' });
    }
  });

  app.post('/api/ops/tasks/:id/read', authRequired, async (req, res) => {
    const username = String(req.user?.username || '').trim();
    const id = String(req.params?.id || '').trim();
    if (!username) return res.status(400).json({ error: 'missing_user' });
    if (!id) return res.status(400).json({ error: 'missing_id' });
    try {
      await pool.query(
        `insert into user_reads (username, module, item_key, read_at)
         values ($1, 'ops_tasks', $2, now())
         on conflict (username, module, item_key, tenant_id)
         do update set read_at = excluded.read_at`,
        [username, id]
      );
      return res.json({ ok: true });
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: 'internal_error' });
    }
  });

  app.post('/api/ops/tasks/:id/complete', authRequired, async (req, res) => {
    const username = String(req.user?.username || '').trim();
    const role = normalizeOpsRole(req.user?.role);
    const id = String(req.params?.id || '').trim();
    const evidenceUrls = Array.isArray(req.body?.evidenceUrls)
      ? req.body.evidenceUrls.map(x => String(x || '').trim()).filter(Boolean)
      : [];
    const note = String(req.body?.note || '').trim();
    if (!username) return res.status(400).json({ error: 'missing_user' });
    if (!id) return res.status(400).json({ error: 'missing_id' });
    if (!evidenceUrls.length) return res.status(400).json({ error: 'missing_evidence' });

    try {
      const r0 = await pool.query(
        `select id, assignee_username, status, required_photos, due_at
         from ops_tasks where id = $1 limit 1`,
        [id]
      );
      const task = r0.rows?.[0] || null;
      if (!task) return res.status(404).json({ error: 'not_found' });
      const assignee = String(task.assignee_username || '').trim();
      const privileged = role === 'admin' || role === 'hq_manager' || role === 'hr_manager';
      if (!privileged && assignee.toLowerCase() !== username.toLowerCase()) {
        return res.status(403).json({ error: 'forbidden' });
      }
      if (String(task.status || '').trim() === 'done') {
        return res.status(400).json({ error: 'already_done' });
      }

      const completedAt = new Date();
      // 当前版本尚未接入图像内容识别，先按“未验证内容”生成保守反馈，避免误导性表扬。
      const fb = buildOpsFeedback(task, completedAt, evidenceUrls.length, { contentVerified: false });

      const r = await pool.query(
        `update ops_tasks
         set status = 'done',
             completed_at = now(),
             evidence_urls = $2::jsonb,
             evidence_note = $3,
             feedback_score = $4,
             feedback_text = $5,
             updated_at = now()
         where id = $1
         returning id, status, completed_at, feedback_score, feedback_text, evidence_urls`,
        [id, JSON.stringify(evidenceUrls), note || null, fb.score, fb.feedback]
      );

      await pool.query(
        `insert into user_reads (username, module, item_key, read_at)
         values ($1, 'ops_tasks', $2, now())
         on conflict (username, module, item_key, tenant_id)
         do update set read_at = excluded.read_at`,
        [username, id]
      );

      return res.json({ item: r.rows?.[0] || null });
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: 'internal_error' });
    }
  });
}
