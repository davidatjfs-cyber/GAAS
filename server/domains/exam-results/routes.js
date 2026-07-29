/**
 * Exam results HTTP routes (Wave 4o — behavior-preserving extract from index.js).
 */

/**
 * @param {import('express').Express} app
 * @param {(req,res,next)=>void} authRequired
 * @param {{ pool: import('pg').Pool, invalidateSharedStateCache?: (tenantId?: string)=>void }} deps
 */
export function registerExamResultsRoutes(app, authRequired, deps) {
  const { pool, invalidateSharedStateCache } = deps;

  app.get('/api/exam-results', authRequired, async (req, res) => {
    const role = String(req.user?.role || '').trim();
    const isPrivileged = role === 'admin' || role === 'hq_manager' || role === 'store_manager';
    const limit = Math.min(200, Math.max(1, Number(req.query?.limit || 100)));
    try {
      if (isPrivileged) {
        const r = await pool.query(
          `select id, assignment_id, user_key, created_at, started_at, submitted_at, time_used_seconds, auto_submitted, set_index, total, correct, score, answers
         from exam_results
         where tenant_id = $2
         order by created_at desc
         limit $1`,
          [limit, req.tenantId || req.user?.tenant_id || 'default']
        );
        return res.json({ items: r.rows || [] });
      }

      const userKey = String(req.user?.username || '').trim();
      const r = await pool.query(
        `select id, assignment_id, user_key, created_at, started_at, submitted_at, time_used_seconds, auto_submitted, set_index, total, correct, score, answers
       from exam_results
       where user_key = $1
       order by created_at desc
       limit $2`,
        [userKey, limit]
      );
      return res.json({ items: r.rows || [] });
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: 'internal_error', request_id: req.requestId || null });
    }
  });

  app.post('/api/exam-results', authRequired, async (req, res) => {
    const userKey = String(req.user?.username || '').trim() || 'unknown';
    const assignmentIdRaw = req.body?.assignmentId;
    const assignmentId = assignmentIdRaw ? String(assignmentIdRaw).trim() : null;
    const startedAt = req.body?.startedAt ? String(req.body.startedAt).trim() : null;
    const submittedAt = req.body?.submittedAt ? String(req.body.submittedAt).trim() : null;
    const timeUsedSeconds = req.body?.timeUsedSeconds == null ? null : Number(req.body.timeUsedSeconds);
    const autoSubmitted = !!req.body?.autoSubmitted;
    const setIndex = req.body?.setIndex == null ? null : Number(req.body.setIndex);
    const total = req.body?.total == null ? null : Number(req.body.total);
    const correct = req.body?.correct == null ? null : Number(req.body.correct);
    const score = req.body?.score == null ? null : Number(req.body.score);
    const answers = Array.isArray(req.body?.answers) ? req.body.answers : [];

    if (total == null || score == null) {
      return res.status(400).json({ error: 'missing_fields' });
    }

    try {
      const tid = req.tenantId || req.user?.tenant_id || 'default';
      const r = await pool.query(
        `insert into exam_results (assignment_id, user_key, started_at, submitted_at, time_used_seconds, auto_submitted, set_index, total, correct, score, answers, tenant_id)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       returning id, assignment_id, user_key, created_at, started_at, submitted_at, time_used_seconds, auto_submitted, set_index, total, correct, score, answers`,
        [
          assignmentId || null,
          userKey,
          startedAt || null,
          submittedAt || null,
          Number.isFinite(timeUsedSeconds) ? Math.max(0, Math.floor(timeUsedSeconds)) : null,
          autoSubmitted,
          Number.isFinite(setIndex) ? Math.max(0, Math.floor(setIndex)) : null,
          Number.isFinite(total) ? Math.max(0, Math.floor(total)) : null,
          Number.isFinite(correct) ? Math.max(0, Math.floor(correct)) : null,
          Number.isFinite(score) ? Math.max(0, Math.floor(score)) : null,
          JSON.stringify(answers || []),
          tid
        ]
      );
      if (typeof invalidateSharedStateCache === 'function') invalidateSharedStateCache(tid);
      return res.json({ item: r.rows?.[0] || null });
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: 'internal_error', request_id: req.requestId || null });
    }
  });
}
