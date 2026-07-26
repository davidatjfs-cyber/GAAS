/**
 * Upsert growth_customers + customer_identities (P4 peel from growth-api.js).
 */

/**
 * @param {{ query: Function }} pool
 * @param {object} payload
 * @param {string} [tenantId]
 * @param {{ cleanText: Function, cleanPhone: Function }} deps
 */
export async function upsertCustomer(pool, payload, tenantId = 'default', deps) {
  const { cleanText, cleanPhone } = deps;
  const phone = cleanPhone(payload.phone);
  const openid = cleanText(payload.openid, 128);
  const externalUserId = cleanText(payload.external_userid, 128);
  const storeId = cleanText(payload.store_id, 128);
  const meta = payload.customer_meta && typeof payload.customer_meta === 'object' ? payload.customer_meta : {};

  if (!phone && !openid && !externalUserId) return null;

  let existing = null;
  if (phone) {
    const r = await pool.query('SELECT * FROM growth_customers WHERE phone = $1 AND tenant_id = $2 LIMIT 1', [phone, tenantId]);
    existing = r.rows[0] || null;
  }
  if (!existing && openid) {
    const r = await pool.query('SELECT * FROM growth_customers WHERE openid = $1 AND tenant_id = $2 LIMIT 1', [openid, tenantId]);
    existing = r.rows[0] || null;
  }

  // 若按手机号匹配到的记录将把 openid 改写为另一条记录已占用的值（同一 openid 此前绑定在不同/无手机号的记录上），
  // 先释放该记录的 openid，避免下面的 UPDATE 触发 uq_growth_customers_openid 冲突。
  if (existing && openid && existing.openid !== openid) {
    const conflict = await pool.query('SELECT id FROM growth_customers WHERE openid = $1 AND tenant_id = $2 LIMIT 1', [openid, tenantId]);
    const conflictId = conflict.rows[0]?.id;
    if (conflictId && conflictId !== existing.id) {
      await pool.query('UPDATE growth_customers SET openid = NULL, updated_at = NOW() WHERE id = $1', [conflictId]);
    }
  }

  if (existing) {
    const r = await pool.query(
      `UPDATE growth_customers SET
         phone = COALESCE(NULLIF($2,''), phone),
         openid = COALESCE(NULLIF($3,''), openid),
         external_userid = COALESCE(NULLIF($4,''), external_userid),
         first_store_id = COALESCE(first_store_id, NULLIF($5,'')),
         last_store_id = COALESCE(NULLIF($5,''), last_store_id),
         last_seen_at = NOW(),
         meta = COALESCE(meta, '{}'::jsonb) || $6::jsonb,
         updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [existing.id, phone, openid, externalUserId, storeId, JSON.stringify(meta)]
    );
    existing = r.rows[0];
  } else {
    const r = await pool.query(
      `INSERT INTO growth_customers (phone, openid, external_userid, first_store_id, last_store_id, meta, tenant_id)
       VALUES (NULLIF($1,''), NULLIF($2,''), NULLIF($3,''), NULLIF($4,''), NULLIF($4,''), $5::jsonb, $6)
       ON CONFLICT (openid, tenant_id) WHERE openid IS NOT NULL AND openid <> '' DO UPDATE SET
         phone = COALESCE(growth_customers.phone, EXCLUDED.phone),
         external_userid = COALESCE(EXCLUDED.external_userid, growth_customers.external_userid),
         last_store_id = COALESCE(EXCLUDED.last_store_id, growth_customers.last_store_id),
         last_seen_at = NOW(),
         meta = COALESCE(growth_customers.meta, '{}'::jsonb) || EXCLUDED.meta,
         updated_at = NOW()
       RETURNING *`,
      [phone, openid, externalUserId, storeId, JSON.stringify(meta), tenantId]
    );
    existing = r.rows[0];
  }

  const identities = [
    ['phone', phone],
    ['openid', openid],
    ['external_userid', externalUserId]
  ].filter(([, value]) => value);
  for (const [type, value] of identities) {
    await pool.query(
      `INSERT INTO customer_identities (customer_id, identity_type, identity_value, source, tenant_id)
       VALUES ($1,$2,$3,'miniprogram',$4)
       ON CONFLICT (identity_type, identity_value, tenant_id)
       DO UPDATE SET customer_id = EXCLUDED.customer_id, updated_at = NOW()`,
      [existing.id, type, value, tenantId]
    );
  }

  return existing;
}
