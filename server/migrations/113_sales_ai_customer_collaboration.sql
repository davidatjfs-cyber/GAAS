-- 113: 客户AI与销售AI协作协议：指导、阶段历史、接管等级和最后决策
ALTER TABLE sales_leads
  ADD COLUMN IF NOT EXISTS handoff_level TEXT NOT NULL DEFAULT 'low',
  ADD COLUMN IF NOT EXISTS last_sales_decision JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS sales_ai_guidance (
  id BIGSERIAL PRIMARY KEY,
  lead_id BIGINT NOT NULL REFERENCES sales_leads(id) ON DELETE CASCADE,
  conversation_id BIGINT REFERENCES sales_conversations(id) ON DELETE CASCADE,
  guidance JSONB NOT NULL DEFAULT '{}'::jsonb,
  source TEXT NOT NULL DEFAULT 'sales_ai',
  status TEXT NOT NULL DEFAULT 'active',
  expires_at TIMESTAMPTZ,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sales_guidance_active ON sales_ai_guidance (lead_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS sales_stage_history (
  id BIGSERIAL PRIMARY KEY,
  lead_id BIGINT NOT NULL REFERENCES sales_leads(id) ON DELETE CASCADE,
  from_stage TEXT,
  to_stage TEXT NOT NULL,
  reason TEXT,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  actor TEXT NOT NULL DEFAULT 'sales_ai',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sales_stage_history_lead ON sales_stage_history (lead_id, created_at DESC);
