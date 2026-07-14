ALTER TABLE sales_leads
  ADD COLUMN IF NOT EXISTS assigned_to TEXT,
  ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS handoff_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS first_human_response_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sla_due_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sla_status TEXT NOT NULL DEFAULT 'not_required',
  ADD COLUMN IF NOT EXISTS escalated_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS sales_action_logs (
  id BIGSERIAL PRIMARY KEY,
  lead_id BIGINT NOT NULL REFERENCES sales_leads(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL,
  asset_key TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'created',
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sales_action_logs_lead ON sales_action_logs (lead_id, created_at DESC);

CREATE TABLE IF NOT EXISTS sales_consultants (
  id BIGSERIAL PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  wecom_userid TEXT,
  wecom_qr_url TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  routing_weight INT NOT NULL DEFAULT 100,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sales_consultant_invites (
  id BIGSERIAL PRIMARY KEY,
  lead_id BIGINT NOT NULL REFERENCES sales_leads(id) ON DELETE CASCADE,
  consultant_id BIGINT REFERENCES sales_consultants(id) ON DELETE SET NULL,
  external_userid TEXT,
  invite_type TEXT NOT NULL DEFAULT 'consultant_qr',
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'sent',
  clicked_at TIMESTAMPTZ,
  added_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sales_invites_lead ON sales_consultant_invites (lead_id, created_at DESC);
