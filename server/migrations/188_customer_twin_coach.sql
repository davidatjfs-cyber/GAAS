-- 188: AI 顾客会话引擎（技能化培训会话 + 每日校准）

CREATE TABLE IF NOT EXISTS customer_twin_coach_sessions (
  id BIGSERIAL PRIMARY KEY,
  session_no TEXT NOT NULL UNIQUE,
  username CITEXT NOT NULL,
  skill_key TEXT NOT NULL REFERENCES job_coach_skills(skill_key) ON DELETE CASCADE,
  persona JSONB NOT NULL DEFAULT '{}'::jsonb,
  locked_facts JSONB NOT NULL DEFAULT '{}'::jsonb,
  phase TEXT NOT NULL DEFAULT 'opening',
  transcript JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'active',
  rule_score JSONB NOT NULL DEFAULT '{}'::jsonb,
  ai_score JSONB NOT NULL DEFAULT '{}'::jsonb,
  success BOOLEAN,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  tenant_id VARCHAR(80) NOT NULL DEFAULT 'default',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ctcs_user_skill
  ON customer_twin_coach_sessions (username, skill_key, started_at DESC);

CREATE TABLE IF NOT EXISTS customer_twin_calibration (
  id BIGSERIAL PRIMARY KEY,
  session_id BIGINT NOT NULL REFERENCES customer_twin_coach_sessions(id) ON DELETE CASCADE,
  admin_username CITEXT NOT NULL,
  scores JSONB NOT NULL DEFAULT '{}'::jsonb,
  agreement JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'done',
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  tenant_id VARCHAR(80) NOT NULL DEFAULT 'default',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ctcal_session
  ON customer_twin_calibration (session_id);
