-- 179: Customer Digital Twin MVP
-- 1) 餐饮顾客真实负反馈知识库（Restaurant Negative Feedback Corpus）
--    每条语料绑定 触发条件 + 客户人格 + 当前情绪 + 后续行为，不是"客服话术库"
-- 2) 黄金基准集（四层 Ground Truth：行为/心理/语言/判卷），模型无关回归判卷标准

CREATE TABLE IF NOT EXISTS customer_twin_negative_feedback (
  id BIGSERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL,
  sub_category TEXT NOT NULL DEFAULT '',
  scene TEXT NOT NULL DEFAULT '',
  customer_type TEXT NOT NULL DEFAULT '',
  emotion INT NOT NULL DEFAULT 60,
  stage TEXT NOT NULL DEFAULT '',
  severity INT NOT NULL DEFAULT 2,
  trigger TEXT NOT NULL DEFAULT '',
  expression_style TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL,
  expected_action TEXT[] NOT NULL DEFAULT '{}',
  avoid_action TEXT[] NOT NULL DEFAULT '{}',
  source TEXT NOT NULL DEFAULT 'expert',
  source_table TEXT,
  source_record_id TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  tenant_id VARCHAR(80) NOT NULL DEFAULT 'default',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ct_negfb_pick
  ON customer_twin_negative_feedback (category, stage, expression_style, severity);

CREATE TABLE IF NOT EXISTS customer_twin_golden_cases (
  id BIGSERIAL PRIMARY KEY,
  case_id TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  difficulty INT NOT NULL DEFAULT 2,
  purpose TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',
  schema_version TEXT NOT NULL DEFAULT 'v1',
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_record_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  tenant_id VARCHAR(80) NOT NULL DEFAULT 'default',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ct_golden_status
  ON customer_twin_golden_cases (status, difficulty);
