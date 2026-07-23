/**
 * 企微客户导入/列表（从 growth-phases Phase 2 外提）。
 */
import { tenantContext } from '../../utils/database.js';
import { cleanPhone, cleanText } from '../growth-phase-auth.js';

export async function matchBatchToGrowthCustomers(pool, batch) {
  const matched = await pool.query(
    `UPDATE wechat_work_customers w SET bind_customer_id=g.id,updated_at=NOW()
     FROM growth_customers g WHERE w.phone=g.phone AND w.bind_customer_id IS NULL AND w.import_batch=$1`,
    [batch]
  );
  return matched.rowCount || 0;
}

export async function importWechatCustomersManual(pool, resolveTenantIdForStore, customersInput) {
  const batch = `manual_${Date.now()}`;
  const customers = Array.isArray(customersInput) ? customersInput : [customersInput];
  let imported = 0;
  let lastTenantId = 'default';
  for (const c of customers) {
    const phone = cleanPhone(c.phone || '');
    if (!phone) continue;
    const sid = cleanText(c.store_id, 128);
    const tenantId = await resolveTenantIdForStore(pool, sid);
    lastTenantId = tenantId;
    await tenantContext.run(tenantId, () =>
      pool.query(
        'INSERT INTO wechat_work_customers(external_userid,name,phone,store_id,note,import_batch,tenant_id) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING',
        [
          cleanText(c.external_userid, 128),
          cleanText(c.name, 200),
          phone,
          sid,
          cleanText(c.note, 500),
          batch,
          tenantId,
        ]
      )
    );
    imported++;
  }
  const matched = await tenantContext.run(lastTenantId, () => matchBatchToGrowthCustomers(pool, batch));
  return { imported, matched, batch };
}

export async function listWechatCustomers(pool, storeId) {
  const sid = cleanText(storeId || '', 128);
  const r = await pool.query(
    `SELECT w.*,g.openid bound_openid,g.phone bound_phone FROM wechat_work_customers w LEFT JOIN growth_customers g ON w.bind_customer_id=g.id
     WHERE ($1='' OR w.store_id=$1) ORDER BY w.created_at DESC LIMIT 500`,
    [sid]
  );
  const total = r.rows.length;
  const bound = r.rows.filter((x) => x.bind_customer_id).length;
  return { total, bound, unbound: total - bound, customers: r.rows };
}

export async function wechatCustomerStats(pool) {
  const r = await pool.query(`SELECT store_id,COUNT(*)::int total,
        COUNT(*) FILTER(WHERE bind_customer_id IS NOT NULL)::int bound,
        COUNT(*) FILTER(WHERE bind_customer_id IS NULL)::int unbound
        FROM wechat_work_customers GROUP BY store_id ORDER BY store_id`);
  return r.rows || [];
}

/**
 * Feishu bitable 导入依赖 getFeishuBitableData（由 deps 注入，避免反向 import index）。
 */
export async function importWechatCustomersFromFeishu(pool, resolveTenantIdForStore, getFeishuBitableData, body = {}) {
  const b = body && typeof body === 'object' ? body : {};
  const appToken = cleanText(b.app_token, 200);
  const tableId = cleanText(b.table_id, 200);
  const batch = `batch_${Date.now()}`;
  if (!appToken || !tableId) {
    const err = new Error('missing app_token or table_id');
    err.code = 'bad_request';
    throw err;
  }
  let records = [];
  try {
    const data = await getFeishuBitableData(appToken, tableId, b.access_token || '');
    records = data?.data?.items || data?.data?.records || data?.items || [];
  } catch {
    records = [];
  }
  let imported = 0;
  let lastTenantId = 'default';
  for (const rec of records) {
    const f = rec.fields || rec;
    const phone = cleanPhone(f.phone || f.手机号 || f.mobile || '');
    const name = cleanText(f.name || f.姓名 || f.昵称 || '', 200);
    const eid = cleanText(f.external_userid || f.userid || f.user_id || '', 128);
    const sid = cleanText(f.store_id || f.门店 || '', 128);
    const note = cleanText(f.note || f.备注 || '', 500);
    if (!(phone || eid)) continue;
    const tenantId = await resolveTenantIdForStore(pool, sid);
    lastTenantId = tenantId;
    const ins = await tenantContext.run(tenantId, () =>
      pool.query(
        'INSERT INTO wechat_work_customers(external_userid,name,phone,store_id,note,import_batch,tenant_id) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING RETURNING id',
        [eid, name, phone, sid, note, batch, tenantId]
      )
    );
    if (ins.rows.length) imported++;
  }
  const matched = await tenantContext.run(lastTenantId, () => matchBatchToGrowthCustomers(pool, batch));
  return { imported, matched, batch };
}
