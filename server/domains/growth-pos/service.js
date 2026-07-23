/**
 * POS 订单查询/上传薄路由（不含巨型 pos-stats / feishu-sync）。
 * ingest / link 仍由 growth-phases 注入，避免打断 customer-ops 对 ingestPosOrders 的依赖。
 */
import { cleanText } from '../growth-phase-auth.js';

export async function listPosOrders(pool, query = {}) {
  const sid = cleanText(query.store_id || '', 128);
  const phone = cleanText(query.phone || '', 32);
  const from = query.from || '';
  const to = query.to || '';
  const limit = Math.min(Math.max(Number(query.limit) || 200, 1), 1000);
  const conds = ['1=1'];
  const params = [];
  let pi = 1;
  if (sid) {
    conds.push(`store_id=$${pi++}`);
    params.push(sid);
  }
  if (phone) {
    conds.push(`phone=$${pi++}`);
    params.push(phone);
  }
  if (from) {
    conds.push(`biz_date>=$${pi++}`);
    params.push(from);
  }
  if (to) {
    conds.push(`biz_date<=$${pi++}`);
    params.push(to);
  }
  params.push(limit);
  const r = await pool.query(
    `SELECT * FROM pos_orders WHERE ${conds.join(' AND ')} ORDER BY biz_date DESC, order_time DESC LIMIT $${pi}`,
    params
  );
  return r.rows || [];
}

export async function listPosOrderItems(pool, orderNoRaw) {
  const orderNo = cleanText(orderNoRaw || '', 64);
  if (!orderNo) {
    const err = new Error('missing order_no');
    err.code = 'bad_request';
    throw err;
  }
  const r = await pool.query('SELECT * FROM pos_order_items WHERE order_no=$1 ORDER BY id', [orderNo]);
  return r.rows || [];
}

export async function listCustomerOrders(pool, query = {}) {
  const phone = cleanText(query.phone || '', 32);
  const cid = query.customer_id ? Number(query.customer_id) : null;
  if (!phone && !cid) {
    const err = new Error('missing phone or customer_id');
    err.code = 'bad_request';
    throw err;
  }
  const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200);
  const r = phone
    ? await pool.query('SELECT * FROM pos_orders WHERE phone=$1 ORDER BY biz_date DESC LIMIT $2', [phone, limit])
    : await pool.query('SELECT * FROM pos_orders WHERE customer_id=$1 ORDER BY biz_date DESC LIMIT $2', [cid, limit]);
  return r.rows || [];
}

export async function listPosLinkedCustomers(pool, { storeId = '', days: daysRaw } = {}) {
  const sid = cleanText(storeId || '', 128);
  const days = Math.min(Math.max(Number(daysRaw) || 30, 1), 365);
  const r = await pool.query(
    `
      SELECT po.phone, gc.id AS customer_id, gc.openid, gcp.lifecycle_stage, gcp.price_sensitivity,
             COUNT(*)::int AS order_count, SUM(po.amount_after_discount) AS total_revenue,
             MIN(po.biz_date) AS first_order, MAX(po.biz_date) AS last_order
      FROM pos_orders po
      LEFT JOIN growth_customers gc ON po.phone = gc.phone
      LEFT JOIN growth_customer_profiles gcp ON gc.id = gcp.customer_id
      WHERE po.phone <> '' AND po.biz_date >= CURRENT_DATE - ($1::int || ' days')::interval
        AND ($2='' OR po.store_id=$2)
      GROUP BY po.phone, gc.id, gc.openid, gcp.lifecycle_stage, gcp.price_sensitivity
      ORDER BY total_revenue DESC NULLS LAST LIMIT 200
    `,
    [days, sid]
  );
  return r.rows || [];
}

export function listHardcodedGrowthStores() {
  return [
    { store_id: '64822111', store_name: '洪潮大宁久光店' },
    { store_id: '51866138', store_name: '马己仙上海音乐广场店' },
  ];
}
