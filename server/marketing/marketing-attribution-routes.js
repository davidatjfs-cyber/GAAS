import { calculateCampaignAttribution } from './marketing-attribution-service.js';
import { childLogger } from '../utils/logger.js';

const log = childLogger({ domain: 'marketing', handler: 'attribution-routes' });

export function registerMarketingAttributionRoutes(app, pool, authRequired, opts = {}) {
  const getTenantId = opts.getTenantId || ((req) => req.tenantId || 'default');

  app.get('/api/marketing/attribution/:campaignId', authRequired, async (req, res) => {
    try {
      const attribution = await calculateCampaignAttribution(pool, req.params.campaignId, {
        tenantId: getTenantId(req),
        attributionWindowDays: req.query.attributionWindowDays || req.query.window_days || 7,
      });
      return res.json({ ok: true, attribution });
    } catch (e) {
      log.error({ msg: 'calculate_failed', err: e?.message || String(e) });
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  app.post('/api/marketing/attribution/preview', authRequired, async (req, res) => {
    try {
      const b = req.body || {};
      if (!b.campaignId) return res.status(400).json({ ok: false, error: 'campaignId_required' });
      const attribution = await calculateCampaignAttribution(pool, b.campaignId, {
        tenantId: getTenantId(req),
        attributionWindowDays: b.attributionWindowDays || 7,
      });
      return res.json({ ok: true, attribution });
    } catch (e) {
      log.error({ msg: 'preview_failed', err: e?.message || String(e) });
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });
}
