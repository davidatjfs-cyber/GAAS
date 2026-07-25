/**
 * Bitable admin HTTP routes (Wave 4p — behavior-preserving extract from index.js).
 */
import { childLogger } from '../../utils/logger.js';

const log = childLogger({ domain: 'bitable-admin', handler: 'routes' });

export function registerBitableAdminRoutes(app, authRequired, deps) {
  const { getBitableSubmissionStats, archiveOldBitableSubmissions } = deps;

  app.get('/api/bitable/stats', authRequired, async (req, res) => {
    const role = String(req.user?.role || '').trim();
    if (!['admin', 'hr_manager', 'hq_manager'].includes(role)) {
      return res.status(403).json({ error: 'forbidden' });
    }

    try {
      const stats = await getBitableSubmissionStats();
      res.json({ ok: true, data: stats });
    } catch (e) {
      log.error({ msg: 'api_bitable_stats_error', err: e?.message });
      res.status(500).json({ error: 'internal_error', message: 'internal_error' });
    }
  });

  app.post('/api/bitable/archive', authRequired, async (req, res) => {
    const role = String(req.user?.role || '').trim();
    if (!['admin', 'hr_manager'].includes(role)) {
      return res.status(403).json({ error: 'forbidden' });
    }

    try {
      const result = await archiveOldBitableSubmissions();
      res.json({ ok: true, data: result });
    } catch (e) {
      log.error({ msg: 'api_bitable_archive_error', err: e?.message });
      res.status(500).json({ error: 'internal_error', message: 'internal_error' });
    }
  });
}
