// 字段名与 agents-service-v2 chairman_config 的 store profile 保持一致，方便 syncStoreProfileToChairmanConfig 直接映射。
export function extractStoreProfileFields(body = {}) {
  const s = (v) => String(v || '').trim();
  const n = (v) => (v === undefined || v === null || v === '' ? undefined : Number(v));
  return {
    positioning: s(body.positioning),
    targetCustomer: s(body.targetCustomer),
    coreStrategy: s(body.coreStrategy),
    bottleneck: s(body.bottleneck),
    businessHours: s(body.businessHours),
    peakHours: Array.isArray(body.peakHours) ? body.peakHours.map(s).filter(Boolean) : [],
    seats: n(body.seats),
    tables: n(body.tables),
    avgPrice: n(body.avgPrice),
    area: n(body.area),
    privateRooms: n(body.privateRooms),
    kitchenCapacity: n(body.kitchenCapacity),
    signatureProducts: s(body.signatureProducts),
    competitiveAdvantage: s(body.competitiveAdvantage),
    serviceStyle: s(body.serviceStyle),
    lowSeasonNote: s(body.lowSeasonNote),
    hasTakeout: !!body.hasTakeout,
    target_daily_dineIn: body.target_daily_dineIn && typeof body.target_daily_dineIn === 'object' ? body.target_daily_dineIn : undefined,
    target_daily_takeout: body.target_daily_takeout && typeof body.target_daily_takeout === 'object' ? body.target_daily_takeout : undefined,
    cost_structure: body.cost_structure && typeof body.cost_structure === 'object' ? body.cost_structure : undefined,
    topDishes: Array.isArray(body.topDishes) ? body.topDishes : undefined,
    problemDishes: Array.isArray(body.problemDishes) ? body.problemDishes : undefined,
  };
}

// 门店在"编辑门店"里保存画像后，同时写一份到 chairman_config（agents-service-v2 用它给AI agent注入上下文），
// 失败不阻塞门店保存本身。
export async function syncStoreProfileToChairmanConfig(pool, storeName, brandName, profile) {
  if (!storeName) return;
  try {
    const r = await pool.query(`SELECT data FROM hrms_state WHERE key = 'chairman_config' LIMIT 1`);
    const current = r.rows?.[0]?.data || {};
    const stores = { ...(current.stores || {}) };
    const prevProfile = stores[storeName] || {};
    stores[storeName] = { ...prevProfile, brand: brandName || prevProfile.brand, ...profile };
    const next = { ...current, stores };
    await pool.query(
      `INSERT INTO hrms_state (key, data, updated_at) VALUES ('chairman_config', $1::jsonb, NOW())
       ON CONFLICT (key) DO UPDATE SET data = $1::jsonb, updated_at = NOW()`,
      [JSON.stringify(next)]
    );
  } catch (e) {
    console.warn('[stores] chairman_config sync skipped:', e?.message);
  }
}
