-- 127: 年年有喜销售 CRM 的合同、回款、交付与客户 AI 内容发送闭环。
-- 所有资金与开通动作均以该迁移的数据为唯一审计依据，不能再只靠 sales_deals.won。

CREATE TABLE IF NOT EXISTS sales_contracts (
  id BIGSERIAL PRIMARY KEY,
  lead_id BIGINT NOT NULL REFERENCES sales_leads(id) ON DELETE CASCADE,
  contract_no TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'draft', -- draft/customer_signed/our_signed/effective/cancelled
  amount_fen BIGINT NOT NULL DEFAULT 0,
  signed_at TIMESTAMPTZ,
  effective_at TIMESTAMPTZ,
  file_url TEXT,
  file_name TEXT,
  created_by TEXT NOT NULL,
  approved_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sales_contracts_lead ON sales_contracts (lead_id, created_at DESC);

CREATE TABLE IF NOT EXISTS sales_payments (
  id BIGSERIAL PRIMARY KEY,
  contract_id BIGINT NOT NULL REFERENCES sales_contracts(id) ON DELETE CASCADE,
  amount_fen BIGINT NOT NULL CHECK (amount_fen > 0),
  paid_at TIMESTAMPTZ,
  receipt_url TEXT,
  status TEXT NOT NULL DEFAULT 'pending', -- pending/confirmed/rejected
  submitted_by TEXT NOT NULL,
  confirmed_by TEXT,
  confirmed_at TIMESTAMPTZ,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sales_payments_contract ON sales_payments (contract_id, status);

CREATE TABLE IF NOT EXISTS sales_delivery_projects (
  id BIGSERIAL PRIMARY KEY,
  lead_id BIGINT NOT NULL UNIQUE REFERENCES sales_leads(id) ON DELETE CASCADE,
  tenant_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending', -- pending/assigned/data_import/diagnosis/configuration/acceptance/delivered
  implementation_owner TEXT,
  cs_owner TEXT,
  account_sent_at TIMESTAMPTZ,
  accepted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sales_content_assets (
  id BIGSERIAL PRIMARY KEY,
  asset_key TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  content_type TEXT NOT NULL CHECK (content_type IN ('text','image','file','video','link','qr')),
  text_content TEXT,
  media_url TEXT,
  file_name TEXT,
  external_approved BOOLEAN NOT NULL DEFAULT FALSE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  auto_send_allowed BOOLEAN NOT NULL DEFAULT FALSE,
  tags JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by TEXT NOT NULL,
  approved_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sales_content_deliveries (
  id BIGSERIAL PRIMARY KEY,
  lead_id BIGINT NOT NULL REFERENCES sales_leads(id) ON DELETE CASCADE,
  asset_id BIGINT REFERENCES sales_content_assets(id) ON DELETE SET NULL,
  delivery_type TEXT NOT NULL, -- manual/ai_nurture/handoff
  status TEXT NOT NULL DEFAULT 'pending', -- pending/sent/failed/skipped
  wecom_msg_id TEXT,
  error_message TEXT,
  sent_by TEXT NOT NULL,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sales_content_deliveries_lead ON sales_content_deliveries (lead_id, created_at DESC);

ALTER TABLE sales_leads
  ADD COLUMN IF NOT EXISTS auto_nurture_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS auto_nurture_paused_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS handoff_mode TEXT NOT NULL DEFAULT 'consultant_qr'; -- same_session/consultant_qr
