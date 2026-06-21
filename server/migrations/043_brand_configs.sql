-- 品牌配置数据库化基础设施：store_brands(门店→品牌权威映射) + brand_configs(品牌专属配置JSONB)
-- 目的：把散落在agents.js/performance-jobs.js等17个文件里的"if(brand==='洪潮')"硬编码分支
-- 收编成数据驱动配置，新品牌只需插入一行配置即可，不用改代码+部署。
-- 当前仅2个门店、2个品牌，本迁移先建表+种子最基础数据；各业务模块改造时会通过后续UPDATE
-- 往config_json里追加各自的配置子键(累积式，不破坏其他模块已写入的键)。

CREATE TABLE IF NOT EXISTS store_brands (
  store_id    VARCHAR(64) PRIMARY KEY,
  store_name  TEXT NOT NULL,
  brand_key   VARCHAR(80) NOT NULL,
  brand_name  TEXT NOT NULL,
  sms_suffix  VARCHAR(40) NOT NULL DEFAULT 'DEFAULT',
  tenant_id   VARCHAR(80) NOT NULL DEFAULT 'default',
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_store_brands_brand_key ON store_brands(brand_key);
CREATE INDEX IF NOT EXISTS idx_store_brands_tenant ON store_brands(tenant_id);

CREATE TABLE IF NOT EXISTS brand_configs (
  brand_key   VARCHAR(80) PRIMARY KEY,
  brand_name  TEXT NOT NULL,
  config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  tenant_id   VARCHAR(80) NOT NULL DEFAULT 'default',
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_brand_configs_tenant ON brand_configs(tenant_id);

-- 种子：与 brands-config.js 现有 STORES 数组完全一致(原文件注释自称"single source of truth")
INSERT INTO store_brands (store_id, store_name, brand_key, brand_name, sms_suffix) VALUES
  ('51866138', '马己仙上海音乐广场店', 'majixian', '马己仙', 'MAJIXIAN'),
  ('64822111', '洪潮大宁久光店',       'hongchao', '洪潮',   'HONGCHAO')
ON CONFLICT (store_id) DO NOTHING;

INSERT INTO brand_configs (brand_key, brand_name, config_json) VALUES
  ('hongchao', '洪潮', '{}'::jsonb),
  ('majixian', '马己仙', '{}'::jsonb)
ON CONFLICT (brand_key) DO NOTHING;
