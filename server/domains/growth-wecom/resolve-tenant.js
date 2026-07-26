/**
 * Resolve tenant_id from store via employees (P4 peel from growth-api.js).
 */

/**
 * @param {{
 *   employeesTable: string,
 * }} opts
 */
export function createStoreTenantResolver(opts = {}) {
  const employeesTable = opts.employeesTable || 'employees';
  let cache = Object.create(null);
  let cacheAt = 0;

  return async function resolveTenantIdForStore(pool, storeId) {
    const sid = String(storeId || '').trim();
    if (!sid) return 'default';
    const now = Date.now();
    if (now - cacheAt > 300000) { cache = Object.create(null); cacheAt = now; }
    if (cache[sid]) return cache[sid];
    try {
      const r = await pool.query(
        `SELECT tenant_id FROM ${employeesTable} WHERE store = $1 AND tenant_id IS NOT NULL LIMIT 1`,
        [sid]
      );
      const tid = String(r.rows?.[0]?.tenant_id || '').trim() || 'default';
      cache[sid] = tid;
      return tid;
    } catch (_e) {
      return 'default';
    }
  };
}
