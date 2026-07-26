/**
 * POST /api/reads/batch — mark items read (Wave 4m extract).
 */
export function registerReadsBatchRoute(app, authRequired, deps) {
  const { pool } = deps;

  app.post('/api/reads/batch', authRequired, async (req, res) => {
    const username = String(req.user?.username || '').trim();
    const module = String(req.body?.module || '').trim();
    const keys = Array.isArray(req.body?.keys) ? req.body.keys.map(x => String(x || '').trim()).filter(Boolean) : [];
    if (!username) return res.status(400).json({ error: 'missing_user' });
    if (!module) return res.status(400).json({ error: 'missing_module' });
    if (!keys.length) return res.json({ ok: true, inserted: 0 });

    const sliced = keys.slice(0, 500);
    try {
      const values = [];
      const params = [];
      sliced.forEach((k, i) => {
        params.push(username, module, k);
        const base = i * 3;
        values.push(`($${base + 1}, $${base + 2}, $${base + 3}, now())`);
      });
      await pool.query(
        `insert into user_reads (username, module, item_key, read_at)
         values ${values.join(',')}
         on conflict (username, module, item_key, tenant_id) do update set read_at = excluded.read_at`,
        params
      );
      return res.json({ ok: true, inserted: sliced.length });
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: 'internal_error' });
    }
  });
}
