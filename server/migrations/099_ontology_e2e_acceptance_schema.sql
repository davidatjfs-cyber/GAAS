-- Ontology HTTP E2E acceptance support.
-- Idempotent schema repair for empty local databases. This mirrors the
-- runtime master-agent schema and adds columns that the existing marketing
-- attribution service already reads.

CREATE TABLE IF NOT EXISTS master_tasks (
  id SERIAL PRIMARY KEY,
  task_id TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending_audit',
  source TEXT DEFAULT 'scheduled_audit',
  source_ref TEXT,
  current_agent TEXT,
  category TEXT,
  severity TEXT DEFAULT 'medium',
  store TEXT,
  brand TEXT,
  assignee_username TEXT,
  assignee_role TEXT,
  title TEXT,
  detail TEXT,
  source_data JSONB DEFAULT '{}'::jsonb,
  audit_result JSONB DEFAULT '{}'::jsonb,
  dispatch_data JSONB DEFAULT '{}'::jsonb,
  response_text TEXT,
  response_images JSONB DEFAULT '[]'::jsonb,
  review_result JSONB DEFAULT '{}'::jsonb,
  settlement_data JSONB DEFAULT '{}'::jsonb,
  score_impact NUMERIC(5,1) DEFAULT 0,
  feishu_msg_ids JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  dispatched_at TIMESTAMPTZ,
  responded_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  settled_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  tenant_id VARCHAR(80) NOT NULL DEFAULT 'default'
);

CREATE TABLE IF NOT EXISTS master_events (
  id SERIAL PRIMARY KEY,
  task_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  from_agent TEXT,
  to_agent TEXT,
  status_before TEXT,
  status_after TEXT,
  payload JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  tenant_id VARCHAR(80) NOT NULL DEFAULT 'default'
);

ALTER TABLE master_tasks ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
ALTER TABLE master_events ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE UNIQUE INDEX IF NOT EXISTS idx_master_tasks_task_tenant ON master_tasks (task_id, tenant_id);
CREATE INDEX IF NOT EXISTS idx_master_tasks_status ON master_tasks (status);
CREATE INDEX IF NOT EXISTS idx_master_tasks_store ON master_tasks (store, status);
CREATE INDEX IF NOT EXISTS idx_master_tasks_assignee ON master_tasks (assignee_username, status);
CREATE INDEX IF NOT EXISTS idx_master_tasks_task_id ON master_tasks (task_id);
CREATE INDEX IF NOT EXISTS idx_master_tasks_tenant ON master_tasks (tenant_id);
CREATE INDEX IF NOT EXISTS idx_master_events_task ON master_events (task_id, created_at);

ALTER TABLE growth_delivery_logs ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
ALTER TABLE growth_delivery_logs ADD COLUMN IF NOT EXISTS campaign_id TEXT;
ALTER TABLE growth_delivery_logs ADD COLUMN IF NOT EXISTS coupon_id TEXT;
ALTER TABLE growth_delivery_logs ADD COLUMN IF NOT EXISTS phone TEXT;
CREATE INDEX IF NOT EXISTS idx_growth_delivery_logs_campaign ON growth_delivery_logs (tenant_id, campaign_id, status, created_at DESC);

ALTER TABLE pos_orders ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
ALTER TABLE pos_orders ADD COLUMN IF NOT EXISTS coupon_id TEXT;
CREATE INDEX IF NOT EXISTS idx_pos_orders_coupon ON pos_orders (tenant_id, coupon_id) WHERE coupon_id IS NOT NULL AND coupon_id <> '';
