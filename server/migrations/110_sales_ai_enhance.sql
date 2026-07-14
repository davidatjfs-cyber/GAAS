-- 110: 销售 AI 增强：客户档案补全 + 销售漏斗 + 风险预警字段
-- 补全 leads 字段，新增 opportunities / demos / trials / deals / loss_reasons / meetings / objections

ALTER TABLE sales_leads
  ADD COLUMN IF NOT EXISTS name TEXT,
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS budget_range TEXT,
  ADD COLUMN IF NOT EXISTS expected_close_date DATE,
  ADD COLUMN IF NOT EXISTS win_probability INT,
  ADD COLUMN IF NOT EXISTS last_reminder_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_risk_check_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS first_contact_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS first_response_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS demo_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS meeting_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS trial_status TEXT,
  ADD COLUMN IF NOT EXISTS lost_reason TEXT,
  ADD COLUMN IF NOT EXISTS competitor TEXT,
  ADD COLUMN IF NOT EXISTS notes TEXT;

CREATE INDEX IF NOT EXISTS idx_sales_leads_owner ON sales_leads (owner_username, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_sales_leads_reminder ON sales_leads (last_reminder_at NULLS LAST);

-- 销售机会：一个线索可产生多个机会/报价
CREATE TABLE IF NOT EXISTS sales_opportunities (
  id BIGSERIAL PRIMARY KEY,
  lead_id BIGINT NOT NULL REFERENCES sales_leads(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  stage TEXT NOT NULL DEFAULT 'proposal',
  amount INT,
  expected_close_date DATE,
  probability INT,
  priority TEXT DEFAULT 'normal',
  status TEXT NOT NULL DEFAULT 'open',
  owner_username TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sales_opps_lead ON sales_opportunities (lead_id, stage);
CREATE INDEX IF NOT EXISTS idx_sales_opps_stage ON sales_opportunities (stage, updated_at DESC);

-- 产品演示/Demo 记录
CREATE TABLE IF NOT EXISTS sales_demos (
  id BIGSERIAL PRIMARY KEY,
  lead_id BIGINT NOT NULL REFERENCES sales_leads(id) ON DELETE CASCADE,
  scheduled_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  attended_by TEXT,
  summary TEXT,
  key_points TEXT,
  objections JSONB NOT NULL DEFAULT '[]'::jsonb,
  next_steps TEXT,
  status TEXT NOT NULL DEFAULT 'scheduled',
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sales_demos_lead ON sales_demos (lead_id, scheduled_at DESC);

-- 会议记录（电话/线下/会议）
CREATE TABLE IF NOT EXISTS sales_meetings (
  id BIGSERIAL PRIMARY KEY,
  lead_id BIGINT NOT NULL REFERENCES sales_leads(id) ON DELETE CASCADE,
  meeting_type TEXT NOT NULL,
  occurred_at TIMESTAMPTZ,
  raw_notes TEXT,
  summary TEXT,
  customer_needs JSONB NOT NULL DEFAULT '[]'::jsonb,
  customer_objections JSONB NOT NULL DEFAULT '[]'::jsonb,
  customer_commitments JSONB NOT NULL DEFAULT '[]'::jsonb,
  our_commitments JSONB NOT NULL DEFAULT '[]'::jsonb,
  decision_maker TEXT,
  budget TEXT,
  timeline TEXT,
  risks TEXT,
  next_steps TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sales_meetings_lead ON sales_meetings (lead_id, occurred_at DESC);

-- 30天试跑项目
CREATE TABLE IF NOT EXISTS sales_trials (
  id BIGSERIAL PRIMARY KEY,
  lead_id BIGINT NOT NULL REFERENCES sales_leads(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  stores TEXT,
  pos_brand TEXT,
  target_kpis JSONB NOT NULL DEFAULT '{}'::jsonb,
  result_summary TEXT,
  status TEXT NOT NULL DEFAULT 'planned',
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sales_trials_lead ON sales_trials (lead_id, started_at DESC);

-- 成交记录
CREATE TABLE IF NOT EXISTS sales_deals (
  id BIGSERIAL PRIMARY KEY,
  lead_id BIGINT NOT NULL REFERENCES sales_leads(id) ON DELETE CASCADE,
  opportunity_id BIGINT REFERENCES sales_opportunities(id) ON DELETE SET NULL,
  deal_date DATE,
  amount INT,
  store_count INT,
  contract_term TEXT,
  notes TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sales_deals_lead ON sales_deals (lead_id, deal_date DESC);

-- 失单原因库
CREATE TABLE IF NOT EXISTS sales_loss_reasons (
  id BIGSERIAL PRIMARY KEY,
  lead_id BIGINT NOT NULL REFERENCES sales_leads(id) ON DELETE CASCADE,
  reason_key TEXT NOT NULL,
  reason_label TEXT,
  detail TEXT,
  evidence TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sales_loss_reasons_lead ON sales_loss_reasons (lead_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sales_loss_reasons_key ON sales_loss_reasons (reason_key, created_at DESC);

-- 客户异议库（沉淀）
CREATE TABLE IF NOT EXISTS sales_objections (
  id BIGSERIAL PRIMARY KEY,
  lead_id BIGINT NOT NULL REFERENCES sales_leads(id) ON DELETE CASCADE,
  objection_key TEXT NOT NULL,
  objection_label TEXT,
  evidence TEXT,
  response_text TEXT,
  resolved BOOLEAN DEFAULT false,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sales_objections_lead ON sales_objections (lead_id, resolved, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sales_objections_key ON sales_objections (objection_key, created_at DESC);
