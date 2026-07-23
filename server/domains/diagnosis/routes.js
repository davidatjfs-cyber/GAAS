/**
 * Diagnosis feedback / stats HTTP routes (Wave 4q — behavior-preserving extract from index.js).
 * recordAiFeedback: index 从 ./services/ai-quality-learning-service.js import
 */
export function registerDiagnosisFeedbackRoutes(app, authRequired, deps) {
  const { pool, recordAiFeedback } = deps;

  app.post('/api/agent/diagnosis-feedback', authRequired, async (req, res) => {
    const userKey = String(req.user?.username || '').toLowerCase();
    const { task_id, feedback, feedback_note } = req.body || {};
    if (!task_id || feedback === undefined) return res.status(400).json({ error: 'missing task_id or feedback' });
    const fb = Number(feedback);
    if (fb !== 0 && fb !== 1) return res.status(400).json({ error: 'feedback must be 0 or 1' });
    try {
      const updated = await pool.query(
        `UPDATE diagnosis_feedback
       SET feedback = $1, feedback_note = $2, updated_at = NOW()
       WHERE task_id = $3 AND user_key = $4 AND tenant_id = $5
       RETURNING id, trace_id, diagnosis, query_text`,
        [fb, String(feedback_note || '').slice(0, 500), task_id, userKey, req.tenantId]
      );
      const row = updated.rows[0];
      if (!row) return res.status(404).json({ error: 'diagnosis_not_found' });
      if (row.trace_id) {
        await recordAiFeedback(pool, {
          traceId: row.trace_id,
          actorId: userKey,
          feedbackType: 'user_rating',
          rating: fb === 1 ? 1 : -1,
          note: feedback_note,
          input: row.query_text || task_id,
          output: row.diagnosis,
          idempotencyKey: `diagnosis:${row.id}`,
          tenantId: req.tenantId,
        });
      }
      return res.json({ ok: true });
    } catch (e) {
      return res.status(500).json({ error: e?.message });
    }
  });

  app.get('/api/admin/diagnosis-stats', authRequired, async (req, res) => {
    const role = String(req.user?.role || '').trim();
    if (!['admin', 'hq_manager'].includes(role)) return res.status(403).json({ error: 'forbidden' });
    try {
      const r = await pool.query(
        `
      SELECT
        COUNT(*) AS total,
        COUNT(feedback) AS rated,
        ROUND(AVG(CASE WHEN feedback = 1 THEN 100.0 ELSE 0 END), 1) AS like_rate_pct,
        ROUND(AVG(char_count), 0) AS avg_char_count,
        ROUND(AVG(metric_count), 1) AS avg_metric_count
      FROM diagnosis_feedback
      WHERE created_at > NOW() - INTERVAL '30 days' AND tenant_id = $1
    `,
        [req.tenantId]
      );
      return res.json(r.rows[0]);
    } catch (e) {
      return res.status(500).json({ error: e?.message });
    }
  });
}
