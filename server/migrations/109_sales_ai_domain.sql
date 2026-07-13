-- 109: 销售 AI 域（客户AI助手 + 销售AI助手）
-- 与 growth_customers（会员域）隔离；服务平台自身获客/成交。

CREATE TABLE IF NOT EXISTS sales_leads (
  id BIGSERIAL PRIMARY KEY,
  lead_key TEXT NOT NULL UNIQUE,
  external_userid TEXT,
  open_kfid TEXT,
  name TEXT,
  company TEXT,
  city TEXT,
  cuisine TEXT,
  store_count INT,
  pos_brand TEXT,
  phone_data_ready BOOLEAN,
  member_estimate INT,
  pain_points JSONB NOT NULL DEFAULT '[]'::jsonb,
  decision_role TEXT,
  source_channel TEXT DEFAULT 'wecom_kf',
  stage TEXT NOT NULL DEFAULT 'new',
  controller TEXT NOT NULL DEFAULT 'ai',
  intent_score INT NOT NULL DEFAULT 0,
  intent_level TEXT NOT NULL DEFAULT 'low',
  owner_username TEXT,
  tags JSONB NOT NULL DEFAULT '[]'::jsonb,
  extracted JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_message_at TIMESTAMPTZ,
  last_human_at TIMESTAMPTZ,
  next_action TEXT,
  next_action_due TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sales_leads_stage ON sales_leads (stage, intent_score DESC);
CREATE INDEX IF NOT EXISTS idx_sales_leads_score ON sales_leads (intent_score DESC, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_sales_leads_external ON sales_leads (external_userid);

CREATE TABLE IF NOT EXISTS sales_conversations (
  id BIGSERIAL PRIMARY KEY,
  lead_id BIGINT REFERENCES sales_leads(id) ON DELETE CASCADE,
  open_kfid TEXT,
  external_userid TEXT,
  controller TEXT NOT NULL DEFAULT 'ai',
  status TEXT NOT NULL DEFAULT 'open',
  cursor TEXT,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sales_conv_lead ON sales_conversations (lead_id, updated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_conv_ext_kf
  ON sales_conversations (open_kfid, external_userid)
  WHERE open_kfid IS NOT NULL AND external_userid IS NOT NULL;

CREATE TABLE IF NOT EXISTS sales_messages (
  id BIGSERIAL PRIMARY KEY,
  conversation_id BIGINT NOT NULL REFERENCES sales_conversations(id) ON DELETE CASCADE,
  lead_id BIGINT REFERENCES sales_leads(id) ON DELETE SET NULL,
  direction TEXT NOT NULL,
  sender TEXT NOT NULL,
  content TEXT NOT NULL,
  msg_id TEXT,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sales_msg_conv ON sales_messages (conversation_id, id ASC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_msg_msgid ON sales_messages (msg_id) WHERE msg_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS sales_lead_events (
  id BIGSERIAL PRIMARY KEY,
  lead_id BIGINT NOT NULL REFERENCES sales_leads(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  summary TEXT,
  evidence TEXT,
  confidence NUMERIC(4,3),
  priority TEXT DEFAULT 'normal',
  recommended_action TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sales_events_lead ON sales_lead_events (lead_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sales_events_type ON sales_lead_events (event_type, created_at DESC);

CREATE TABLE IF NOT EXISTS sales_score_items (
  id BIGSERIAL PRIMARY KEY,
  lead_id BIGINT NOT NULL REFERENCES sales_leads(id) ON DELETE CASCADE,
  rule_key TEXT NOT NULL,
  points INT NOT NULL,
  evidence TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sales_score_lead ON sales_score_items (lead_id, id DESC);

CREATE TABLE IF NOT EXISTS sales_tasks (
  id BIGSERIAL PRIMARY KEY,
  lead_id BIGINT NOT NULL REFERENCES sales_leads(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  detail TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  due_at TIMESTAMPTZ,
  assignee TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sales_tasks_open ON sales_tasks (status, due_at NULLS LAST);
