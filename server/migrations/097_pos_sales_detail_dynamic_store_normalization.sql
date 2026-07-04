-- 097_pos_sales_detail_dynamic_store_normalization.sql
-- 把pos_sales_detail视图里的硬编码CASE WHEN门店映射收口到store_name_aliases表。
-- 此前：CASE WHEN store_name LIKE '洪潮%' THEN '洪潮大宁久光店' 等2条硬编码
-- 之后：resolve_store_canonical_name(store_name) — 通过store_name_aliases动态查找
-- 新租户只需往store_name_aliases插入对应行，无需改视图代码。

-- 1. 补入POS原始门店名（source='pos'）。
--    pos_order_items.store_name的实际原值与store_name_aliases里已有别名不同：
--    POS实际名：'洪潮传统潮汕菜【大宁久光中心店】'/'马己仙广东小馆·荔枝木烧鹅（大宁音乐广场店）'
--    需要精确匹配，旧的前缀LIKE '洪潮%'/'马己仙%'虽然也能匹配，但不是明确的别名记录。
INSERT INTO store_name_aliases (tenant_id, canonical_name, alias_name, source, enabled)
VALUES
  ('default', '洪潮大宁久光店', '洪潮传统潮汕菜【大宁久光中心店】', 'pos', TRUE),
  ('default', '马己仙上海音乐广场店', '马己仙广东小馆·荔枝木烧鹅（大宁音乐广场店）', 'pos', TRUE)
ON CONFLICT (tenant_id, alias_name) DO NOTHING;

-- 2. 查找函数：精确匹配alias_name，查不到原样返回。
--    STABLE：同一query里对同一参数仅调一次；SQL函数会被inlined，RLS自动生效。
--    多租户场景下：RLS过滤store_name_aliases到当前租户，函数天然租户隔离。
CREATE OR REPLACE FUNCTION resolve_store_canonical_name(p_raw text)
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    (SELECT canonical_name FROM store_name_aliases
     WHERE alias_name = p_raw AND enabled = TRUE
     LIMIT 1),
    p_raw
  );
$$;

-- 3. 重建pos_sales_detail视图，用函数替换硬编码CASE WHEN。
--    列顺序/类型与旧视图完全一致，下游查询代码无需改动。
CREATE OR REPLACE VIEW pos_sales_detail AS
SELECT
  resolve_store_canonical_name(pos_order_items.store_name) AS store,
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
     AND EXTRACT(hour FROM (pos_order_items.order_time AT TIME ZONE 'Asia/Shanghai')) < 14
      THEN 'lunch'
    WHEN EXTRACT(hour FROM (pos_order_items.order_time AT TIME ZONE 'Asia/Shanghai')) >= 14
     AND EXTRACT(hour FROM (pos_order_items.order_time AT TIME ZONE 'Asia/Shanghai')) < 17
      THEN 'afternoon'
    WHEN EXTRACT(hour FROM (pos_order_items.order_time AT TIME ZONE 'Asia/Shanghai')) >= 17
     AND EXTRACT(hour FROM (pos_order_items.order_time AT TIME ZONE 'Asia/Shanghai')) < 22
      THEN 'dinner'
    ELSE 'other'
  END AS slot,
  pos_order_items.order_time,
  pos_order_items.checkout_time,
  EXTRACT(isodow FROM pos_order_items.biz_date)::integer AS weekday,
  pos_order_items.tenant_id
FROM pos_order_items;
