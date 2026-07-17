-- 132: 客户身份与销售自主建档。
-- sales_leads 是内部表名，业务界面统一使用 customer_code 和 customer_origin，避免让客户/销售看到“线索 #N”。

ALTER TABLE sales_leads
  ADD COLUMN IF NOT EXISTS customer_code TEXT,
  ADD COLUMN IF NOT EXISTS customer_origin TEXT NOT NULL DEFAULT 'customer_ai',
  ADD COLUMN IF NOT EXISTS manual_created_by TEXT,
  ADD COLUMN IF NOT EXISTS manual_created_at TIMESTAMPTZ;

UPDATE sales_leads
   SET customer_code = 'KH' || LPAD(id::text, 8, '0')
 WHERE customer_code IS NULL OR BTRIM(customer_code) = '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_leads_customer_code_unique
  ON sales_leads (customer_code) WHERE customer_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sales_leads_customer_origin
  ON sales_leads (customer_origin, updated_at DESC);

COMMENT ON COLUMN sales_leads.customer_code IS '客户业务编号，展示给销售/客服；lead_key仅供内部追踪';
COMMENT ON COLUMN sales_leads.customer_origin IS '客户来源：customer_ai/sales_visit/referral/exhibition/phone_outreach/other';
