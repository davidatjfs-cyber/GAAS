-- 把 store_brands/brand_configs 的内容迁移进已有的通用 tenant_config 表，
-- 不再用专门的品牌表——直接从现有表里聚合生成，避免手工转录出错。
-- 迁移后 brand-config-loader.js 改读 tenant_config，store_brands/brand_configs
-- 两张表确认无其它引用后在后续迁移里 DROP。

INSERT INTO tenant_config (tenant_key, config_key, config_value)
SELECT 'default', 'store_brands', jsonb_agg(jsonb_build_object(
  'store_id', store_id,
  'store_name', store_name,
  'brand_key', brand_key,
  'brand_name', brand_name,
  'sms_suffix', sms_suffix,
  'has_takeaway', has_takeaway,
  'punch_start_minutes', punch_start_minutes,
  'punch_end_minutes', punch_end_minutes
))
FROM store_brands
ON CONFLICT (tenant_key, config_key) DO UPDATE SET config_value = EXCLUDED.config_value, updated_at = now();

INSERT INTO tenant_config (tenant_key, config_key, config_value)
SELECT 'default', 'brand_config_' || brand_key, config_json || jsonb_build_object('brandName', brand_name)
FROM brand_configs
ON CONFLICT (tenant_key, config_key) DO UPDATE SET config_value = EXCLUDED.config_value, updated_at = now();
