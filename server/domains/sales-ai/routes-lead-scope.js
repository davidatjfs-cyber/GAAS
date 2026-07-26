/**
 * Sales lead record-level access middleware — P5.4 peel from registerSalesAiRoutes.
 */
import { getLead } from '../../services/sales/sales-store.js';
import { canAccessLead } from '../../services/sales/sales-permissions.js';
import { childLogger } from '../../utils/logger.js';

const log = childLogger({ domain: 'sales-ai', handler: 'routes-lead-scope' });

export function registerSalesLeadScopeMiddleware(app, pool, platformAdminRequired) {
  app.use('/api/admin/sales/leads/:id', platformAdminRequired, async (req, res, next) => {
    try {
      const lead = await getLead(pool, Number(req.params.id));
      if (!lead || !canAccessLead(req.platformAdmin, lead)) return res.status(404).json({ ok: false, error: 'not_found' });
      req.salesLead = lead;
      next();
    } catch (e) {
      log.error({ msg: 'sales_lead_scope_check_failed', err: e?.message || e });
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });
}
