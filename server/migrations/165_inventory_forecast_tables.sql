-- Tier 2: inventoryForecast* 独立表（history / predictions / evaluations）
-- 运行 migrate 后需配合代码写表 + hydrate；strip blob 见 166。
-- 仅写脚本，不在 CI/生产自动执行。

CREATE TABLE IF NOT EXISTS inventory_forecast_history (
  id UUID PRIMARY KEY,
  tenant_id VARCHAR(80) NOT NULL DEFAULT 'default',
  store VARCHAR(200) NOT NULL,
  biz_type VARCHAR(40) NOT NULL DEFAULT '',
  slot VARCHAR(40) NOT NULL DEFAULT '',
  forecast_date DATE NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (tenant_id, store, biz_type, slot, forecast_date)
);

CREATE INDEX IF NOT EXISTS idx_inv_fc_history_tenant_store
  ON inventory_forecast_history (tenant_id, store, forecast_date DESC);

CREATE TABLE IF NOT EXISTS inventory_forecast_predictions (
  id UUID PRIMARY KEY,
  tenant_id VARCHAR(80) NOT NULL DEFAULT 'default',
  store VARCHAR(200) NOT NULL,
  biz_type VARCHAR(40) NOT NULL DEFAULT '',
  slot VARCHAR(40) NOT NULL DEFAULT '',
  forecast_date DATE NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (tenant_id, store, biz_type, slot, forecast_date)
);

CREATE INDEX IF NOT EXISTS idx_inv_fc_predictions_tenant_store
  ON inventory_forecast_predictions (tenant_id, store, forecast_date DESC);

CREATE TABLE IF NOT EXISTS inventory_forecast_evaluations (
  id UUID PRIMARY KEY,
  tenant_id VARCHAR(80) NOT NULL DEFAULT 'default',
  store VARCHAR(200) NOT NULL,
  biz_type VARCHAR(40) NOT NULL DEFAULT '',
  slot VARCHAR(40) NOT NULL DEFAULT '',
  forecast_date DATE NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (tenant_id, store, biz_type, slot, forecast_date)
);

CREATE INDEX IF NOT EXISTS idx_inv_fc_evaluations_tenant_store
  ON inventory_forecast_evaluations (tenant_id, store, forecast_date DESC);

COMMENT ON TABLE inventory_forecast_history IS '备货预测历史（自 hrms_state.inventoryForecastHistory 外提）';
COMMENT ON TABLE inventory_forecast_predictions IS '备货预测结果';
COMMENT ON TABLE inventory_forecast_evaluations IS '备货预测评估';
