/**
 * @param {import('express').Express} app
 * @param {(req,res,next)=>void} authRequired
 */
export function registerStoreLocationRoute(app, authRequired, deps) {
  const { getSharedState, saveSharedState } = deps;

  app.post('/api/stores/:name/location', authRequired, async (req, res) => {
    const role = String(req.user?.role || '').trim();
    if (role !== 'admin') return res.status(403).json({ error: 'forbidden' });
    const storeName = decodeURIComponent(String(req.params?.name || '').trim());
    const lat = Number(req.body?.latitude);
    const lng = Number(req.body?.longitude);
    const address = String(req.body?.address || '').trim();
    if (!storeName) return res.status(400).json({ error: 'missing_store' });
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return res.status(400).json({ error: 'missing_location' });
    try {
      const state = (await getSharedState()) || {};
      const stores = Array.isArray(state.stores) ? state.stores.slice() : [];
      const idx = stores.findIndex(s => String(s?.name || '').trim() === storeName);
      if (idx < 0) return res.status(404).json({ error: 'store_not_found' });
      stores[idx] = { ...stores[idx], latitude: lat, longitude: lng, address: address || stores[idx].address || '' };
      await saveSharedState({ ...state, stores });
      return res.json({ store: stores[idx] });
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: 'internal_error' });
    }
  });
}
