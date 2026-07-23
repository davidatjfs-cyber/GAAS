/**
 * Admin usage weekly report routes (Wave 4o — behavior-preserving extract from index.js).
 */

/**
 * @param {import('express').Express} app
 * @param {(req,res,next)=>void} authRequired
 * @param {{ pool: import('pg').Pool }} deps
 */
export function registerUsageWeeklyRoutes(app, authRequired, deps) {
  const { pool } = deps;

  app.get('/api/admin/usage-weekly', authRequired, async (req, res) => {
    const role = String(req.user?.role || '').trim();
    if (role !== 'admin' && role !== 'hq_manager') {
      return res.status(403).json({ error: 'forbidden' });
    }
    try {
      const { periodStart, periodEnd } = (() => {
        const now = new Date();
        const shanghaiNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }));
        const dayOfWeek = shanghaiNow.getDay();
        const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
        const monday = new Date(shanghaiNow);
        monday.setDate(shanghaiNow.getDate() + mondayOffset - 7);
        const sunday = new Date(monday);
        sunday.setDate(monday.getDate() + 6);
        const fmt = d => d.toISOString().slice(0, 10);
        return { periodStart: fmt(monday), periodEnd: fmt(sunday) };
      })();

      const result = await pool.query(`
      SELECT
        l.username,
        COALESCE(e.name, u.real_name, l.username) AS name,
        COALESCE(e.store, fu.store, '') AS store,
        COALESCE(e.position, fu.role, u.role, '') AS position,
        COUNT(*) AS login_count,
        ROUND(
          EXTRACT(EPOCH FROM (
            COALESCE(
              SUM(
                LEAST(
                  COALESCE(
                    l.logout_at,
                    LEAST(
                      (($2::text || ' 23:59:59')::timestamp AT TIME ZONE 'Asia/Shanghai'),
                      l.login_at + INTERVAL '12 hours'
                    )
                  ),
                  l.login_at + INTERVAL '12 hours'
                ) - l.login_at
              ),
              INTERVAL '0'
            )
          )) / 60.0
        , 1) AS online_minutes
      FROM user_login_log l
      LEFT JOIN employees e ON LOWER(TRIM(e.username)) = LOWER(TRIM(l.username))
      LEFT JOIN users u ON LOWER(TRIM(u.username)) = LOWER(TRIM(l.username))
      LEFT JOIN feishu_users fu ON LOWER(TRIM(fu.username)) = LOWER(TRIM(l.username))
      WHERE (l.login_at AT TIME ZONE 'Asia/Shanghai')::date >= $1::date
        AND (l.login_at AT TIME ZONE 'Asia/Shanghai')::date <= $2::date
        AND l.username NOT LIKE '__periodic%%'
        AND COALESCE(e.name, u.real_name, '') NOT IN ('系统管理员', 'test')
      GROUP BY l.username, e.name, u.real_name, e.store, fu.store, e.position, fu.role, u.role
      ORDER BY login_count DESC, online_minutes DESC
    `, [periodStart, periodEnd]);

      res.json({ periodStart, periodEnd, data: result.rows });
    } catch (e) {
      console.error('GET /api/admin/usage-weekly error:', e);
      res.status(500).json({ error: 'internal_error' });
    }
  });
}
