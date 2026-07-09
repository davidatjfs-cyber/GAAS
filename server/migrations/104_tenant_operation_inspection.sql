CREATE TABLE IF NOT EXISTS tenant_operation_inspection_runs (
  id BIGSERIAL PRIMARY KEY,
  tenant_id VARCHAR(80) NOT NULL DEFAULT 'default',
  store_id TEXT,
  inspection_date DATE NOT NULL DEFAULT CURRENT_DATE,
  health_score INTEGER NOT NULL DEFAULT 0,
  risk_level TEXT NOT NULL DEFAULT '严重',
  data_completeness INTEGER NOT NULL DEFAULT 0,
  data_freshness INTEGER NOT NULL DEFAULT 0,
  task_completion_rate INTEGER NOT NULL DEFAULT 0,
  ai_runnable_rate INTEGER NOT NULL DEFAULT 0,
  attribution_completeness INTEGER NOT NULL DEFAULT 0,
  summary TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tenant_operation_inspection_items (
  id BIGSERIAL PRIMARY KEY,
  run_id BIGINT REFERENCES tenant_operation_inspection_runs(id) ON DELETE CASCADE,
  tenant_id VARCHAR(80) NOT NULL DEFAULT 'default',
  store_id TEXT,
  category TEXT NOT NULL,
  item_key TEXT NOT NULL,
  item_name TEXT NOT NULL,
  status TEXT NOT NULL,
  severity TEXT NOT NULL,
  owner_role TEXT NOT NULL DEFAULT '系统',
  impact_modules JSONB NOT NULL DEFAULT '[]'::jsonb,
  impact_description TEXT,
  suggestion TEXT,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  can_generate_task BOOLEAN NOT NULL DEFAULT FALSE,
  generated_task_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tenant_operation_inspection_rules (
  id BIGSERIAL PRIMARY KEY,
  tenant_id VARCHAR(80) NOT NULL DEFAULT 'default',
  category TEXT NOT NULL,
  item_key TEXT NOT NULL,
  item_name TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'P3',
  owner_role TEXT NOT NULL DEFAULT '系统',
  impact_modules JSONB NOT NULL DEFAULT '[]'::jsonb,
  suggestion TEXT,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, item_key)
);

CREATE INDEX IF NOT EXISTS idx_toi_runs_tenant ON tenant_operation_inspection_runs (tenant_id);
CREATE INDEX IF NOT EXISTS idx_toi_runs_store ON tenant_operation_inspection_runs (store_id);
CREATE INDEX IF NOT EXISTS idx_toi_runs_date ON tenant_operation_inspection_runs (inspection_date DESC);
CREATE INDEX IF NOT EXISTS idx_toi_items_tenant ON tenant_operation_inspection_items (tenant_id);
CREATE INDEX IF NOT EXISTS idx_toi_items_store ON tenant_operation_inspection_items (store_id);
CREATE INDEX IF NOT EXISTS idx_toi_items_run ON tenant_operation_inspection_items (run_id);
CREATE INDEX IF NOT EXISTS idx_toi_items_severity ON tenant_operation_inspection_items (severity);
CREATE INDEX IF NOT EXISTS idx_toi_items_status ON tenant_operation_inspection_items (status);
CREATE INDEX IF NOT EXISTS idx_toi_items_key ON tenant_operation_inspection_items (tenant_id, item_key, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_toi_rules_tenant ON tenant_operation_inspection_rules (tenant_id);

ALTER TABLE tenant_operation_inspection_runs ADD COLUMN IF NOT EXISTS inspection_status TEXT NOT NULL DEFAULT 'completed';
ALTER TABLE tenant_operation_inspection_runs ADD COLUMN IF NOT EXISTS operation_stage TEXT NOT NULL DEFAULT 'active';
ALTER TABLE tenant_operation_inspection_runs ADD COLUMN IF NOT EXISTS customer_success_risk TEXT NOT NULL DEFAULT 'low';
ALTER TABLE tenant_operation_inspection_items ADD COLUMN IF NOT EXISTS responsible_party TEXT NOT NULL DEFAULT 'platform_team';
CREATE INDEX IF NOT EXISTS idx_toi_runs_status ON tenant_operation_inspection_runs (tenant_id, inspection_status, inspection_date DESC);
CREATE INDEX IF NOT EXISTS idx_toi_items_responsible ON tenant_operation_inspection_items (tenant_id, responsible_party);
CREATE INDEX IF NOT EXISTS idx_toi_items_generated_task ON tenant_operation_inspection_items (generated_task_id);

CREATE TABLE IF NOT EXISTS tenant_operation_inspection_reports (
  id BIGSERIAL PRIMARY KEY,
  tenant_id VARCHAR(80) NOT NULL DEFAULT 'default',
  run_id BIGINT REFERENCES tenant_operation_inspection_runs(id) ON DELETE SET NULL,
  report_title TEXT NOT NULL DEFAULT '租户运营整改报告',
  report_status TEXT NOT NULL DEFAULT 'draft',
  summary TEXT,
  affected_modules JSONB NOT NULL DEFAULT '[]'::jsonb,
  tenant_rectification_items JSONB NOT NULL DEFAULT '[]'::jsonb,
  platform_notes JSONB NOT NULL DEFAULT '[]'::jsonb,
  next_recheck_suggestion TEXT,
  pdf_file_url TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_toi_reports_tenant ON tenant_operation_inspection_reports (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_toi_reports_run ON tenant_operation_inspection_reports (run_id);
CREATE INDEX IF NOT EXISTS idx_toi_reports_status ON tenant_operation_inspection_reports (tenant_id, report_status);
ALTER TABLE tenant_operation_inspection_reports ADD COLUMN IF NOT EXISTS store_scope TEXT DEFAULT '全部门店';
