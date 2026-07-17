-- 134: 客户档案补齐多品牌/城市/门店、联系人职位与拟申请商务条款。
-- 拟申请条款只用于销售建档和总经理审批参考；最终生效条款仍以合同审批结果
-- 及 sales_credit_pools 为准，销售不能在客户档案里绕过审批修改授信。
ALTER TABLE sales_leads
  ADD COLUMN IF NOT EXISTS customer_brands JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS customer_cities JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS customer_contacts JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS requested_payment_type TEXT,
  ADD COLUMN IF NOT EXISTS requested_credit_days INTEGER,
  ADD COLUMN IF NOT EXISTS requested_credit_limit_fen BIGINT;

-- 历史客户 AI 线索原本只有城市、门店数、POS品牌；迁移到同一份客户主档结构。
-- 不臆造缺失的品牌或城市，只把已有字段映射进去，后续由销售在统一档案内补齐。
UPDATE sales_leads
SET customer_brands = CASE
      WHEN customer_brands = '[]'::jsonb AND (COALESCE(pos_brand, '') <> '' OR COALESCE(city, '') <> '' OR COALESCE(store_count, 0) > 0)
        THEN jsonb_build_array(jsonb_build_object(
          'brand_name', COALESCE(NULLIF(pos_brand, ''), '待补充品牌'),
          'city', COALESCE(NULLIF(city, ''), '待补充城市'),
          'store_count', COALESCE(NULLIF(store_count, 0), 1)
        ))
      ELSE '[]'::jsonb
    END,
    customer_cities = CASE WHEN customer_cities = '[]'::jsonb AND COALESCE(city, '') <> '' THEN jsonb_build_array(city) ELSE customer_cities END,
    customer_contacts = CASE
      WHEN customer_contacts = '[]'::jsonb AND (COALESCE(name, '') <> '' OR COALESCE(phone, '') <> '')
        THEN jsonb_build_array(jsonb_build_object(
          'name', COALESCE(name, ''),
          'title', COALESCE(legal_contact_title, ''),
          'phone', COALESCE(phone, '')
        ))
      ELSE '[]'::jsonb
    END
WHERE customer_brands = '[]'::jsonb
   OR customer_cities = '[]'::jsonb
   OR customer_contacts = '[]'::jsonb;
