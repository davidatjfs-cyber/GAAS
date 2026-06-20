-- 多租户业务参数配置表。新增品牌的天气系数/营业时段/运营截止时间等参数，
-- 通过插入数据行配置，不再需要改代码、重新部署。
-- config_key 约定：'forecast'(天气系数) / 'slot'(营业时段) / 'ops_deadline'(运营截止时间) 等。
-- tenant_key='_default' 表示未匹配到具体租户时的默认值。

CREATE TABLE IF NOT EXISTS tenant_config (
  id            SERIAL PRIMARY KEY,
  tenant_key    VARCHAR(80) NOT NULL,
  config_key    VARCHAR(80) NOT NULL,
  config_value  JSONB NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (tenant_key, config_key)
);

CREATE INDEX IF NOT EXISTS idx_tenant_config_tenant ON tenant_config(tenant_key);
