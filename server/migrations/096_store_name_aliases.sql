-- 门店名归一化收口：此前分散在两个仓库4处的硬编码映射
-- (knowledge-graph.js#STORE_NAME_ALIASES、agents-service-v2/store-mapping.js的
-- STORE_TO_FEISHU/GROWTH_STORE_ID_TO_NAME)，新租户上线要在多处手动加映射，容易漏，
-- 且出错不报错只是数据默默算错。这里建一张租户可配置的表作为唯一权威来源，
-- 参照dish_name_aliases的设计(2026-07-04)。
-- pos_sales_detail视图里的CASE WHEN暂不收口进来，改动风险单独评估。

CREATE TABLE IF NOT EXISTS store_name_aliases (
  id BIGSERIAL PRIMARY KEY,
  tenant_id VARCHAR(80) NOT NULL DEFAULT 'default',
  canonical_name VARCHAR(200) NOT NULL,
  alias_name VARCHAR(200) NOT NULL,
  source VARCHAR(40) DEFAULT 'manual',
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_store_name_aliases_scope UNIQUE (tenant_id, alias_name)
);
CREATE INDEX IF NOT EXISTS idx_store_name_aliases_lookup ON store_name_aliases (tenant_id, alias_name) WHERE enabled = TRUE;
CREATE INDEX IF NOT EXISTS idx_store_name_aliases_canonical ON store_name_aliases (tenant_id, canonical_name) WHERE enabled = TRUE;

ALTER TABLE store_name_aliases ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON store_name_aliases;
CREATE POLICY tenant_isolation ON store_name_aliases
  USING (tenant_id = COALESCE(NULLIF(current_setting('app.tenant_id', true), ''), 'default'))
  WITH CHECK (tenant_id = COALESCE(NULLIF(current_setting('app.tenant_id', true), ''), 'default'));

-- 种子数据：把现有4处硬编码里的映射原样迁移进来，保证马己仙/洪潮的行为不回归。
-- source标注来源，供agents-service-v2#toFeishuStoreName这类"需要某个特定来源别名"
-- 的场景精确查询(如飞书Bitable用的简称)，而不是随便返回一个别名。
INSERT INTO store_name_aliases (tenant_id, canonical_name, alias_name, source) VALUES
  ('default', '洪潮大宁久光店', '洪潮大宁久光店', 'canonical'),
  ('default', '洪潮大宁久光店', '洪潮久光店', 'feishu'),
  ('default', '洪潮大宁久光店', '洪潮', 'brand'),
  ('default', '洪潮大宁久光店', '64822111', 'growth_id'),
  ('default', '洪潮大宁久光店', '大宁久光', 'fuzzy'),
  ('default', '马己仙上海音乐广场店', '马己仙上海音乐广场店', 'canonical'),
  ('default', '马己仙上海音乐广场店', '马己仙大宁店', 'feishu'),
  ('default', '马己仙上海音乐广场店', '马己仙', 'brand'),
  ('default', '马己仙上海音乐广场店', '51866138', 'growth_id'),
  ('default', '马己仙上海音乐广场店', '音乐广场', 'fuzzy')
ON CONFLICT (tenant_id, alias_name) DO NOTHING;
