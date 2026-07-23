/**
 * Performance admin HTTP routes (Wave 4p — behavior-preserving extract from index.js).
 */
export function registerPerfAdminRoutes(app, authRequired, deps) {
  const { getLastCompletedWeekRangeShanghai, sendWeeklyDishOptimizationReport } = deps;

  app.post('/api/admin/perf/dish-weekly/resend', authRequired, async (req, res) => {
    try {
      const role = String(req.user?.role || '').trim();
      if (role !== 'admin' && role !== 'hq_manager') {
        return res.status(403).json({ error: 'forbidden', message: '仅 admin 或 hq_manager' });
      }
      let weekStart = String(req.body?.weekStart || '').trim();
      let weekEnd = String(req.body?.weekEnd || '').trim();
      if (!weekStart || !weekEnd) {
        const w = getLastCompletedWeekRangeShanghai();
        weekStart = w.start;
        weekEnd = w.end;
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart) || !/^\d{4}-\d{2}-\d{2}$/.test(weekEnd)) {
        return res.status(400).json({ error: 'bad_range', message: 'weekStart/weekEnd 须为 YYYY-MM-DD' });
      }
      await sendWeeklyDishOptimizationReport(weekStart, weekEnd);
      return res.json({ ok: true, weekStart, weekEnd, message: '已尝试向 admin/hq_manager 发送菜品优化周报卡片' });
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: 'internal_error' });
    }
  });
}
