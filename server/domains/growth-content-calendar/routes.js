import { tenantContext } from '../../utils/database.js';
import {
  listChannelEffects,
  listContentCalendar,
  listUpcomingContentCalendar,
  upsertContentCalendarItem,
} from './service.js';

/**
 * @param {import('express').Express} app
 * @param {{ pool: any, requirePhaseAuth: Function, getPhaseTenantId: Function }} deps
 */
export function registerGrowthContentCalendarRoutes(app, deps) {
  const { pool, requirePhaseAuth, getPhaseTenantId } = deps;

  app.post('/api/growth/content-calendar', async (req, res) => {
    if (!requirePhaseAuth(req, res)) return;
    const tid = getPhaseTenantId(req);
    try {
      const item = await tenantContext.run(tid, () => upsertContentCalendarItem(pool, tid, req.body || {}));
      return res.json({ ok: true, item });
    } catch (e) {
      return res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.get('/api/growth/content-calendar', async (req, res) => {
    if (!requirePhaseAuth(req, res)) return;
    try {
      const items = await tenantContext.run(getPhaseTenantId(req), () =>
        listContentCalendar(pool, { storeId: req.query.store_id, channel: req.query.channel })
      );
      return res.json({ ok: true, items });
    } catch (e) {
      return res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.get('/api/growth/content-calendar/upcoming', async (req, res) => {
    if (!requirePhaseAuth(req, res)) return;
    try {
      const items = await tenantContext.run(getPhaseTenantId(req), () =>
        listUpcomingContentCalendar(pool, req.query.store_id)
      );
      return res.json({ ok: true, items });
    } catch (e) {
      return res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.get('/api/growth/channel-effects', async (req, res) => {
    if (!requirePhaseAuth(req, res)) return;
    try {
      const effects = await tenantContext.run(getPhaseTenantId(req), () => listChannelEffects(pool, req.query.days));
      return res.json({ ok: true, effects });
    } catch (e) {
      return res.status(500).json({ ok: false, error: 'server_error' });
    }
  });
}
