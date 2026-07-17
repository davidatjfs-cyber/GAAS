-- 129: 销售 CRM 商业运行收口：双方法务签章、开票、交付阶段时间戳、素材培育节点与风控告警。

ALTER TABLE sales_contracts
  ADD COLUMN IF NOT EXISTS customer_signed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS customer_signed_file_url TEXT,
  ADD COLUMN IF NOT EXISTS our_signed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS our_signed_file_url TEXT;

CREATE TABLE IF NOT EXISTS sales_invoices (
  id BIGSERIAL PRIMARY KEY,
  contract_id BIGINT NOT NULL REFERENCES sales_contracts(id) ON DELETE CASCADE,
  invoice_no TEXT,
  amount_fen BIGINT NOT NULL CHECK (amount_fen > 0),
  status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','issued','cancelled')),
  file_url TEXT,
  requested_by TEXT NOT NULL,
  issued_by TEXT,
  issued_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sales_invoices_contract ON sales_invoices (contract_id, created_at DESC);

ALTER TABLE sales_delivery_projects
  ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS data_imported_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS diagnosis_completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS configured_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS acceptance_completed_at TIMESTAMPTZ;

ALTER TABLE sales_content_assets
  ADD COLUMN IF NOT EXISTS nurture_step INT;

ALTER TABLE sales_reps
  ADD COLUMN IF NOT EXISTS wecom_name TEXT,
  ADD COLUMN IF NOT EXISTS wecom_qr_asset_id BIGINT REFERENCES sales_content_assets(id) ON DELETE SET NULL;

UPDATE sales_leads SET handoff_mode='consultant_qr' WHERE handoff_mode='same_session';

CREATE TABLE IF NOT EXISTS sales_credit_alerts (
  id BIGSERIAL PRIMARY KEY,
  lead_id BIGINT NOT NULL REFERENCES sales_leads(id) ON DELETE CASCADE,
  outstanding_fen BIGINT NOT NULL,
  credit_limit_fen BIGINT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  alerted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_credit_alerts_one_open ON sales_credit_alerts (lead_id) WHERE status='open';
