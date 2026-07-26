import { extractStoreProfileFields, syncStoreProfileToChairmanConfig } from './profile.js';

/**
 * @param {import('express').Express} app
 * @param {(req,res,next)=>void} authRequired
 */
export function registerStoreUpdateRoute(app, authRequired, deps) {
  const {
    pool,
    getSharedState,
    saveSharedState,
    hrmsNowISO,
    normalizeBrandId,
    getBrandsFromState,
  } = deps;

  app.put('/api/stores/:id', authRequired, async (req, res) => {
    const id = String(req.params?.id || '').trim();
    if (!id) return res.status(400).json({ error: 'missing_id' });

    const name = String(req.body?.name || '').trim();
    if (!name) return res.status(400).json({ error: 'missing_name' });

    const address = String(req.body?.address || '').trim();
    const city = String(req.body?.city || '').trim();
    const floor = String(req.body?.floor || '').trim();
    const managerName = String(req.body?.managerName || '').trim();
    const phone = String(req.body?.phone || '').trim();
    const openDate = String(req.body?.openDate || '').trim() || null;
    const brandName = String(req.body?.brand || req.body?.brandName || '').trim();
    const brandId = normalizeBrandId(req.body?.brandId || brandName);
    const isActive = req.body?.status ? String(req.body.status) === 'active' : true;
    const region = String(req.body?.region || '').trim();
    const profileFields = extractStoreProfileFields(req.body);

    try {
      const state0 = (await getSharedState()) || {};
      const stores = Array.isArray(state0?.stores) ? state0.stores.slice() : [];
      const idx = stores.findIndex((s) => String(s?.id || '').trim() === id);
      if (idx < 0) return res.status(404).json({ error: 'not_found' });
      const prev = stores[idx] || {};
      stores[idx] = {
        ...prev,
        id,
        name,
        address,
        city,
        floor,
        managerName,
        manager: managerName,
        phone,
        openDate,
        status: isActive ? 'active' : 'inactive',
        brand: brandName,
        brandName,
        brandId,
        region,
        ...profileFields,
        updatedAt: hrmsNowISO()
      };
      const nextState = { ...state0, stores };
      if (Array.isArray(nextState.brands)) {
        nextState.brands = getBrandsFromState(nextState);
      }
      await saveSharedState(nextState);
      syncStoreProfileToChairmanConfig(pool, name, brandName, profileFields).catch(() => {});
      return res.json({ item: stores[idx] });
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: 'internal_error' });
    }
  });
}
