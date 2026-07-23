/**
 * @param {import('express').Express} app
 * @param {(req,res,next)=>void} authRequired
 * @param {{
 *   getSharedState: () => Promise<object>,
 *   saveSharedState: (state: object) => Promise<void>,
 *   hrmsNowISO: () => string,
 *   normalizeBrandId: (v: unknown) => string,
 *   getBrandsFromState: (state: object) => Array<object>,
 * }} deps
 */
export function registerBrandsRoutes(app, authRequired, deps) {
  const { getSharedState, saveSharedState, hrmsNowISO, normalizeBrandId, getBrandsFromState } = deps;

  app.get('/api/brands', authRequired, async (req, res) => {
    try {
      const state0 = (await getSharedState()) || {};
      const items = getBrandsFromState(state0);
      return res.json({ items });
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: 'internal_error' });
    }
  });

  app.post('/api/brands', authRequired, async (req, res) => {
    const role = String(req.user?.role || '').trim();
    if (!['admin', 'hq_manager'].includes(role)) return res.status(403).json({ error: 'forbidden' });
    const name = String(req.body?.name || '').trim();
    if (!name) return res.status(400).json({ error: 'missing_name' });
    const id = normalizeBrandId(req.body?.id || name);
    if (!id) return res.status(400).json({ error: 'invalid_brand_id' });
    const config = req.body?.config && typeof req.body.config === 'object' ? req.body.config : { sopKeypoints: [], performanceWeights: {} };
    try {
      const state0 = (await getSharedState()) || {};
      const brands = getBrandsFromState(state0).filter((b) => normalizeBrandId(b?.id) !== id);
      const item = { id, name, config };
      brands.unshift(item);
      await saveSharedState({ ...state0, brands });
      return res.json({ ok: true, item });
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: 'internal_error' });
    }
  });

  app.put('/api/brands/:id', authRequired, async (req, res) => {
    const role = String(req.user?.role || '').trim();
    if (!['admin', 'hq_manager'].includes(role)) return res.status(403).json({ error: 'forbidden' });
    const id = normalizeBrandId(req.params?.id);
    if (!id) return res.status(400).json({ error: 'missing_id' });
    const name = String(req.body?.name || '').trim();
    const config = req.body?.config && typeof req.body.config === 'object' ? req.body.config : null;
    try {
      const state0 = (await getSharedState()) || {};
      const brands = getBrandsFromState(state0);
      const idx = brands.findIndex((b) => normalizeBrandId(b?.id) === id);
      if (idx < 0) return res.status(404).json({ error: 'not_found' });
      const prev = brands[idx] || {};
      brands[idx] = {
        ...prev,
        id,
        name: name || prev.name,
        config: config || prev.config || { sopKeypoints: [], performanceWeights: {} }
      };

      const stores = Array.isArray(state0?.stores) ? state0.stores.slice() : [];
      const oldName = String(prev?.name || '').trim();
      const newName = String(brands[idx]?.name || '').trim();
      const nextStores = stores.map((s) => {
        const sid = normalizeBrandId(s?.brandId || s?.brand || s?.brandName);
        if (sid !== id) return s;
        return {
          ...s,
          brandId: id,
          brand: newName || oldName,
          brandName: newName || oldName,
          updatedAt: hrmsNowISO()
        };
      });

      await saveSharedState({ ...state0, brands, stores: nextStores });
      return res.json({ ok: true, item: brands[idx] });
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: 'internal_error' });
    }
  });
}
