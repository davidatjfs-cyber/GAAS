import { extractStoreProfileFields, syncStoreProfileToChairmanConfig } from './profile.js';
import { childLogger } from '../../utils/logger.js';

const log = childLogger({ domain: 'stores' });

/**
 * @param {import('express').Express} app
 * @param {(req,res,next)=>void} authRequired
 * @param {{
 *   pool: import('pg').Pool,
 *   getSharedState: () => Promise<object>,
 *   saveSharedState: (state: object) => Promise<void>,
 *   resolveTenantIdDefault: (tenantId?: string) => string,
 *   getCreditRisk: (pool: import('pg').Pool, leadId: unknown) => Promise<{ can_open_store?: boolean, payment_type?: string } | null>,
 *   hrmsNowISO: () => string,
 *   normalizeBrandId: (v: unknown) => string,
 *   getBrandsFromState: (state: object) => Array<object>,
 * }} deps
 */
export function registerStoresCrudRoutes(app, authRequired, deps) {
  const {
    pool,
    getSharedState,
    saveSharedState,
    resolveTenantIdDefault,
    getCreditRisk,
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

  app.get('/api/stores', authRequired, async (req, res) => {
    try {
      const r = await pool.query('select data from hrms_state where key = $1 limit 1', [req.tenantId || req.user?.tenant_id || 'default']);
      const row = r.rows?.[0] || null;
      if (!row || !row.data) {
        return res.json({ items: [] });
      }

      const stateStores = Array.isArray(row.data.stores) ? row.data.stores : [];
      const items = stateStores.map(s => ({
        id: s.id || s.name,
        name: s.name,
        address: s.address || '',
        city: s.city || '',
        floor: s.floor || '',
        manager_name: s.manager || s.managerName || '',
        managerName: s.manager || s.managerName || '',
        phone: s.phone || '',
        openDate: s.openDate || s.open_date || '',
        brand: s.brand || s.brandName || '',
        brandName: s.brand || s.brandName || '',
        brandId: normalizeBrandId(s.brandId || s.brand || s.brandName),
        region: s.region || '',
        status: String(s.status || 'active') === 'active' ? 'active' : 'inactive',
        is_active: String(s.status || 'active') === 'active'
      }));

      log.debug({ msg: 'stores_list', names: items.map((s) => s.name) });
      return res.json({ items });
    } catch (e) {
      log.error({ msg: 'stores_list_failed', request_id: req.requestId, err: e?.message || String(e) });
      return res.status(500).json({ error: 'server_error', message: 'internal_error' });
    }
  });

  app.post('/api/stores', authRequired, async (req, res) => {
    const role = String(req.user?.role || '').trim();
    if (role !== 'admin' && role !== 'hq_manager') {
      return res.status(403).json({ error: 'forbidden', message: '仅管理员可创建门店' });
    }
    const name = String(req.body?.name || '').trim();
    if (!name) return res.status(400).json({ error: 'missing_name' });

    try {
      const tenantId = resolveTenantIdDefault();
      const risk = await pool.query(
        `SELECT ca.lead_id FROM sales_credit_accounts ca
          JOIN sales_leads sl ON sl.id=ca.lead_id
         WHERE sl.tenant_id=$1
         ORDER BY ca.updated_at DESC LIMIT 1`, [tenantId]
      );
      const creditRisk = risk.rows?.[0] ? await getCreditRisk(pool, risk.rows[0].lead_id) : null;
      if (creditRisk && !creditRisk.can_open_store) {
        const message = creditRisk.payment_type === 'cash'
          ? '现金客户存在未结清合同，禁止新增门店；请先由财务确认足额回款。'
          : '该客户欠款已超过授信额度，账户已锁定新增门店；请联系总经理重新授信。';
        return res.status(423).json({ error: 'credit_account_locked', message });
      }
    } catch (e) {
      log.error({ msg: 'stores_credit_risk_check_failed', request_id: req.requestId, err: e?.message || String(e) });
      return res.status(500).json({ error: 'server_error', message: 'credit_risk_check_failed' });
    }

    try {
      const tenantForQuota = resolveTenantIdDefault();
      const storeLicenseR = await pool.query(`SELECT COUNT(*)::int AS max_stores FROM tenant_store_licenses WHERE tenant_id=$1 AND status='active' AND expires_at>=NOW()`, [tenantForQuota]);
      const licenseR = await pool.query(`SELECT max_stores FROM licenses WHERE tenant_id=$1 AND status IN ('active','trial') ORDER BY created_at DESC LIMIT 1`, [tenantForQuota]);
      const maxStores = Number(storeLicenseR.rows?.[0]?.max_stores || 0) || licenseR.rows?.[0]?.max_stores;
      if (maxStores != null) {
        const state0 = (await getSharedState()) || {};
        const currentCount = Array.isArray(state0?.stores) ? state0.stores.length : 0;
        if (currentCount >= maxStores) {
          return res.status(403).json({
            error: 'store_quota_exceeded',
            message: `已达门店数量上限(${currentCount}/${maxStores})，如需增加门店请联系客户成功经理购买更多门店额度`,
            current: currentCount,
            max: maxStores,
          });
        }
      }
    } catch (e) {
      log.error({ msg: 'stores_quota_check_failed', request_id: req.requestId, err: e?.message || String(e) });
      return res.status(500).json({ error: 'server_error', message: 'quota_check_failed' });
    }

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
      const item = {
        id: `store_${Date.now()}`,
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
        createdAt: hrmsNowISO(),
        updatedAt: hrmsNowISO()
      };
      stores.push(item);
      const nextState = { ...state0, stores };
      nextState.brands = getBrandsFromState(nextState);
      await saveSharedState(nextState);
      syncStoreProfileToChairmanConfig(pool, name, brandName, profileFields).catch(() => {});
      return res.json({ item });
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: 'internal_error' });
    }
  });

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
