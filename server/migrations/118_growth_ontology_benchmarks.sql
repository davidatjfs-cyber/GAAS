-- 118: 多租户数据管道 第一步——多维业态分类 + 完整统计分布基准库。
-- 设计目标：不是给今天几十家店用的MVP，是给未来几千几万家店用的行业标准分类体系。
-- AI诊断不再跟"全租户平均值"比，只在 business_type + scale + price_band 同分组内比较，
-- 且存的是完整分布(p10/p25/p50/p75/p90/mean/std)，不是单一均值。

ALTER TABLE growth_ontology_stores
  ADD COLUMN IF NOT EXISTS business_type TEXT,
  ADD COLUMN IF NOT EXISTS business_traits JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS cuisine TEXT,
  ADD COLUMN IF NOT EXISTS scale TEXT,
  ADD COLUMN IF NOT EXISTS price_band TEXT,
  ADD COLUMN IF NOT EXISTS lifecycle TEXT DEFAULT 'stable';

COMMENT ON COLUMN growth_ontology_stores.business_type IS '一级经营模型(见 server/ontology/store-segments.js BUSINESS_TYPES)，决定用哪套KPI权重和基准分组';
COMMENT ON COLUMN growth_ontology_stores.business_traits IS '经营特征标签数组(多选)，如["private_room","family"]，用于基准库的进一步过滤';
COMMENT ON COLUMN growth_ontology_stores.scale IS '规模档位 XS/S/M/L/XL/XXL';
COMMENT ON COLUMN growth_ontology_stores.price_band IS '价格带 budget/value/premium/luxury/ultra，按客单价分';
COMMENT ON COLUMN growth_ontology_stores.lifecycle IS '门店生命周期 new/growing/stable/mature/declining/recovery';

CREATE TABLE IF NOT EXISTS growth_ontology_benchmarks (
  id BIGSERIAL PRIMARY KEY,
  business_type TEXT NOT NULL,
  scale TEXT NOT NULL DEFAULT 'all',
  price_band TEXT NOT NULL DEFAULT 'all',
  region TEXT NOT NULL DEFAULT 'all',
  metric_name TEXT NOT NULL,
  sample_size INT NOT NULL DEFAULT 0,
  p10 NUMERIC,
  p25 NUMERIC,
  p50 NUMERIC,
  p75 NUMERIC,
  p90 NUMERIC,
  mean NUMERIC,
  std NUMERIC,
  confidence_score NUMERIC, -- 0-1，样本量越大越接近1；样本不足时应配合行业参考值兜底展示
  source TEXT NOT NULL DEFAULT 'platform', -- platform=真实数据算出 / industry_reference=行业公开参考值兜底
  last_updated TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (business_type, scale, price_band, region, metric_name, source)
);
CREATE INDEX IF NOT EXISTS idx_growth_ontology_benchmarks_lookup ON growth_ontology_benchmarks (business_type, scale, price_band, region, metric_name);

CREATE TABLE IF NOT EXISTS growth_ontology_kpi_weights (
  business_type TEXT PRIMARY KEY,
  weights JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE growth_ontology_kpi_weights IS '每个business_type对各KPI的关注权重(0-10)，诊断时用于计算加权"经营健康度"而不是对所有门店一视同仁；默认值见 server/ontology/store-segments.js KPI_WEIGHTS，此表允许运营人员按实际效果调整覆盖默认值';
