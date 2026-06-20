-- 模式2批4: POS数据相关表加 tenant_id，纯加列+默认值，零行为风险。
ALTER TABLE sales_raw ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_sales_raw_tenant ON sales_raw(tenant_id);

ALTER TABLE pos_orders ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_pos_orders_tenant ON pos_orders(tenant_id);

ALTER TABLE pos_order_items ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_pos_order_items_tenant ON pos_order_items(tenant_id);

-- pos_sales_detail 视图重建：补充暴露 tenant_id，供下游查询过滤
CREATE OR REPLACE VIEW pos_sales_detail AS
SELECT
  CASE
    WHEN pos_order_items.store_name LIKE '洪潮%' THEN '洪潮大宁久光店'
    WHEN pos_order_items.store_name LIKE '马己仙%' THEN '马己仙上海音乐广场店'
    ELSE pos_order_items.store_name
  END AS store,
  pos_order_items.biz_date AS date,
  CASE
    WHEN pos_order_items.order_type LIKE '%外卖%' THEN 'takeaway'
    ELSE 'dinein'
  END AS biz_type,
  pos_order_items.dish_name,
  pos_order_items.sku AS dish_code,
  pos_order_items.category,
  NULL::text AS category_code,
  pos_order_items.qty,
  pos_order_items.amount_before_discount AS sales_amount,
  pos_order_items.amount_after_discount AS revenue,
  pos_order_items.discount,
  CASE
    WHEN EXTRACT(hour FROM (pos_order_items.order_time AT TIME ZONE 'Asia/Shanghai')) >= 10
     AND EXTRACT(hour FROM (pos_order_items.order_time AT TIME ZONE 'Asia/Shanghai')) < 14 THEN 'lunch'
    WHEN EXTRACT(hour FROM (pos_order_items.order_time AT TIME ZONE 'Asia/Shanghai')) >= 14
     AND EXTRACT(hour FROM (pos_order_items.order_time AT TIME ZONE 'Asia/Shanghai')) < 17 THEN 'afternoon'
    WHEN EXTRACT(hour FROM (pos_order_items.order_time AT TIME ZONE 'Asia/Shanghai')) >= 17
     AND EXTRACT(hour FROM (pos_order_items.order_time AT TIME ZONE 'Asia/Shanghai')) < 22 THEN 'dinner'
    ELSE 'other'
  END AS slot,
  pos_order_items.order_time,
  pos_order_items.checkout_time,
  EXTRACT(isodow FROM pos_order_items.biz_date)::int AS weekday,
  pos_order_items.tenant_id
FROM pos_order_items;
