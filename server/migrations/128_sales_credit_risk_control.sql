-- 128: 客户风控。现金客户必须足额回款；帐期客户按总经理授信额度受控开通与扩店。

CREATE TABLE IF NOT EXISTS sales_credit_accounts (
  id BIGSERIAL PRIMARY KEY,
  lead_id BIGINT NOT NULL UNIQUE REFERENCES sales_leads(id) ON DELETE CASCADE,
  payment_type TEXT NOT NULL DEFAULT 'cash' CHECK (payment_type IN ('cash','credit')),
  credit_limit_fen BIGINT NOT NULL DEFAULT 0 CHECK (credit_limit_fen >= 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','locked')),
  approved_by TEXT,
  approved_at TIMESTAMPTZ,
  lock_reason TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sales_credit_accounts_status ON sales_credit_accounts (status, payment_type);
