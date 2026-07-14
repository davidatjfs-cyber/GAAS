-- 112: 销售人员管理（花名册 + 每日行为 + KPI目标/得分）
-- 销售人员不登录后台，仅通过 rep_key 字符串与 sales_leads.owner_username / sales_tasks.assignee 关联，不依赖 users 表。

CREATE TABLE IF NOT EXISTS sales_reps (
  id SERIAL PRIMARY KEY,
  rep_key TEXT NOT NULL UNIQUE,  -- 对应 sales_leads.owner_username / sales_tasks.assignee 的值
  display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'sales',  -- sales / sales_manager
  status TEXT NOT NULL DEFAULT 'active',  -- active / inactive
  hire_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sales_daily_activity (
  id BIGSERIAL PRIMARY KEY,
  rep_id INT NOT NULL REFERENCES sales_reps(id) ON DELETE CASCADE,
  activity_date DATE NOT NULL,
  replies_sent INT NOT NULL DEFAULT 0,
  avg_response_minutes NUMERIC(10,2),
  leads_touched INT NOT NULL DEFAULT 0,
  tasks_completed INT NOT NULL DEFAULT 0,
  overdue_tasks INT NOT NULL DEFAULT 0,
  price_guard_triggers INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (rep_id, activity_date)
);

CREATE TABLE IF NOT EXISTS sales_kpi_targets (
  id BIGSERIAL PRIMARY KEY,
  rep_id INT NOT NULL REFERENCES sales_reps(id) ON DELETE CASCADE,
  period_type TEXT NOT NULL,  -- 'week' / 'month'
  period_key TEXT NOT NULL,   -- 如 '2026-W29' 或 '2026-07'
  target_new_leads INT DEFAULT 0,
  target_demos INT DEFAULT 0,
  target_deals INT DEFAULT 0,
  target_revenue_fen BIGINT DEFAULT 0,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (rep_id, period_type, period_key)
);

CREATE TABLE IF NOT EXISTS sales_kpi_scores (
  id BIGSERIAL PRIMARY KEY,
  rep_id INT NOT NULL REFERENCES sales_reps(id) ON DELETE CASCADE,
  period_type TEXT NOT NULL,
  period_key TEXT NOT NULL,
  behavior_score NUMERIC(6,2),
  outcome_score NUMERIC(6,2),
  manager_score NUMERIC(6,2),
  final_score NUMERIC(6,2),
  manager_comment TEXT,
  computed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (rep_id, period_type, period_key)
);

CREATE INDEX IF NOT EXISTS idx_sales_daily_activity_date ON sales_daily_activity (activity_date);
CREATE INDEX IF NOT EXISTS idx_sales_kpi_targets_period ON sales_kpi_targets (period_type, period_key);
CREATE INDEX IF NOT EXISTS idx_sales_kpi_scores_period ON sales_kpi_scores (period_type, period_key);
