-- 131: 销售 CRM 治理收口：结构化失单复盘、内容资产版本/受众/生效期、合同版本与只读审计角色。

ALTER TABLE sales_loss_reasons
  ADD COLUMN IF NOT EXISTS competitor TEXT,
  ADD COLUMN IF NOT EXISTS budget_status TEXT,
  ADD COLUMN IF NOT EXISTS current_system TEXT,
  ADD COLUMN IF NOT EXISTS recontact_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS enter_nurture BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE sales_content_assets
  ADD COLUMN IF NOT EXISTS knowledge_domain TEXT NOT NULL DEFAULT 'customer_ai',
  ADD COLUMN IF NOT EXISTS customer_types JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS version_no INT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS effective_from TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

ALTER TABLE sales_content_deliveries
  ADD COLUMN IF NOT EXISTS view_status TEXT NOT NULL DEFAULT 'unavailable',
  ADD COLUMN IF NOT EXISTS viewed_at TIMESTAMPTZ;

ALTER TABLE sales_contracts
  ADD COLUMN IF NOT EXISTS version_no INT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS supersedes_contract_id BIGINT REFERENCES sales_contracts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_sales_content_assets_domain_effective
  ON sales_content_assets (knowledge_domain, active, effective_from, expires_at);
CREATE INDEX IF NOT EXISTS idx_sales_loss_reasons_recontact
  ON sales_loss_reasons (enter_nurture, recontact_at) WHERE enter_nurture = TRUE;
