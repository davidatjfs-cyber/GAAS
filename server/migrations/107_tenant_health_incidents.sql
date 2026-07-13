-- Phase 2：健康中心异常分流队列（客服/客户/第三方/研发）
-- 生产也可由 tenant-health-incident-service.ensureHealthIncidentTables 幂等创建

CREATE TABLE IF NOT EXISTS tenant_health_incidents (
  id BIGSERIAL PRIMARY KEY,
  tenant_id VARCHAR(80) NOT NULL,
  inspection_item_id BIGINT,
  run_id BIGINT,
  item_key TEXT NOT NULL,
  item_name TEXT,
  severity TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  queue TEXT NOT NULL,
  owner_role TEXT,
  responsible_party TEXT,
  impact_modules JSONB NOT NULL DEFAULT '[]'::jsonb,
  suggestion TEXT,
  faq_id TEXT,
  fingerprint TEXT NOT NULL,
  heal_action TEXT,
  heal_result JSONB,
  acked_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  escalated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_thi_queue_status ON tenant_health_incidents (queue, status, severity);
CREATE INDEX IF NOT EXISTS idx_thi_tenant ON tenant_health_incidents (tenant_id, status, updated_at DESC);
