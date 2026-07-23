import { tenantContext } from '../../utils/database.js';
import { cleanText } from '../growth-phase-auth.js';

export async function recordSyncFailure(pool, tenantId, body = {}) {
  const b = body && typeof body === 'object' ? body : {};
  const tid = String(tenantId || 'default');
  await pool.query(
    'INSERT INTO growth_sync_failures (source,event_type,payload,error_message,tenant_id) VALUES ($1,$2,$3::jsonb,$4,$5)',
    [
      cleanText(b.source, 80),
      cleanText(b.event_type, 80),
      JSON.stringify(b.payload || {}),
      cleanText(b.error_message, 2000),
      tid,
    ]
  );
}

export async function listSyncFailures(pool, _tenantId) {
  const r = await pool.query('SELECT * FROM growth_sync_failures ORDER BY created_at DESC LIMIT 100');
  return r.rows || [];
}

/**
 * @param {import('express').Express} app
 * @param {{ pool: any, requirePhaseAuth: Function, getPhaseTenantId: Function }} deps
 */
export function registerGrowthSyncFailureRoutes(app, deps) {
  const { pool, requirePhaseAuth, getPhaseTenantId } = deps;

  app.post('/api/growth/sync-failures', async (req, res) => {
    if (!requirePhaseAuth(req, res)) return;
    const tid = getPhaseTenantId(req);
    try {
      await tenantContext.run(tid, () => recordSyncFailure(pool, tid, req.body || {}));
      return res.json({ ok: true });
    } catch (e) {
      return res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.get('/api/growth/sync-failures', async (req, res) => {
    if (!requirePhaseAuth(req, res)) return;
    const tid = getPhaseTenantId(req);
    try {
      const failures = await tenantContext.run(tid, () => listSyncFailures(pool, tid));
      return res.json({ ok: true, failures });
    } catch (e) {
      return res.status(500).json({ ok: false, error: 'server_error' });
    }
  });
}
