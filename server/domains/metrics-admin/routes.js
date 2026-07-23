/**
 * Metrics admin HTTP routes (Wave 4p — behavior-preserving extract from index.js).
 */
export function registerMetricsAdminRoutes(app, authRequired, deps) {
  const { pool, updateMetricVersion } = deps;

  app.post('/api/admin/metrics/bump-version', authRequired, async (req, res) => {
    const role = String(req.user?.role || '').trim();
    if (!['admin', 'hq_manager'].includes(role)) return res.status(403).json({ error: 'forbidden' });
    const metricId = String(req.body?.metric_id || '').trim();
    const changes = req.body?.changes || {};
    const changedBy = String(req.user?.username || 'admin');
    if (!metricId) return res.status(400).json({ error: 'missing metric_id' });
    try {
      const result = await updateMetricVersion(metricId, changes, changedBy);
      return res.json(result);
    } catch (e) {
      return res.status(500).json({ error: e?.message });
    }
  });

  app.get('/api/admin/metrics/change-log/:metricId', authRequired, async (req, res) => {
    const role = String(req.user?.role || '').trim();
    if (!['admin', 'hq_manager', 'hr_manager'].includes(role)) return res.status(403).json({ error: 'forbidden' });
    const metricId = String(req.params.metricId || '').trim();
    try {
      const r = await pool.query(
        `SELECT metric_id, name, version, metadata->'change_log' AS change_log, updated_at
       FROM metric_dictionary WHERE metric_id = $1`,
        [metricId]
      );
      if (!r.rows[0]) return res.status(404).json({ error: 'not_found' });
      return res.json(r.rows[0]);
    } catch (e) {
      return res.status(500).json({ error: e?.message });
    }
  });
}
