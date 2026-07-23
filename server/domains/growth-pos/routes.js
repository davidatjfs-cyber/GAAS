import { tenantContext } from '../../utils/database.js';
import { cleanText } from '../growth-phase-auth.js';
import {
  listCustomerOrders,
  listHardcodedGrowthStores,
  listPosLinkedCustomers,
  listPosOrderItems,
  listPosOrders,
} from './service.js';

/**
 * @param {import('express').Express} app
 * @param {{
 *   pool: any,
 *   requirePhaseAuth: Function,
 *   getPhaseTenantId: Function,
 *   ingestPosOrders: Function,
 *   linkPosOrdersToCustomers: Function,
 * }} deps
 */
export function registerGrowthPosRoutes(app, deps) {
  const { pool, requirePhaseAuth, getPhaseTenantId, ingestPosOrders, linkPosOrdersToCustomers } = deps;

  app.post('/api/growth/pos-orders', async (req, res) => {
    if (!requirePhaseAuth(req, res)) return;
    const b = req.body || {};
    const { orders = [], items = [] } = b;
    if (!orders.length && !items.length) {
      return res.status(400).json({ ok: false, error: 'missing orders or items' });
    }
    const storeId = cleanText(b.store_id || '', 128);
    const tenantId = getPhaseTenantId(req);
    try {
      return await tenantContext.run(tenantId, async () => {
        const result = await ingestPosOrders(pool, tenantId, { orders, items, storeId });
        return res.json({
          ok: true,
          orders_upserted: result.ordersUpserted,
          items_upserted: result.itemsUpserted,
          customers_linked: result.customersLinked,
        });
      });
    } catch (e) {
      return res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.get('/api/growth/pos-orders', async (req, res) => {
    if (!requirePhaseAuth(req, res)) return;
    try {
      const orders = await listPosOrders(pool, req.query || {});
      return res.json({ ok: true, orders });
    } catch (e) {
      return res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.get('/api/growth/pos-order-items', async (req, res) => {
    if (!requirePhaseAuth(req, res)) return;
    try {
      const items = await listPosOrderItems(pool, req.query.order_no);
      return res.json({ ok: true, items });
    } catch (e) {
      if (e?.code === 'bad_request') return res.status(400).json({ ok: false, error: e.message });
      return res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.get('/api/growth/customer-orders', async (req, res) => {
    if (!requirePhaseAuth(req, res)) return;
    try {
      const orders = await listCustomerOrders(pool, req.query || {});
      return res.json({ ok: true, orders });
    } catch (e) {
      if (e?.code === 'bad_request') return res.status(400).json({ ok: false, error: e.message });
      return res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.get('/api/growth/pos-linked-customers', async (req, res) => {
    if (!requirePhaseAuth(req, res)) return;
    try {
      const linked = await tenantContext.run(getPhaseTenantId(req), () =>
        listPosLinkedCustomers(pool, { storeId: req.query.store_id, days: req.query.days })
      );
      return res.json({ ok: true, linked });
    } catch (e) {
      return res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.get('/api/growth/stores', async (req, res) => {
    if (!requirePhaseAuth(req, res)) return;
    return res.json({ ok: true, stores: listHardcodedGrowthStores() });
  });

  app.post('/api/growth/pos-link-customers', async (req, res) => {
    if (!requirePhaseAuth(req, res)) return;
    try {
      const linked = await tenantContext.run(getPhaseTenantId(req), () => linkPosOrdersToCustomers(pool));
      return res.json({ ok: true, customers_linked: linked });
    } catch (e) {
      return res.status(500).json({ ok: false, error: 'server_error' });
    }
  });
}
