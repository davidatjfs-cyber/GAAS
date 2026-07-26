/**
 * WeCom config loaders (P4 peel from growth-api.js).
 */

/**
 * @param {{ query: Function }} pool
 * @param {(pool: object, key: string) => Promise<object|null>} getStateValue
 */
export async function getWecomConfig(pool, getStateValue) {
  const config = await getStateValue(pool, 'growth_wecom_config');
  return config && typeof config === 'object' ? config : null;
}

export async function getStoreWecomConfig(pool, storeId) {
  if (!storeId) return null;
  const r = await pool.query('SELECT * FROM store_wecom_configs WHERE store_id = $1 LIMIT 1', [storeId]);
  return r.rows[0] || null;
}

export async function getAllStoreWecomConfigs(pool) {
  const r = await pool.query('SELECT * FROM store_wecom_configs ORDER BY store_id');
  return r.rows;
}
