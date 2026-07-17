-- 133: 合同审批、品牌共享授信、订单、财务销账与逐订单开通闭环。

ALTER TABLE sales_contracts
  ADD COLUMN IF NOT EXISTS approval_status TEXT NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS submitted_by TEXT,
  ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approval_note TEXT,
  ADD COLUMN IF NOT EXISTS payment_type TEXT,
  ADD COLUMN IF NOT EXISTS brand_name TEXT;

CREATE TABLE IF NOT EXISTS sales_credit_pools (
  id BIGSERIAL PRIMARY KEY,
  brand_key TEXT NOT NULL UNIQUE,
  brand_name TEXT NOT NULL,
  payment_type TEXT NOT NULL CHECK (payment_type IN ('cash','credit')),
  credit_limit_fen BIGINT NOT NULL DEFAULT 0 CHECK (credit_limit_fen >= 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','locked')),
  approved_by TEXT NOT NULL,
  approved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  lock_reason TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sales_credit_pool_members (
  lead_id BIGINT PRIMARY KEY REFERENCES sales_leads(id) ON DELETE CASCADE,
  credit_pool_id BIGINT NOT NULL REFERENCES sales_credit_pools(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sales_orders (
  id BIGSERIAL PRIMARY KEY,
  order_no TEXT NOT NULL UNIQUE,
  lead_id BIGINT NOT NULL REFERENCES sales_leads(id) ON DELETE CASCADE,
  contract_id BIGINT NOT NULL REFERENCES sales_contracts(id) ON DELETE RESTRICT,
  credit_pool_id BIGINT NOT NULL REFERENCES sales_credit_pools(id) ON DELETE RESTRICT,
  order_type TEXT NOT NULL CHECK (order_type IN ('new_store','renewal')),
  status TEXT NOT NULL DEFAULT 'finance_pending' CHECK (status IN ('finance_pending','paid','credit_approved','returned','provisioning','provisioned')),
  amount_fen BIGINT NOT NULL CHECK (amount_fen > 0),
  store_name TEXT NOT NULL,
  store_address TEXT,
  contact_name TEXT,
  contact_phone TEXT,
  area_sqm NUMERIC(12,2),
  restaurant_type TEXT,
  submitted_by TEXT NOT NULL,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finance_by TEXT,
  finance_at TIMESTAMPTZ,
  return_reason TEXT,
  tenant_id TEXT,
  provision_status TEXT,
  provision_meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sales_orders_pool_status ON sales_orders (credit_pool_id,status,submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_sales_orders_finance ON sales_orders (status,submitted_at ASC);

CREATE TABLE IF NOT EXISTS sales_order_payments (
  id BIGSERIAL PRIMARY KEY,
  order_id BIGINT NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
  amount_fen BIGINT NOT NULL CHECK (amount_fen > 0),
  receipt_url TEXT,
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed','rejected')),
  received_by TEXT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sales_order_delivery_projects (
  id BIGSERIAL PRIMARY KEY,
  order_id BIGINT NOT NULL UNIQUE REFERENCES sales_orders(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  cs_owner TEXT,
  implementation_owner TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
