/**
 * Training certifications: pending, review, my-certifications.
 */
import { pool, isManager } from './shared.js';
import {
  canUserReviewCertification,
  buildPendingCertificationAssignerFilter,
} from './certification-reviewer.js';

/** 实操认证合格线（AI 确认与人工改分均适用） */
export const PRACTICE_CERT_PASS_SCORE = 80;

/**
 * 解析经理审核结果：confirm / override(steps) / verdict(passed|failed)
 */
export function resolveCertificationReviewDecision(existing, { action, verdict, steps, note }) {
  const managerNote = String(note || '').trim();
  let finalScore = null;
  let managerScore = null;
  let reviewStatus = 'pending';
  let passed = false;
  let stepScores = existing.ai_step_scores;

  if (action === 'confirm') {
    reviewStatus = 'confirmed';
    finalScore = existing.ai_total_score ?? null;
    passed = existing.ai_verdict === 'passed'
      || (finalScore != null && finalScore >= PRACTICE_CERT_PASS_SCORE);
  } else if (action === 'override' && Array.isArray(steps)) {
    if (!steps.length) {
      return { ok: false, error: '请填写评分（总分≥80为合格），或使用「审批通过」直接通过' };
    }
    reviewStatus = 'overridden';
    managerScore = steps.reduce((sum, s) => sum + (Number(s.score) || 0), 0);
    finalScore = managerScore;
    stepScores = steps;
    passed = managerScore >= PRACTICE_CERT_PASS_SCORE;
  } else if (verdict && ['passed', 'failed'].includes(verdict)) {
    reviewStatus = verdict === 'passed' && Array.isArray(steps) && steps.length ? 'overridden' : 'confirmed';
    passed = verdict === 'passed';
    if (passed) {
      if (Array.isArray(steps) && steps.length) {
        managerScore = steps.reduce((sum, s) => sum + (Number(s.score) || 0), 0);
        finalScore = managerScore;
        stepScores = steps;
        passed = managerScore >= PRACTICE_CERT_PASS_SCORE;
        reviewStatus = 'overridden';
      } else {
        const aiScore = existing.ai_total_score;
        finalScore = (aiScore != null && aiScore >= PRACTICE_CERT_PASS_SCORE) ? aiScore : 85;
        managerScore = null;
      }
    } else {
      finalScore = existing.ai_total_score ?? 0;
      managerScore = 0;
    }
  } else {
    return { ok: false, error: '请提供 action (confirm/override) 或 verdict (passed/failed)' };
  }

  return {
    ok: true,
    passed,
    finalScore,
    managerScore,
    reviewStatus,
    managerNote,
    stepScores,
  };
}

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
      const tenantId = String(req.tenantId || req.user?.tenant_id || 'default').trim() || 'default';

      const params = [tenantId];
      let assignerClause = '';
      if (!isAdminOrHQ) {
        const filter = buildPendingCertificationAssignerFilter(username);
        assignerClause = filter.sql;
        params.push(...filter.extraParams);
      }

      const result = await pool().query(`
        SELECT c.*, t.title, t.position, s.employee_username,
               e.name AS employee_name,
               a.assigned_by, a.source AS assignment_source,
               COALESCE(ae.name, a.assigned_by) AS assigner_name
        FROM training_certifications c
        JOIN training_sessions s ON s.id = c.session_id
        JOIN training_topics t ON t.id = c.topic_id
        LEFT JOIN employees e ON e.username = c.employee_username
        LEFT JOIN LATERAL (
          SELECT assigned_by, source
          FROM training_assignments
          WHERE employee_username = c.employee_username AND topic_id = c.topic_id AND tenant_id = c.tenant_id
          ORDER BY created_at DESC LIMIT 1
        ) a ON true
        LEFT JOIN employees ae ON ae.username = a.assigned_by
        WHERE c.manager_verdict IS NULL AND c.tenant_id = $1
        ${assignerClause}
        ORDER BY c.created_at DESC
      `, params);
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
      const tenantId = String(req.tenantId || req.user?.tenant_id || 'default').trim() || 'default';

      const existing = (await pool().query(`SELECT * FROM training_certifications WHERE id = $1`, [id])).rows[0];
      if (!existing) return res.json({ success: false, error: '认证记录不存在' });

      const allowed = await canUserReviewCertification(pool(), {
        reviewerUsername: reviewer,
        reviewerRole: role,
        employeeUsername: existing.employee_username,
        topicId: existing.topic_id,
        tenantId,
      });
      if (!allowed) {
        return res.status(403).json({ error: '只有派发人或门店负责人才能审核此认证' });
      }

      const decision = resolveCertificationReviewDecision(existing, { action, verdict, steps, note });
      if (!decision.ok) {
        return res.json({ success: false, error: decision.error });
      }
      const {
        passed, finalScore, managerScore, reviewStatus, managerNote, stepScores,
      } = decision;

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
        SELECT DISTINCT ON (c.topic_id)
               c.id, c.session_id, c.topic_id, c.media_url, c.media_type,
               c.ai_verdict, c.ai_feedback, c.ai_total_score, c.ai_step_scores,
               c.manager_verdict, c.manager_note, c.final_score, c.manager_score,
               c.review_status, c.certified_at, c.created_at,
               t.title, t.position,
               a.require_practice, a.assigned_by, a.source AS assignment_source,
               COALESCE(ae.name, a.assigned_by, '门店负责人') AS assigner_name,
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
          SELECT require_practice, assigned_by, source
          FROM training_assignments
          WHERE employee_username = c.employee_username AND topic_id = c.topic_id
            AND tenant_id = c.tenant_id
          ORDER BY created_at DESC LIMIT 1
        ) a ON true
        LEFT JOIN employees ae ON ae.username = a.assigned_by
        WHERE c.employee_username = $1 AND c.tenant_id = $2
        ORDER BY c.topic_id,
                 CASE WHEN c.manager_verdict = 'passed' OR c.legacy_accepted = true THEN 0 ELSE 1 END,
                 c.created_at DESC
      `, [username, tenantId]);
      res.json({ success: true, certifications: result.rows });
    } catch (e) {
      res.json({ success: false, error: e?.message });
    }
  });
}
