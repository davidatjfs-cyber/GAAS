/**
 * POS 订单 upsert / 客户关联 / 销售快照刷新。
 * customer-ops 经 growth-phases re-export 引用 ingestPosOrders。
 */
import { resolveTenantIdDefault } from '../../utils/database.js';
import { maybeNotifyRegularCustomerFromPosOrder } from '../../pos-regular-arrival-feishu.js';
import { cleanText } from '../growth-phase-auth.js';
import { cnDate, parseKeruyunDateTime, parseKeruyunPhone, parseNum } from './keruyun.js';
import { childLogger } from '../../utils/logger.js';

const log = childLogger({ domain: 'growth-pos', handler: 'ingest' });


export async function refreshSalesGrowthSnapshot(pool, days = 3, tenantId = resolveTenantIdDefault()) {
  const effectiveTenantId = resolveTenantIdDefault(tenantId);
  const r = await pool.query(
    `
    INSERT INTO sales_growth_snapshot
      (snapshot_date, store_code, dish_name, category, order_count, qty, revenue, avg_unit_price, lunch_qty, dinner_qty, updated_at, tenant_id)
    SELECT
      i.biz_date                                        AS snapshot_date,
      COALESCE(i.store_code, '')                        AS store_code,
      COALESCE(i.dish_name, '')                         AS dish_name,
      COALESCE(MAX(i.category), '')                      AS category,
      COUNT(DISTINCT i.order_no)                        AS order_count,
      SUM(i.qty)::INTEGER                               AS qty,
      SUM(i.amount_after_discount)                      AS revenue,
      CASE WHEN SUM(i.qty) > 0
           THEN ROUND(SUM(i.amount_after_discount) / SUM(i.qty), 2)
           ELSE 0 END                                   AS avg_unit_price,
      SUM(CASE WHEN EXTRACT(HOUR FROM i.order_time AT TIME ZONE 'Asia/Shanghai') BETWEEN 10 AND 13
               THEN i.qty ELSE 0 END)::INTEGER          AS lunch_qty,
      SUM(CASE WHEN EXTRACT(HOUR FROM i.order_time AT TIME ZONE 'Asia/Shanghai') BETWEEN 16 AND 20
               THEN i.qty ELSE 0 END)::INTEGER          AS dinner_qty,
      NOW()                                             AS updated_at,
      $2::varchar(80)                                   AS tenant_id
    FROM pos_order_items i
    WHERE i.biz_date >= CURRENT_DATE - ($1::int * INTERVAL '1 day')
      AND i.biz_date <= CURRENT_DATE
      AND i.dish_name IS NOT NULL AND i.dish_name <> ''
      AND i.store_code IS NOT NULL AND i.store_code <> ''
      AND i.tenant_id = $2::varchar(80)
    GROUP BY i.biz_date, i.store_code, i.dish_name
    ON CONFLICT (snapshot_date, store_code, dish_name, tenant_id)
    DO UPDATE SET
      category       = EXCLUDED.category,
      order_count    = EXCLUDED.order_count,
      qty            = EXCLUDED.qty,
      revenue        = EXCLUDED.revenue,
      avg_unit_price = EXCLUDED.avg_unit_price,
      lunch_qty      = EXCLUDED.lunch_qty,
      dinner_qty     = EXCLUDED.dinner_qty,
      updated_at     = NOW()
  `,
    [Number(days || 0), effectiveTenantId]
  );
  return r.rowCount;
}

export function clampSnapshotDays(raw) {
  return Math.min(Math.max(parseInt(raw ?? '7', 10) || 7, 1), 90);
}

export async function linkPosOrdersToCustomers(pool) {
  const r = await pool.query(`
    UPDATE pos_orders o
    SET customer_id = gc.id
    FROM growth_customers gc
    WHERE o.phone <> '' AND o.phone = gc.phone AND o.customer_id IS NULL
  `);
  await pool.query(`
    UPDATE growth_customer_profiles gcp
    SET pos_order_count = s.order_cnt,
        pos_total_spend = s.total_spend,
        pos_dine_in_ratio = CASE WHEN s.order_cnt > 0 THEN
          ROUND(((s.dine_cnt)::numeric / s.order_cnt), 2) ELSE NULL END,
        pos_last_order_at = s.last_order
    FROM (
      SELECT gcp2.customer_id,
             COUNT(po.id)::int AS order_cnt,
             COALESCE(SUM(po.amount_after_discount),0) AS total_spend,
             COUNT(*) FILTER (WHERE po.order_type = '堂食') AS dine_cnt,
             MAX(po.order_time) AS last_order
      FROM growth_customer_profiles gcp2
      JOIN growth_customers gc ON gc.id = gcp2.customer_id
      JOIN pos_orders po ON po.phone = gc.phone
      WHERE gcp2.phone IS NOT NULL AND gcp2.phone <> ''
      GROUP BY gcp2.customer_id
    ) s
    WHERE gcp.customer_id = s.customer_id
  `);
  return r.rowCount;
}

export async function ingestPosOrders(pool, tenantId, { orders = [], items = [], storeId = '' } = {}) {
  let ordersUpserted = 0;
  let itemsUpserted = 0;
  if (orders.length) {
    for (const o of orders) {
      const phone = parseKeruyunPhone(o.phone || o.member_phone || '');
      const bizDate = cnDate(o.biz_date);
      const resolvedStoreId = storeId || cleanText(o.store_id || '', 128);
      await pool.query(
        `
        INSERT INTO pos_orders(seq_no,order_no,order_source,biz_date,order_time,checkout_time,order_status,amount_before_discount,total_discount,amount_after_discount,payment_method,payment_count,member_name,phone,order_type,table_no,diners,duration,store_name,store_id,tenant_id)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
        ON CONFLICT(order_no, tenant_id) DO UPDATE SET
          order_source=EXCLUDED.order_source,
          checkout_time=COALESCE(EXCLUDED.checkout_time,pos_orders.checkout_time),
          order_status=COALESCE(EXCLUDED.order_status,pos_orders.order_status),
          amount_before_discount=EXCLUDED.amount_before_discount,total_discount=EXCLUDED.total_discount,
          amount_after_discount=EXCLUDED.amount_after_discount,
          payment_method=COALESCE(EXCLUDED.payment_method,pos_orders.payment_method),
          payment_count=EXCLUDED.payment_count,
          phone=COALESCE(NULLIF(EXCLUDED.phone,''),pos_orders.phone),
          member_name=COALESCE(NULLIF(EXCLUDED.member_name,'-'),NULLIF(EXCLUDED.member_name,''),pos_orders.member_name),
          table_no=COALESCE(NULLIF(EXCLUDED.table_no,''),pos_orders.table_no),
          diners=COALESCE(EXCLUDED.diners,pos_orders.diners),
          duration=COALESCE(NULLIF(EXCLUDED.duration,''),pos_orders.duration),
          store_name=COALESCE(NULLIF(EXCLUDED.store_name,''),pos_orders.store_name),
          seq_no=COALESCE(NULLIF(EXCLUDED.seq_no,''),pos_orders.seq_no),
          synced_at=NOW()
      `,
        [
          cleanText(o.seq_no || '', 32),
          cleanText(o.order_no || '', 64),
          cleanText(o.order_source || '', 80),
          bizDate || null,
          parseKeruyunDateTime(o.order_time),
          parseKeruyunDateTime(o.checkout_time),
          cleanText(o.order_status || '', 40),
          parseNum(o.amount_before_discount),
          parseNum(o.total_discount),
          parseNum(o.amount_after_discount),
          cleanText(o.payment_method || '', 80),
          Number(o.payment_count) || 0,
          cleanText(o.member_name || '', 100),
          phone,
          cleanText(o.order_type || '', 40),
          cleanText(o.table_no || '', 40),
          Number(o.diners) || null,
          cleanText(o.duration || '', 40),
          cleanText(o.store_name || '', 200),
          resolvedStoreId,
          tenantId,
        ]
      );
      ordersUpserted++;
      if (phone) {
        maybeNotifyRegularCustomerFromPosOrder(pool, {
          tenantId,
          storeId: resolvedStoreId,
          storeName: cleanText(o.store_name || '', 200),
          phone,
          orderNo: cleanText(o.order_no || '', 64),
          tableNo: cleanText(o.table_no || '', 40),
          bizDate: bizDate || '',
          checkoutTime: parseKeruyunDateTime(o.checkout_time),
        }).catch((e) => log.warn({ msg: 'pos_regular_arrival', err: e?.message || e }));
      }
    }
  }

  if (items.length) {
    for (const it of items) {
      const itemBizDate = cnDate(it.biz_date);
      await pool.query(
        `
        INSERT INTO pos_order_items(biz_date,store_name,store_code,order_no,sku,dish_name,department,table_name,table_area,sale_type,category_mid,category,spec,unit,order_type,order_source,qty,amount_before_discount,discount,service_fee,amount_after_discount,order_time,checkout_time,tenant_id)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
        ON CONFLICT DO NOTHING
      `,
        [
          itemBizDate || null,
          cleanText(it.store_name || '', 200),
          cleanText(it.store_code || '', 64),
          cleanText(it.order_no || '', 128),
          cleanText(it.sku || '', 64),
          cleanText(it.dish_name || '', 300),
          cleanText(it.department || '', 100),
          cleanText(it.table_name || '', 100),
          cleanText(it.table_area || '', 100),
          cleanText(it.sale_type || '', 40),
          cleanText(it.category_mid || '', 100),
          cleanText(it.category || '', 100),
          cleanText(it.spec || '', 100),
          cleanText(it.unit || '', 20),
          cleanText(it.order_type || '', 40),
          cleanText(it.order_source || '', 200),
          parseNum(it.qty),
          parseNum(it.amount_before_discount),
          parseNum(it.discount),
          parseNum(it.service_fee),
          parseNum(it.amount_after_discount),
          parseKeruyunDateTime(it.order_time),
          parseKeruyunDateTime(it.checkout_time),
          tenantId,
        ]
      );
      itemsUpserted++;
    }
  }

  const customersLinked = await linkPosOrdersToCustomers(pool);
  return { ordersUpserted, itemsUpserted, customersLinked };
}
