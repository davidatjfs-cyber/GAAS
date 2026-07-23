/**
 * BI report trigger routes — /api/reports/bi/*
 */

export function registerReportsBiRoutes(app, deps) {
  const {
    authRequired,
    sendWeeklyReports,
    sendMonthlyReports,
    sendTestReportsToUser,
  } = deps;

  // 手动触发 BI 周报 / 月报（仅管理员，用于测试）
  app.post('/api/reports/bi/trigger-weekly', authRequired, async (req, res) => {
    try {
      const role = String(req.user?.role || '').trim();
      if (role !== 'admin') return res.status(403).json({ error: 'admin_only' });
      await sendWeeklyReports(req.tenantId || req.user?.tenant_id || 'default');
      return res.json({ ok: true, triggered: 'weekly' });
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: 'internal_error' });
    }
  });

  app.post('/api/reports/bi/trigger-monthly', authRequired, async (req, res) => {
    try {
      const role = String(req.user?.role || '').trim();
      if (role !== 'admin') return res.status(403).json({ error: 'admin_only' });
      await sendMonthlyReports(req.tenantId || req.user?.tenant_id || 'default');
      return res.json({ ok: true, triggered: 'monthly' });
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: 'internal_error' });
    }
  });

  app.post('/api/reports/bi/test-send', authRequired, async (req, res) => {
    try {
      const role = String(req.user?.role || '').trim();
      if (role !== 'admin') return res.status(403).json({ error: 'admin_only' });
      const targetUsername = String(req.body?.username || '').trim();
      if (!targetUsername) return res.status(400).json({ error: 'missing_username' });
      const result = await sendTestReportsToUser(targetUsername, req.tenantId || req.user?.tenant_id || 'default');
      return res.json(result);
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: 'internal_error' });
    }
  });

}
