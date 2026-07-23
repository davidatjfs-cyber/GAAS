/**
 * 增长发券：growth_coupons 表读写（从 growth-phases registerPhaseRoutes 外提）。
 * 不接触 req/res。
 */

function cleanText(value, max = 255) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

/**
 * @param {import('pg').Pool} pool
 * @param {string} tenantId
 * @param {object} body
 */
export async function upsertGrowthCoupon(pool, tenantId, body = {}) {
  const b = body && typeof body === 'object' ? body : {};
  const tid = String(tenantId || 'default');
  // stock 缺失时 Number(undefined) 为 NaN；必须用 isFinite，否则会把 NaN 写入整数列
  const stockRaw = Number(b.stock);
  const stock = Number.isFinite(stockRaw) ? Math.floor(stockRaw) : -1;
  const r = await pool.query(
    `INSERT INTO growth_coupons (coupon_id,name,type,value_fen,price_fen,valid_days,stock,usage_rule,dish_name,is_active,store_id,tenant_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT (coupon_id, tenant_id) DO UPDATE SET name=EXCLUDED.name,is_active=EXCLUDED.is_active,updated_at=NOW() RETURNING *`,
    [
      cleanText(b.coupon_id, 128),
      cleanText(b.name, 300),
      cleanText(b.type || 'cash', 40),
      Math.max(0, Math.floor(Number(b.value_fen) || 0)),
      Math.max(0, Math.floor(Number(b.price_fen) || 0)),
      Math.max(1, Math.floor(Number(b.valid_days) || 30)),
      stock,
      cleanText(b.usage_rule, 500),
      cleanText(b.dish_name, 500),
      b.is_active !== false,
      cleanText(b.store_id, 128),
      tid,
    ]
  );
  return r.rows[0] || null;
}

/**
 * @param {import('pg').Pool} pool
 * @param {string} [_tenantId] 现状 GET 不按租户过滤（见集成测注释）
 */
export async function listGrowthCoupons(pool, _tenantId) {
  const r = await pool.query('SELECT * FROM growth_coupons ORDER BY created_at DESC LIMIT 300');
  return r.rows || [];
}
