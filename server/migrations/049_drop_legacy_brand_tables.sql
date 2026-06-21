-- store_brands/brand_configs 的数据已在迁移048里完整搬进 tenant_config，
-- brand-config-loader.js 也已改读 tenant_config 并验证过行为一致。
-- 全代码库确认无其它地方引用这两张表，安全删除。

DROP TABLE IF EXISTS store_brands;
DROP TABLE IF EXISTS brand_configs;
