/**
 * Training certifications: pending, review, my-certifications.
 */
import { pool, isManager } from './shared.js';

export function registerTrainingCertificationsRoutes(app, authMiddleware, _uploadMiddleware) {
  // GET /api/training/certifications/pending - 待审核列表（谁派发谁审核）
  app.get('/api/training/certifications/pending', authMiddleware, async (req, res) => {
    try {
      if (!isManager(req.user?.role)) {
        return res.status(403).json({ error: '无权限访问' });
      }
      const username = String(req.user?.username || '').trim();
      const role = String(req.user?.role || '').trim();
      const isAdminOrHQ = role === 'admin' || role === 'hq_manager';
      // 谁派发谁审核：非管理员/总部只能看到自己派发的任务的认证。
      // assigned_by 为空（如到期复训自动派发未回填指派人的历史脏数据）时，
      // 兜底给该员工所在门店的店长/出品经理，避免记录永远无人能审。
      const assignerClause = isAdminOrHQ
        ? ''
        : `AND EXISTS (
             SELECT 1 FROM training_assignments a2
             WHERE a2.employee_username = c.employee_username
               AND a2.topic_id = c.topic_id
               AND (
                 lower(a2.assigned_by) = lower('${username.replace(/'/g, "''")}')
                 OR (
                   a2.assigned_by IS NULL
                   AND EXISTS (
                     SELECT 1 FROM employees ce
                     JOIN employees re ON re.store = ce.store AND lower(re.username) = lower('${username.replace(/'/g, "''")}')
                     WHERE lower(ce.username) = lower(c.employee_username)
                       AND re.role IN ('store_production_manager','store_manager')
                   )
                 )
               )
           )`;
      const tenantId = String(req.tenantId || req.user?.tenant_id || 'default').trim() || 'default';
      const result = await pool().query(`
        SELECT c.*, t.title, t.position, s.employee_username,
               e.name AS employee_name
        FROM training_certifications c
        JOIN training_sessions s ON s.id = c.session_id
        JOIN training_topics t ON t.id = c.topic_id
        LEFT JOIN employees e ON e.username = c.employee_username
        WHERE c.manager_verdict IS NULL AND c.tenant_id = $1
        ${assignerClause}
        ORDER BY c.created_at DESC
      `, [tenantId]);
      res.json({ success: true, pending: result.rows });
    } catch (e) {
      res.json({ success: false, error: e?.message });
    }
  });

  // POST /api/training/certifications/:id/review - 人工复核（谁派发谁审核）
  app.post('/api/training/certifications/:id/review', authMiddleware, async (req, res) => {
    try {
      if (!isManager(req.user?.role)) {
        return res.status(403).json({ error: '无权限访问' });
      }
      const { id } = req.params;
      const { action, verdict, note, steps } = req.body;
      const reviewer = req.user?.username;
      const role = String(req.user?.role || '').trim();
      const isAdminOrHQ = role === 'admin' || role === 'hq_manager';

      // 获取认证记录
      const existing = (await pool().query(`SELECT * FROM training_certifications WHERE id = $1`, [id])).rows[0];
      if (!existing) return res.json({ success: false, error: '认证记录不存在' });

      // 谁派发谁审核：非管理员/总部校验是否为派发人
      if (!isAdminOrHQ) {
        const assignCheck = await pool().query(
          `SELECT 1 FROM training_assignments WHERE employee_username = $1 AND topic_id = $2 AND lower(assigned_by) = lower($3) LIMIT 1`,
          [existing.employee_username, existing.topic_id, reviewer]
        );
        if (!assignCheck.rows.length) {
          return res.status(403).json({ error: '只有派发人才能审核此认证' });
        }
      }

      let finalScore = null;
      let managerScore = null;
      let reviewStatus = 'pending';
      let passed = false;
      let managerNote = note || '';
      let stepScores = existing.ai_step_scores;

      if (action === 'confirm') {
        // 确认AI评分
        reviewStatus = 'confirmed';
        finalScore = existing.ai_total_score || 0;
        passed = (existing.ai_verdict === 'passed' || finalScore >= 80);
      } else if (action === 'override' && Array.isArray(steps)) {
        // 人工覆盖评分
        reviewStatus = 'overridden';
        managerScore = steps.reduce((sum, s) => sum + (Number(s.score) || 0), 0);
        finalScore = managerScore;
        stepScores = steps;
        passed = managerScore >= 80; // rubric pass_threshold always 80
      } else if (verdict && ['passed', 'failed'].includes(verdict)) {
        // 兼容旧版调用（直接传passed/failed）
        reviewStatus = 'confirmed';
        passed = verdict === 'passed';
        finalScore = existing.ai_total_score || (passed ? 100 : 0);
      } else {
        return res.json({ success: false, error: '请提供 action (confirm/override) 或 verdict (passed/failed)' });
      }

      // 通过则按知识点的认证有效期计算到期日，作为P3持续认证的起点
      let validUntil = null;
      if (passed) {
        const topicRes = await pool().query(`SELECT validity_days FROM training_topics WHERE id = $1`, [existing.topic_id]);
        const days = Math.max(1, Number(topicRes.rows[0]?.validity_days) || 180);
        validUntil = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
      }

      await pool().query(
        `UPDATE training_certifications
         SET manager_verdict = $1, manager_note = $2, manager_reviewed_by = $3,
             review_status = $4, manager_score = $5, final_score = $6,
             ai_step_scores = CASE WHEN $7::jsonb IS NOT NULL THEN $7::jsonb ELSE ai_step_scores END,
             certified_at = CASE WHEN $8 THEN NOW() ELSE NULL END,
             valid_until = CASE WHEN $8 THEN $10::date ELSE valid_until END,
             status = CASE WHEN $8 THEN 'valid' ELSE status END
         WHERE id = $9`,
        [passed ? 'passed' : 'failed', managerNote, reviewer,
         reviewStatus, managerScore, finalScore, JSON.stringify(stepScores), passed, id, validUntil]
      );

      if (passed) {
        await pool().query(`UPDATE training_sessions SET status = 'certified' WHERE id = $1`, [existing.session_id]);
      }

      const updated = (await pool().query(`SELECT * FROM training_certifications WHERE id = $1`, [id])).rows[0];
      res.json({ success: true, certification: updated, final_score: finalScore });
    } catch (e) {
      res.json({ success: false, error: e?.message });
    }
  });

  // GET /api/training/my-certifications - 我的认证记录
  app.get('/api/training/my-certifications', authMiddleware, async (req, res) => {
    try {
      const username = req.user?.username;
      if (!username) return res.status(401).json({ error: '未登录' });
      const tenantId = String(req.tenantId || req.user?.tenant_id || 'default').trim() || 'default';
      const result = await pool().query(`
        SELECT c.id, c.session_id, c.topic_id, c.media_url, c.media_type,
               c.ai_verdict, c.ai_feedback, c.ai_total_score, c.ai_step_scores,
               c.manager_verdict, c.manager_note, c.final_score, c.manager_score,
               c.review_status, c.certified_at, c.created_at,
               t.title, t.position,
               a.require_practice,
               CASE WHEN (c.manager_verdict = 'passed' OR c.legacy_accepted = true)
                          AND COALESCE(c.status, 'valid') = 'valid'
                    THEN 'certified'
                    WHEN c.manager_verdict IS NULL AND c.legacy_accepted IS NOT TRUE
                    THEN 'pending_review'
                    ELSE 'not_certified'
               END AS effective_status,
               s.quiz_score, s.status AS session_status
        FROM training_certifications c
        JOIN training_topics t ON t.id = c.topic_id
        JOIN training_sessions s ON s.id = c.session_id
        LEFT JOIN LATERAL (
          SELECT require_practice
          FROM training_assignments
          WHERE employee_username = c.employee_username AND topic_id = c.topic_id
            AND tenant_id = c.tenant_id
          ORDER BY created_at DESC LIMIT 1
        ) a ON true
        WHERE c.employee_username = $1 AND c.tenant_id = $2
        ORDER BY c.created_at DESC
      `, [username, tenantId]);
      res.json({ success: true, certifications: result.rows });
    } catch (e) {
      res.json({ success: false, error: e?.message });
    }
  });
}
